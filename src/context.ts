import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import type {
  PrismaClientLike,
  PrismaPostgresClient,
  TransactionOptions,
  PrismaPostgresEnvironmentOptions,
} from './dts/index.js';

/**
 * Static metadata that Prisma generates into every client. It is identical on
 * the original client and the transaction client, and reading it runs no
 * query, so it is served from the original client even outside a test
 * transaction. Libraries read it at import time, before any test runs: for
 * example better-auth's prisma adapter reads `_runtimeDataModel`.
 */
const staticClientMetadata = new Set<string | symbol>(['_runtimeDataModel']);

/**
 * Creates the test context used by the `prisma-postgres` Vitest environment.
 *
 * @param options PrismaPostgresEnvironmentOptions
 * @returns The test context object used by both the Vitest environment and the
 * user's Prisma client mock.
 */
export async function createContext(options: PrismaPostgresEnvironmentOptions) {
  const module = await import(toImportSpecifier(options.clientPath));
  // CommonJS clients such as `@prisma/client` may only expose their exports
  // on `default` when loaded with `import()`.
  const PrismaClient = module.PrismaClient ?? module.default?.PrismaClient;
  return createTransactionContext(
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      log: options.log,
    }),
    options.transactionOptions,
  );
}

const require = createRequire(import.meta.url);

/**
 * Resolves relative and absolute file paths against the working directory and
 * turns them into file URLs. Directories and paths without an extension
 * resolve to their entry file, as they did with `require()`, because
 * `import()` needs a file. Package names, such as `@prisma/client`, are
 * passed to `import()` unchanged.
 */
export function toImportSpecifier(clientPath: string) {
  if (!clientPath.startsWith('.') && !isAbsolute(clientPath)) return clientPath;

  const path = resolve(clientPath);
  let file = path;
  try {
    file = require.resolve(path);
  } catch {
    // Not resolvable by require(), e.g. a .ts entry: let import() try it.
  }
  return pathToFileURL(file).href;
}

export function createTransactionContext(
  originalClient: PrismaPostgresClient,
  transactionOptions?: TransactionOptions,
) {
  let savePointCounter = 0;

  /**
   * The Prisma client used inside the current test transaction.
   * Set in `beginTestTransaction`, cleared in `endTestTransaction`.
   * All calls made through `clientProxy` forward to this instance.
   */
  let transactionClient: Pick<PrismaClientLike, '$executeRawUnsafe'> | null =
    null;

  /**
   * Ends the interactive transaction started by `beginTestTransaction`.
   * Invoked by `afterEach` from the environment's setup file.
   * This triggers a rollback of the test's database changes.
   */
  let rejectTransaction: (() => void) | undefined;
  let pendingTransaction: Promise<unknown> | undefined;
  const rollback = new Error('Rolling back the test transaction');

  /**
   * Emulates Prisma's nested `$transaction` behavior inside an active interactive
   * transaction using PostgreSQL savepoints.
   *
   * Prisma does not support starting a new interactive transaction while one is
   * already open. To allow code-under-test to use `$transaction` normally, we:
   *
   *   1. Create a SAVEPOINT before running the nested transaction body
   *   2. Execute either:
   *        - the callback form:    prisma.$transaction(async (tx) => ...)
   *        - the array form:       prisma.$transaction([op1, op2, ...])
   *   3. On success: RELEASE the savepoint
   *   4. On error: ROLLBACK TO the savepoint and rethrow the error
   *
   * This provides correct nested-transaction semantics while keeping the outer
   * interactive transaction open for the duration of the test.
   */
  const fakeInnerTransactionMethod = async (
    arg:
      | PromiseLike<unknown>[]
      | ((client: PrismaClientLike) => Promise<unknown>),
  ) => {
    // if tx wasn't defined, the guard condition in client proxy would've thrown
    const tx = transactionClient!;

    const savePointId = `vitest_environment_prisma_postgres_${++savePointCounter}`;
    await tx.$executeRawUnsafe?.(`SAVEPOINT ${savePointId};`);

    const run = () =>
      Array.isArray(arg) ? Promise.all(arg) : arg(tx as PrismaClientLike);

    try {
      const result = await run();
      await tx.$executeRawUnsafe?.(`RELEASE SAVEPOINT ${savePointId};`);
      return result;
    } catch (err) {
      await tx.$executeRawUnsafe?.(`ROLLBACK TO SAVEPOINT ${savePointId};`);
      throw err;
    }
  };

  /**
   * A proxy that behaves like the user's Prisma client, but always forwards
   * calls to the currently active `transactionClient`.
   *
   * This is what users use to mock their regular Prisma client with. If
   * accessed outside of an active test transaction, it throws with a helpful
   * error message.
   */
  const client: PrismaClientLike = new Proxy({} as PrismaClientLike, {
    has: (_target, name) => {
      if (!transactionClient) {
        return staticClientMetadata.has(name) && name in originalClient;
      }
      return name in transactionClient;
    },
    get: (_target, name: keyof PrismaClientLike | symbol) => {
      if (!transactionClient && staticClientMetadata.has(name)) {
        return (originalClient as any)[name];
      }

      if (!transactionClient) {
        throw new Error(
          [
            'prismaPostgresTestContext.client was accessed outside of an active test transaction.',
            'This usually means that test.setupFiles is not configured correctly.',
          ].join('\n'),
        );
      }

      if (name === '$connect' || name === '$disconnect') {
        return () => Promise.resolve();
      }

      if (name === '$transaction') {
        return fakeInnerTransactionMethod;
      }

      const target = transactionClient as any;
      const value = target[name];

      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  });

  /**
   * Executed `beforeEach` test.
   *
   * Starts an interactive Prisma transaction and defines a new
   * `internalEndTestTransaction` to rollback the interactive transaction,
   * called by `afterEach`.
   *
   * Also, during the runtime of the interactive transaction, defines the
   * `transactionClient` to be used by the tests being executed, supposed to
   * mock the standard Prisma client at test runtime.
   *
   * @returns A promise that resolves when the transaction is ready and the
   * test can begin.
   */
  const beginTestTransaction = async () => {
    if (pendingTransaction) {
      throw new Error(
        '[vitest-environment-prisma-postgres] beginTestTransaction called while a test transaction is already active. ' +
          'This usually indicates misconfigured hooks or concurrent tests using the same context.',
      );
    }

    const ready = new Promise<void>((resolve, reject) => {
      pendingTransaction = originalClient.$transaction((tx) => {
        transactionClient = tx;
        return new Promise<never>((_commit, fail) => {
          rejectTransaction = () => fail(rollback);
          resolve();
        });
      }, transactionOptions);
      void pendingTransaction.catch(reject);
    });

    try {
      await ready;
    } catch (error) {
      pendingTransaction = undefined;
      throw error;
    }
  };

  const endTestTransaction = async () => {
    if (!rejectTransaction) return;

    rejectTransaction();
    transactionClient = null;
    rejectTransaction = undefined;
    try {
      await pendingTransaction;
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      pendingTransaction = undefined;
    }
  };

  return {
    client,
    beginTestTransaction,
    endTestTransaction,
    setup: () => originalClient.$connect(),
    teardown: () => originalClient.$disconnect(),
  };
}
