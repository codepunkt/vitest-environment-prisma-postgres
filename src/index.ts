import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Environment } from 'vitest/environments';
import { builtinEnvironments } from 'vitest/environments';
import type { PrismaClientLike, PrismaPostgresEnvironmentOptions } from './dts/index.js';

const require = createRequire(import.meta.url);

/**
 * Creates the test context used by the `prisma-postgres` Vitest environment.
 *
 * Responsibilities:
 * - Load the user's Prisma client from the configured `clientPath`.
 * - Wire it to a PostgreSQL connection (via `PrismaPg`), connecting to
 *   `databaseUrl` or `process.env.DATABASE_URL` (preferrably).
 * - Expose a `client` proxy that:
 *   - forwards all calls to the current interactive transaction client
 *   - throws if accessed outside an active test transaction
 *   - replaces nested `$transaction` calls with savepoint-based transactions
 *
 * @param options PrismaPostgresEnvironmentOptions
 * @returns An object exposed as `global.prismaPostgresTestContext` and used by both
 * the Vitest environment and the user's Prisma client mock.
 */
function createPrismaPostgresTestContext(options: PrismaPostgresEnvironmentOptions) {
  let savePointCounter = 0;

  /**
   * The Prisma client used inside the current test transaction.
   * Set in `beginTestTransaction`, cleared in `endTestTransaction`.
   * All calls made through `clientProxy` forward to this instance.
   */
  let transactionClient: PrismaClientLike | null = null;

  /**
   * Ends the interactive transaction started by `beginTestTransaction`.
   * Invoked by `afterEach` from the environment's setup file.
   * This triggers a rollback of the test's database changes.
   */
  let internalEndTestTransaction: () => void = () => {};

  const { PrismaClient } = require(options.clientPath);
  const originalClient: PrismaClientLike = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: options.databaseUrl ?? process.env.DATABASE_URL!,
    }),
    log: options.log,
  });

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
    arg: PromiseLike<unknown>[] | ((client: PrismaClientLike) => Promise<unknown>),
  ) => {
    if (transactionClient === null) {
      throw new Error('Nested $transaction called without an active test transaction.');
    }

    const savePointId = `vitest_environment_prisma_postgres_${++savePointCounter}`;
    await transactionClient.$executeRawUnsafe?.(`SAVEPOINT ${savePointId};`);

    const run = () => (Array.isArray(arg) ? Promise.all(arg) : arg(transactionClient!));

    try {
      const result = await run();
      await transactionClient.$executeRawUnsafe?.(`RELEASE SAVEPOINT ${savePointId};`);
      return result;
    } catch (err) {
      await transactionClient.$executeRawUnsafe?.(`ROLLBACK TO SAVEPOINT ${savePointId};`);
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
    get: (_target, name: keyof PrismaClientLike | symbol) => {
      if (!transactionClient) {
        throw new Error(
          [
            'prismaPostgresTestContext.client was accessed outside of an active test transaction.',
            'This usually means that test.setupFiles is not configured correctly.',
          ].join('\n'),
        );
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
    return new Promise<void>((resolveBeforeEach) => {
      const testTransactionFn = (tx: PrismaClientLike) => {
        transactionClient = tx;
        resolveBeforeEach();

        return new Promise((_commitTransaction, rejectTransaction) => {
          internalEndTestTransaction = () => {
            rejectTransaction();
            transactionClient = null;
          };
        });
      };

      const testTransactionPromise = originalClient.$transaction(testTransactionFn, options.transactionOptions);

      // catch transaction rollback errors
      testTransactionPromise.catch(() => true);
    });
  };

  return {
    client,
    beginTestTransaction,
    endTestTransaction: () => internalEndTestTransaction(),
    setup: () => originalClient.$connect(),
    teardown: () => originalClient.$disconnect(),
  };
}

const environmentName = 'prisma-postgres';

const environment: Environment = {
  name: environmentName,
  viteEnvironment: 'ssr',

  async setup(global, opts: Record<string, any>) {
    const options: PrismaPostgresEnvironmentOptions = opts[environmentName] ?? {};

    if (!options.databaseUrl && !process.env.DATABASE_URL) {
      throw new Error('no database url defined!');
    }

    const ctx = createPrismaPostgresTestContext(options);
    await ctx.setup();

    // make context available globally for setupFiles.
    global.prismaPostgresTestContext = ctx;

    const { teardown: nodeEnvironmentTeardown } = await builtinEnvironments.node.setup(global, {});

    return {
      async teardown(global) {
        await ctx.teardown();
        await nodeEnvironmentTeardown(global);
      },
    };
  },
};

export default environment;
