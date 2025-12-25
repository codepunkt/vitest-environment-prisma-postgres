![vitest-environment-prisma-postgres](https://i.imgur.com/KUxDm4b.png)

<div align="center">
  <h1>vitest-environment-prisma-postgres</h1>
  <a href="https://www.npmjs.com/package/vitest-environment-prisma-postgres"><img src="https://img.shields.io/npm/v/vitest-environment-prisma-postgres.svg?style=flat" /></a>
  <a href="https://github.com/codepunkt/vitest-environment-prisma-postgres/blob/main/.github/CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" /></a>
  <a href="https://github.com/codepunkt/vitest-environment-prisma-postgres/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <a href="https://codecov.io/gh/codepunkt/vitest-environment-prisma-postgres"><img src="https://codecov.io/gh/codepunkt/vitest-environment-prisma-postgres/graph/badge.svg?token=BI1IWN0F3G" /></a>
  <br />
  <br />
  <a href="#features">Features</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="#installation--setup">Installation & Setup</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="#typescript-configuration">TypeScript Configuration</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="#known-limiations">Known Limitations</a>
  <br />
  <hr />
</div>

## Motivation

[Vitest](https://vitest.dev/) environment for [Prisma](https://www.prisma.io/) + [PostgreSQL](https://www.postgresql.org/) designed for fast integration tests.

Integration tests against a database are often slow because each test needs its own database state. Teams typically either:

- Reseed the database before every test, or
- Insert all required data inside each test.

Both approaches are slow, repetitive, and dominate test runtime.

**This environment eliminates that cost.**

You run migrations and seed your test database once.
Each test then runs inside its own database transaction, which is rolled back automatically after the test finishes. Your tests stay isolated, realistic, and extremely fast, creating dedicated data for every test.

If you want to understand the full design rationale, implementation details, and performance benchmarks behind this environment, check out the in-depth article on my blog:

https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/

## Features

- Run integration tests against a real PostgreSQL instance.
- Seed your database once at the beginning of the test run.
- Tests run inside sandboxed transactions, but application-level transactions still work normally.
- Test transactions are rolled back after every test.
- Tests are isolated, fast, and order independent.

## Installation & Setup

> Requires Node.js 20 or newer (CI covers 20.x, 22.x, 24.x).

#### Step 1: Install the environment

First, install the environnment:

```shell
npm install vitest-environment-prisma-postgres --save-dev
```

#### Step 2: Ensure peer dependency availability

Then, ensure that the required peer dependencies are available. This library requires that you have all of the following installed in your project:

- `vitest` in version `4.x`
- `prisma` in version `7.x`
- `@prisma/adapter-pg` in version `7.x`

#### Step 3: Enable and configure the environment in your Vitest config

Configure the environment in your Vitest config:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'prisma-postgres',
    environmentOptions: {
      'prisma-postgres': {
        // You must configure the path to your prisma client.
        clientPath: "./generated/prisma-client"
      }
    },
    setupFiles: [
      // Registers hooks that start and roll back a database transaction around every test.
      'vitest-environment-prisma-postgres/setup',
      // This is where you mock your Prisma client to use the test environment's client.
      './vitest.setup.ts'
    ],
  }
});
```

#### Step 4: Provide a `DATABASE_URL`

This environment will create the Prisma client and PostgreSQL adapter for your tests, so it has to know the connectionString to your test database.

You provide it by running your tests with a `DATABASE_URL` environment variable, which must point to a PostgreSQL instance for testing. It can point to:

- a real local PostgresSQL instance
- a docker-compose container
- a Testcontainers-created instance (see below)
- a cloud-hosted PostgresSQL instance, e.g, Supabase or Prisma Postgres

#### Step 5: Mock Prisma client

In your setupFile, `vitest.setup.ts`, mock your local Prisma client with the client provided by this environment:

```ts
import { vi } from 'vitest';

vi.mock('./generated/prisma-client', () => ({
  default: prismaPostgresTestContext.client,
}));
```

This ensures that your application code uses the Prisma client created by the test environment. Combined with the vitest-environment-prisma-postgres/setup file, which starts and rolls back a transaction around every test, this means all Prisma queries from your code run inside an isolated transaction per test.

Please make sure that you're mocking exactly the module path that your code is using to import your Prisma client.

#### Step 6: Seed once per test run

Make sure to seed your test database at the beginning of every test run. 

## TypeScript configuration

If you are using TypeScript, make sure to add this environment to your `compilerOptions.types` array in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": [
      "node",
      "vitest/globals",
      "vitest-environment-prisma-postgres"
    ]
  }
}
```

This is required because this environment provides a global type declaration:

```ts
declare global {
  var prismaPostgresTestContext: PublicPrismaPostgresTestContext;
}
```

Without adding the package to `compilerOptions.types`, TypeScript will not include this global augmentation, and you will get type errors when mocking your Prisma client in `vitest.setup.ts`:

```ts
vi.mock('./generated/prisma-client', () => ({
  default: globalThis.prismaPostgresTestContext.client,
  //                  ^^^^^^^^^^^^^^^^^^^^^^^^^
  //                  Error: Element implicitly has an 'any' type because
  //                  type 'typeof globalThis' has no index signature.
}));
```


Adding "vitest-environment-prisma-postgres" to `compilerOptions.types` ensures that the global declaration is loaded and the mock is type-safe.

## Known limitations

- Support for [Vitest pools](https://vitest.dev/config/pool.html#pool) set to `vmThreads` or `vmThreads` is not implemented
- This environment assumes that tests inside a single worker run one at a time:
  - Do not use `test.concurrent` for tests that touch the database.
  - Keep `maxConcurrency` at `1` for DB integration tests so a worker does not run multiple DB tests at once.

## License

MIT
