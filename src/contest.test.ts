import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PrismaClient as PrismaClientStub,
  prismaClientStubInstances,
} from '../test/prisma-client-stub.js';
import { createContext, toImportSpecifier } from './context.js';

const { PrismaPgMock } = vi.hoisted(() => {
  const PrismaPgMock = vi.fn();
  return { PrismaPgMock };
});

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: PrismaPgMock,
}));

const makeContext = async (
  transaction:
    | 'transactionPending'
    | 'transactionStarted'
    | 'transactionEnded' = 'transactionPending',
): Promise<[Awaited<ReturnType<typeof createContext>>, PrismaClientStub]> => {
  const context = await createContext({
    clientPath: './test/prisma-client-stub.js',
    databaseUrl: 'postgres://fake',
    log: ['query'],
    transactionOptions: { timeout: 123 },
  });
  await context.setup();
  if (transaction !== 'transactionPending') {
    await context.beginTestTransaction();
    if (transaction === 'transactionEnded') {
      context.endTestTransaction();
    }
  }
  return [context, prismaClientStubInstances.at(-1)!];
};

describe('createContext', () => {
  beforeEach(() => {
    PrismaPgMock.mockClear();
    vi.unstubAllEnvs();
  });

  it('creates PrismaClient with PrismaPg adapter', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    const [ctx] = await makeContext();

    expect(PrismaPgMock).toHaveBeenCalledWith({
      connectionString: 'postgres://fake',
    });

    await ctx.teardown();
  });

  it('loads a client that only has a default export', async () => {
    const before = prismaClientStubInstances.length;
    const ctx = await createContext({
      clientPath: './test/prisma-client-default-stub.js',
    });

    expect(prismaClientStubInstances).toHaveLength(before + 1);

    await ctx.teardown();
  });

  it('throws when client is accessed outside of a test transaction', async () => {
    const [transactionPendingContext] = await makeContext('transactionPending');
    const [transactionEndedContext] = await makeContext('transactionEnded');

    expect(() =>
      transactionPendingContext.client.$transaction(async () => {}),
    ).toThrow(
      /prismaPostgresTestContext\.client was accessed outside of an active test transaction/,
    );
    expect(() =>
      transactionEndedContext.client.$transaction(async () => {}),
    ).toThrow(
      /prismaPostgresTestContext\.client was accessed outside of an active test transaction/,
    );
  });

  it('allows client access inside of a test transaction', async () => {
    const [transactionStartedContext] = await makeContext('transactionStarted');
    expect(() =>
      transactionStartedContext.client.$transaction(async () => {}),
    ).not.toThrow();
  });

  it('throws when test transaction is started twice for the same context', async () => {
    const [transactionStartedContext] = await makeContext('transactionStarted');
    await expect(
      transactionStartedContext.beginTestTransaction(),
    ).rejects.toThrow(
      /beginTestTransaction called while a test transaction is already active/,
    );
  });

  it('makes $connect and $disconnect no-ops on the proxy client', async () => {
    const [ctx] = await makeContext();
    await ctx.beginTestTransaction();
    await expect(ctx.client.$connect()).resolves.toBeUndefined();
    await expect(ctx.client.$disconnect()).resolves.toBeUndefined();
    await ctx.endTestTransaction();
    await ctx.teardown();
  });

  it('reports a failure to start the transaction and lets the next test start', async () => {
    const [ctx, prisma] = await makeContext();
    prisma.$transaction.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(ctx.beginTestTransaction()).rejects.toThrow(
      'database unavailable',
    );
    await ctx.beginTestTransaction();
    await ctx.endTestTransaction();
    await ctx.teardown();
  });

  it('ends without a transaction as a no-op', async () => {
    const [ctx] = await makeContext();

    await expect(ctx.endTestTransaction()).resolves.toBeUndefined();
    await ctx.teardown();
  });

  it('rethrows errors other than the rollback when ending a transaction', async () => {
    const [ctx, prisma] = await makeContext();
    const start = prisma.$transaction.getMockImplementation()!;
    prisma.$transaction.mockImplementationOnce(async (run) => {
      try {
        return await start(run);
      } catch {
        throw new Error('connection lost');
      }
    });

    await ctx.beginTestTransaction();
    await expect(ctx.endTestTransaction()).rejects.toThrow('connection lost');
    await ctx.beginTestTransaction();
    await ctx.endTestTransaction();
    await ctx.teardown();
  });

  it('waits for rollback before the transaction context can be reused', async () => {
    const [ctx, prisma] = await makeContext();
    let finishRollback!: () => void;
    const rolledBack = new Promise<void>((resolve) => {
      finishRollback = resolve;
    });
    const start = prisma.$transaction.getMockImplementation()!;
    prisma.$transaction.mockImplementationOnce(async (run) => {
      try {
        return await start(run);
      } finally {
        await rolledBack;
      }
    });

    await ctx.beginTestTransaction();
    const ending = ctx.endTestTransaction();
    await expect(ctx.beginTestTransaction()).rejects.toThrow('already active');
    finishRollback();
    await ending;
    await ctx.beginTestTransaction();
    await ctx.endTestTransaction();
    await ctx.teardown();
  });

  it('nested $transaction uses SAVEPOINT/RELEASE on success', async () => {
    const [ctx, prisma] = await makeContext('transactionStarted');

    await ctx.client.$transaction([
      Promise.resolve(1),
      Promise.resolve(2),
    ] as any);

    expect(prisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^SAVEPOINT vitest_environment_prisma_postgres_/),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /^RELEASE SAVEPOINT vitest_environment_prisma_postgres_/,
      ),
    );
  });

  it('nested $transaction rolls back to savepoint on error', async () => {
    const [ctx, prisma] = await makeContext('transactionStarted');

    await expect(
      ctx.client.$transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(prisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^SAVEPOINT vitest_environment_prisma_postgres_/),
    );
    expect(prisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /^ROLLBACK TO SAVEPOINT vitest_environment_prisma_postgres_/,
      ),
    );
  });

  it('forwards function properties other than $transaction and lifecycle methods from the transaction client', async () => {
    const [ctx, prisma] = await makeContext('transactionStarted');

    expect(prisma.$connect).toHaveBeenCalledTimes(1);

    await ctx.client.$executeRawUnsafe('SELECT 1');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  it('forwards non-function properties from the transaction client', async () => {
    const [ctx, prisma] = await makeContext('transactionStarted');
    expect(prisma.meta).toEqual((ctx.client as PrismaClientStub).meta);
  });

  it('has trap returns true for properties on the transaction client', async () => {
    const [ctx] = await makeContext('transactionStarted');
    expect('$connect' in ctx.client).toBe(true);
    expect('meta' in ctx.client).toBe(true);
    expect('nonExistentProp' in ctx.client).toBe(false);
  });

  it('has trap returns false when no transaction is active', async () => {
    const [ctx] = await makeContext('transactionPending');
    expect('$connect' in ctx.client).toBe(false);
  });

  it('serves static client metadata from the original client outside of a test transaction', async () => {
    const [pendingCtx, pendingClient] = await makeContext('transactionPending');
    const [endedCtx, endedClient] = await makeContext('transactionEnded');

    expect((pendingCtx.client as any)._runtimeDataModel).toBe(
      pendingClient._runtimeDataModel,
    );
    expect((endedCtx.client as any)._runtimeDataModel).toBe(
      endedClient._runtimeDataModel,
    );
    expect('_runtimeDataModel' in pendingCtx.client).toBe(true);
  });

  it('still throws for non-metadata properties outside of a test transaction', async () => {
    const [ctx] = await makeContext('transactionPending');
    expect(() => (ctx.client as PrismaClientStub).meta).toThrow(
      /prismaPostgresTestContext\.client was accessed outside of an active test transaction/,
    );
  });
});

describe('toImportSpecifier', () => {
  it('turns relative and absolute paths into file URLs from the working directory', () => {
    expect(toImportSpecifier('./client.js')).toBe(
      pathToFileURL(resolve('client.js')).href,
    );
    expect(toImportSpecifier('/abs/client.ts')).toBe('file:///abs/client.ts');
  });

  it('resolves directories and paths without an extension to their entry file', () => {
    expect(toImportSpecifier('./test/client-dir')).toBe(
      pathToFileURL(resolve('test/client-dir/index.js')).href,
    );
    expect(toImportSpecifier('./test/prisma-client-stub')).toBe(
      pathToFileURL(resolve('test/prisma-client-stub.js')).href,
    );
  });

  it('loads a client from a directory', async () => {
    const before = prismaClientStubInstances.length;
    const ctx = await createContext({ clientPath: './test/client-dir' });

    expect(prismaClientStubInstances).toHaveLength(before + 1);

    await ctx.teardown();
  });

  it('passes package names through unchanged', () => {
    expect(toImportSpecifier('@prisma/client')).toBe('@prisma/client');
  });
});
