import { vi } from 'vitest';

/**
 * IMPORTANT: Shared instance array
 *
 * Vitest loads modules in two different ways:
 *   1. Our tests import this array via ESM: import { prismaClientStubInstances } ...
 *   2. createContext() loads the same array using CommonJS `require()`:
 *        const { PrismaClient } = require(options.clientPath)
 *
 * Even though both paths point to the same file on disk, Vitest/Vite will create
 * TWO separate module instances – one for the ESM import, one for the CJS require.
 *
 * That means each instance gets its own `__prismaClientStubInstances` array.
 * As a result, the stub constructor pushes into *one* array (the require() version),
 * while the test reads from a *different* empty array (the import version).
 *
 * To ensure both sides share the SAME array, we store the array on globalThis
 * and read/write it from there. This guarantees:
 *
 *   - createContext(require(...)) pushes into the same array that tests import
 *   - tests can reliably inspect the stub instances created inside createContext
 *   - no matter how many times Vitest instantiates this module, all instances
 *     point to the single global array
 */
const globalForPrisma = globalThis as any;
if (!globalForPrisma.__prismaClientStubInstances)
  globalForPrisma.__prismaClientStubInstances = [];
export const prismaClientStubInstances: PrismaClient[] =
  globalForPrisma.__prismaClientStubInstances;

export class PrismaClient {
  constructor() {
    prismaClientStubInstances.push(this);
  }

  // non-function property to test proxy passthrough
  meta = { source: 'stub', version: 1 };

  $connect = vi.fn();
  $disconnect = vi.fn();
  $executeRawUnsafe = vi.fn();

  $transaction = vi.fn(async <T>(fn: (tx: unknown) => Promise<T>) => {
    const tx = {
      $connect: this.$connect,
      $disconnect: this.$disconnect,
      $transaction: this.$transaction,
      $executeRawUnsafe: this.$executeRawUnsafe,
      meta: this.meta,
    };

    return fn(tx);
  });
}
