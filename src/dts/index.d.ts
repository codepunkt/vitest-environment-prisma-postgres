declare global {
  var prismaPostgresTestContext: {
    beginTestTransaction: () => Promise<void>;
    client: PrismaClientLike;
    endTestTransaction: () => void;
  };
}

export interface PrismaClientLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(
    fn: (tx: PrismaClientLike) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  $executeRawUnsafe(sql: string): Promise<unknown>;
}

interface TransactionOptions {
  /** The maximum amount of time Prisma client will wait to acquire a transaction from the database. */
  maxWait?: number;
  /** The maximum amount of time the interactive transaction can run before being canceled and rolled back. */
  timeout?: number;
  /** Sets the transaction isolation level. By default this is set to the value currently configured in your database. */
  isolationLevel?: any;
}

export interface PrismaPostgresEnvironmentOptions {
  /** Path to your Prisma client. */
  clientPath: string;
  /** Database url (optional). Read from `process.env.DATABASE_URL` otherwise. */
  databaseUrl?: string;
  /** Pass prisma loglevels to log to stdout. to log everything, pass `['query', 'info', 'warn', 'error']`. */
  log?: string[];
  /** Allows to set options for the test transactions. Default values are defined by Prisma. */
  transactionOptions?: TransactionOptions;
}
