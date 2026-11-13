import type { PrismaPostgresClient, TransactionOptions } from './index.js';

/** Register PostgreSQL rollback hooks for the current Vitest suite. */
export declare function setupPrismaPostgres<
  Client extends PrismaPostgresClient,
>(createClient: () => Client, transactionOptions?: TransactionOptions): Client;
