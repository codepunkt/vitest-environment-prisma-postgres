import { afterAll, aroundEach } from 'vitest';
import { createTransactionContext } from './context.js';
import type { PrismaPostgresClient, TransactionOptions } from './dts/index.js';

/** Register PostgreSQL rollback hooks for the current Vitest suite. */
export function setupPrismaPostgres<Client extends PrismaPostgresClient>(
  createClient: () => Client,
  transactionOptions?: TransactionOptions,
): Client {
  const context = createTransactionContext(createClient(), transactionOptions);

  aroundEach(async (runTest) => {
    await context.beginTestTransaction();
    try {
      await runTest();
    } finally {
      await context.endTestTransaction();
    }
  });

  afterAll(context.teardown);

  return context.client as unknown as Client;
}
