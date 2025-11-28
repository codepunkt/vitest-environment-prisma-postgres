import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PrismaClient as PrismaClientStub,
  prismaClientStubInstances,
} from '../test/prisma-client-stub.js';
import { createContext } from './context.js';

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
): Promise<[ReturnType<typeof createContext>, PrismaClientStub]> => {
  const context = createContext({
    clientPath: '../test/prisma-client-stub.ts',
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

  it('forwards function properties other than $transaction from the transaction client', async () => {
    const [ctx, prisma] = await makeContext('transactionStarted');

    expect(prisma.$connect).toHaveBeenCalledTimes(1);

    // And calling via ctx.client directly should also work
    await ctx.client.$disconnect();
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('forwards non-function properties from the transaction client', async () => {
    const [ctx, prisma] = await makeContext('transactionStarted');
    expect(prisma.meta).toEqual((ctx.client as PrismaClientStub).meta);
  });
});
