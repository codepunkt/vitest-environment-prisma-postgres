import { beforeEach, describe, expect, it, vi } from 'vitest';

const { teardownMock, nodeSetupMock } = vi.hoisted(() => {
  const teardownMock = vi.fn();
  const nodeSetupMock = vi.fn().mockResolvedValue({
    teardown: teardownMock,
  });

  return { teardownMock, nodeSetupMock };
});

vi.mock('vitest/environments', () => {
  return {
    builtinEnvironments: {
      node: {
        setup: nodeSetupMock,
      },
    },
  };
});

import environment from '../src/index.js';

describe('prisma-postgres environment', () => {
  const global: any = {};
  const options = {
    clientPath: '../test/prisma-client-stub.js',
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('makes prismaPostgresTestContext available and wires teardown', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    const result = await environment.setup(global, {
      'prisma-postgres': options,
    });
    const ctx = global.prismaPostgresTestContext;

    expect(nodeSetupMock).toHaveBeenCalledOnce();
    expect(ctx).toBeDefined();
    expect(typeof ctx.beginTestTransaction).toBe('function');
    expect(typeof ctx.setup).toBe('function');
    expect(typeof ctx.teardown).toBe('function');
    expect(typeof ctx.endTestTransaction).toBe('function');

    await result.teardown(global);

    expect(teardownMock).toHaveBeenCalledOnce();
  });

  it('throws without databaseUrl', async () => {
    await expect(
      environment.setup(global, { 'wrong-option-key': options }),
    ).rejects.toThrow('no DATABASE_URL defined!');
  });
});
