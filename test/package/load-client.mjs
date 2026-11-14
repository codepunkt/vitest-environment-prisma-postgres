// Loads clients through the built package in plain Node.js, the way Vitest
// runs the environment from node_modules. The Vitest suite can't cover this:
// it resolves `import()` through Vite, which accepts paths Node.js rejects.
// Run `pnpm run build` first.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import environment from '../../dist/index.js';

process.env.DATABASE_URL = 'postgres://user@localhost/test';

const clients = 'test/package/clients';
const cases = [
  [
    'a CommonJS package directory',
    resolve(clients, 'legacy-cjs'),
    'legacy-cjs',
  ],
  ['a relative directory', `./${clients}/legacy-cjs`, 'legacy-cjs'],
  ['CommonJS re-exports', `./${clients}/cjs-spread/index.js`, 'cjs-spread'],
  ['an ES module', `./${clients}/esm/client.js`, 'esm'],
  ['a path without extension', `./${clients}/esm/client`, 'esm'],
  ['a TypeScript client', `./${clients}/ts/client.ts`, 'ts'],
];

for (const [description, clientPath, name] of cases) {
  test(`loads ${description}`, async () => {
    const { teardown } = await environment.setup(globalThis, {
      'prisma-postgres': { clientPath },
    });
    try {
      const { client } = globalThis.prismaPostgresTestContext;
      assert.equal(client._runtimeDataModel.name, name);
    } finally {
      await teardown(globalThis);
    }
  });
}
