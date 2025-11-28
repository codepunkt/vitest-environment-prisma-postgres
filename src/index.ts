import type { Environment } from 'vitest/environments';
import { builtinEnvironments } from 'vitest/environments';
import { createContext } from './context.js';
import type { PrismaPostgresEnvironmentOptions } from './dts/index.js';

const environmentName = 'prisma-postgres';

const environment: Environment = {
  name: environmentName,
  viteEnvironment: 'ssr',

  async setup(global, opts: Record<string, any>) {
    const options: PrismaPostgresEnvironmentOptions =
      opts[environmentName] ?? {};

    if (!process.env.DATABASE_URL) {
      throw new Error('no DATABASE_URL defined!');
    }

    const ctx = createContext(options);
    await ctx.setup();

    // make context available globally for setupFiles.
    global.prismaPostgresTestContext = ctx;

    const { teardown: nodeEnvironmentTeardown } =
      await builtinEnvironments.node.setup(global, {});

    return {
      async teardown(global) {
        await ctx.teardown();
        await nodeEnvironmentTeardown(global);
      },
    };
  },
};

export default environment;
