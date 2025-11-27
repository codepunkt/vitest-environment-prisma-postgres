import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**'],
      exclude: ['src/setup.ts', 'src/dts/**'],
    },
  },
});
