import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/setup.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  publicDir: 'src/dts',
});
