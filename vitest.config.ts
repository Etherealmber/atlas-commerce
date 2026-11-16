import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Deliberately standalone (does NOT extend vite.config.ts, which loads the
// @cloudflare/vite-plugin dev-server machinery we don't need in tests).
export default defineConfig({
  resolve: { alias: [{ find: '@jsquash/webp/codec/enc/webp_enc.wasm', replacement: fileURLToPath(new URL('./worker/__tests__/webp-wasm-loader.ts', import.meta.url)) }] },
  test: {
    environment: 'node',
    include: ['worker/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
