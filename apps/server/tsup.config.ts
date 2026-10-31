import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // The shared package ships TypeScript source, so bundle it into the server build.
  noExternal: ['@lingua-bridge/shared'],
});
