import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Environment } from 'vitest/environments';
import { builtinEnvironments } from 'vitest/environments';
import type {
  PrismaClientLike,
  PrismaPostgresEnvironmentOptions,
  PublicPrismaPostgresTestContext,
} from './dts/index.js';

/**
 * This environment assumes that tests which hit the database do not run concurrently in the same worker.
 * Do not use test.concurrent or high maxConcurrency with DB-integration tests using this env.
 */

const require = createRequire(import.meta.url);

export class PrismaPostgresTestContext {
  private readonly options: PrismaPostgresEnvironmentOptions;

  private connected = false;
  private originalClient: PrismaClientLike;
  private savePointCounter = 0;
  private transactionClient: PrismaClientLike | null = null;
  private triggerTransactionEnd: () => void = () => {};

  constructor(options: PrismaPostgresEnvironmentOptions) {
    this.options = options;
    const { PrismaClient } = require(options.clientPath);
    const adapter = new PrismaPg({
      connectionString: options.databaseUrl ?? process.env.DATABASE_URL!,
    });
    this.originalClient = new PrismaClient({ adapter, log: options.log });
  }

  /**
   * Public API that we expose on globalThis.prismaPostgresTestContext
   */
  getPublicContext(): PublicPrismaPostgresTestContext {
    return {
      client: this.clientProxy,
      beginTestTransaction: () => this.beginTestTransaction(),
      endTestTransaction: () => this.endTestTransaction(),
    };
  }

  /**
   * Proxy that forwards to the current tx client and overrides nested $transaction.
   */
  private readonly clientProxy: PrismaClientLike = new Proxy({} as PrismaClientLike, {
    get: (_target, name: keyof PrismaClientLike | symbol) => {
      if (!this.transactionClient) {
        throw new Error(
          [
            'prismaPostgresTestContext.client was accessed outside of an active test transaction.',
            'This usually means that test.setupFiles is not configured correctly.',
          ].join('\n'),
        );
      }

      if (name === '$transaction') {
        return this.fakeInnerTransactionMethod.bind(this);
      }

      const target = this.transactionClient as any;
      const value = target[name];

      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  });

  /**
   * Called once from environment.setup to ensure the client is connected
   * and interactive transactions are supported.
   */
  async init(): Promise<void> {
    await this.originalClient.$connect();
    this.connected = true;
  }

  /**
   * Starts an interactive transaction and binds transactionClient to the proxy.
   */
  async beginTestTransaction(): Promise<void> {
    if (!this.connected) {
      await this.init();
    }

    return new Promise<void>((resolve) =>
      this.originalClient
        .$transaction((transactionClient) => {
          // wrap transactionClient to override nested $transaction
          this.transactionClient = transactionClient;

          // allow the test to start
          resolve();

          // keep transaction open until endTransaction calls triggerTransactionEnd
          return new Promise<void>((_innerResolve, innerReject) => {
            this.triggerTransactionEnd = () => {
              innerReject(new Error('rollback test transaction'));
              this.transactionClient = null;
            };
          });
        }, this.options.transactionOptions)
        .catch(() => {
          // swallow transaction error when we reject for rollback
          return true;
        }),
    );
  }

  /**
   * Ends the interactive transaction.
   */
  async endTestTransaction(): Promise<void> {
    this.triggerTransactionEnd();
  }

  async teardown(): Promise<void> {
    await this.originalClient.$disconnect?.();
  }

  /**
   * Nested $transaction implementation using savepoints.
   */
  private async fakeInnerTransactionMethod(
    arg: PromiseLike<unknown>[] | ((client: PrismaClientLike) => Promise<unknown>),
  ) {
    const transactionClient = this.transactionClient;

    if (transactionClient === null) {
      throw new Error('Nested $transaction called without an active test transaction.');
    }

    const savePointId = `vitest_environment_prisma_postgres_${++this.savePointCounter}`;
    await transactionClient.$executeRawUnsafe?.(`SAVEPOINT ${savePointId};`);

    // handles both $transaction overloads, they array and functional form
    const run = () => (Array.isArray(arg) ? Promise.all(arg) : arg(transactionClient!));

    try {
      const result = await run();
      await transactionClient.$executeRawUnsafe?.(`RELEASE SAVEPOINT ${savePointId};`);
      return result;
    } catch (err) {
      await transactionClient.$executeRawUnsafe?.(`ROLLBACK TO SAVEPOINT ${savePointId};`);
      throw err;
    }
  }
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

    const prismaPostgresTestContext = new PrismaPostgresTestContext(options);
    await prismaPostgresTestContext.init();

    global.prismaPostgresTestContext = prismaPostgresTestContext.getPublicContext();

    const { teardown: nodeEnvironmentTeardown } = await builtinEnvironments.node.setup(global, {});

    return {
      async teardown(global) {
        await prismaPostgresTestContext.teardown();
        await nodeEnvironmentTeardown(global);
      },
    };
  },
};

export default environment;
