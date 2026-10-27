import { defineConfig } from 'vitest/config';

// Deliberately standalone (does NOT extend vite.config.ts, which loads the
// @cloudflare/vite-plugin dev-server machinery we don't need in tests).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['worker/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
