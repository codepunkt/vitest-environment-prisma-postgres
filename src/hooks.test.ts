import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setupPrismaPostgres } from './hooks.js';

const originalClient = {
  $connect: vi.fn(async () => {}),
  $disconnect: vi.fn(async () => {}),
  $transaction: vi.fn(async (run) => {
    const rows: string[] = [];
    try {
      return await run({
        $executeRawUnsafe: vi.fn(),
        add: (row: string) => rows.push(row),
        list: () => [...rows],
      });
    } finally {
      rows.length = 0;
    }
  }),
  add: (_row: string): void => {
    throw new Error('Expected the transaction client');
  },
  list: (): string[] => {
    throw new Error('Expected the transaction client');
  },
};

const prisma = setupPrismaPostgres(() => originalClient);

beforeEach(() => {
  expect(prisma.list()).toEqual([]);
  prisma.add('fixture');
});

afterEach(() => {
  expect(prisma.list()).toContain('fixture');
});

it('uses the factory client and wraps test hooks in its transaction', () => {
  prisma.add('test');
  expect(prisma.list()).toEqual(['fixture', 'test']);
});

it('starts the next test in a fresh transaction', () => {
  expect(prisma.list()).toEqual(['fixture']);
});
