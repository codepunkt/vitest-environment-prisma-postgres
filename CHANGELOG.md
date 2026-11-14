# Changelog

## [2.1.0](https://github.com/codepunkt/vitest-environment-prisma-postgres/compare/2.0.0...2.1.0) (2026-11-14)

Vitest 5 is now supported, you can bring your own Prisma client, and `clientPath` works with TypeScript clients. This release requires Node.js 22 or newer.

### ✨ New Features

* **Bring your own Prisma client** ([#51](https://github.com/codepunkt/vitest-environment-prisma-postgres/pull/51)). The new `vitest-environment-prisma-postgres/hooks` entry exports `setupPrismaPostgres(createClient, transactionOptions?)`. Call it in a setup file to wrap every test in a rolled-back transaction while you keep your own Vitest environment (`node`, `jsdom`, ...). Your factory builds the client, so Prisma extensions and custom adapter settings work. See [Use your own Prisma client and Vitest environment](https://github.com/codepunkt/vitest-environment-prisma-postgres#use-your-own-prisma-client-and-vitest-environment).
* **Vitest 5 support.** The `vitest` peer range is now `>=4.1 <6` ([#48](https://github.com/codepunkt/vitest-environment-prisma-postgres/pull/48), closes [#47](https://github.com/codepunkt/vitest-environment-prisma-postgres/issues/47)).

### 🐛 Bug Fixes

* **`clientPath` loads with `import()`** ([#53](https://github.com/codepunkt/vitest-environment-prisma-postgres/pull/53), [#54](https://github.com/codepunkt/vitest-environment-prisma-postgres/pull/54), fixes [#22](https://github.com/codepunkt/vitest-environment-prisma-postgres/issues/22)). File paths now resolve against the working directory, not the package's `dist/` folder. Directories and paths without an extension still resolve to their entry file. TypeScript clients from Prisma 7's `prisma-client` generator load on Node.js 22.18+ in an ESM package (`"type": "module"`) if the generator sets `importFileExtension = "ts"`. Package names such as `@prisma/client` resolve as before. Thanks to @tywenk for the report and the original fix in #32.
* **Static client metadata works outside test transactions** ([#52](https://github.com/codepunkt/vitest-environment-prisma-postgres/pull/52)). Reading `_runtimeDataModel` on the client no longer throws before the first test starts. This fixes libraries that read it at import time, such as better-auth 1.7's Prisma adapter.

### ⚠️ Node.js 22 or newer

* Node.js 20 reached end of life in April 2026, so `engines.node` is now `>=22`. CI tests Node.js 22, 24 and 26 ([#53](https://github.com/codepunkt/vitest-environment-prisma-postgres/pull/53)). npm only warns about `engines` by default, but Node 20 is no longer tested.

### 📦 Dependencies

* Built with TypeScript 7, Vitest 5 and tsup 9. Peer ranges for `prisma` and `@prisma/adapter-pg` are unchanged.
* Test coverage is at 100% and CI enforces it.

## [2.0.0](https://github.com/codepunkt/vitest-environment-prisma-postgres/compare/1.0.1...2.0.0) (2026-06-11)

### 🐛 Bug Fixes

* add has trap to client proxy for in operator support ([#26](https://github.com/codepunkt/vitest-environment-prisma-postgres/issues/26)) ([fbec41a](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/fbec41a668cb331c0f20973dd6e854237fa5d5a0))
* augment prismaPostgresTextContent type with transaction fns ([bcbddce](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/bcbddce469ecac9213a88aefc0e8c29eba2912a4))
* import builtinEnvironments from vitest/runtime ([#36](https://github.com/codepunkt/vitest-environment-prisma-postgres/issues/36)) ([9924419](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/99244192d6ac8fee8229468613a1128f77597e78))

### 📚 Documentation

* link to blog article ([b7bd6ae](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/b7bd6ae466159fd9b9ed72125d17dc6f6b52a721))

## [1.0.1](https://github.com/codepunkt/vitest-environment-prisma-postgres/compare/1.0.0...1.0.1) (2025-11-29)

### 🐛 Bug Fixes

* add proper type for global prismaPostgresTestContext ([4914711](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/4914711f70f49a6ef54716c89adfe3edb99421a0))

### ⚙️ CI

* configure codecov coverage ([41714fe](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/41714fed32a754c8ed544045f4c00e521f4d2364))

## 1.0.0 (2025-11-29)

### ✨ New Features

* Vitest environment for Prisma and PostgreSQL ([d78e15b](https://github.com/codepunkt/vitest-environment-prisma-postgres/commit/d78e15b95fb824042951674c92566d4bf3520759))
