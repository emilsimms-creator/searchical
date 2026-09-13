import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each suite spins up its own in-process Postgres (PGlite), so give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
