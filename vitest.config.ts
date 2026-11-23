import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

function atlasFinanceWasmVitestPlugin(): Plugin {
  return {
    name: 'atlas-finance-wasm-vitest',
    load(id) {
      const cleanId = id.split('?')[0];
      if (cleanId.endsWith('/atlas_finance_core.wasm') || cleanId.endsWith('\\atlas_finance_core.wasm')) {
        return `import { readFileSync } from 'node:fs';\nexport default new WebAssembly.Module(readFileSync(${JSON.stringify(cleanId)}));\n`;
      }
      return null;
    },
  };
}

// Deliberately standalone (does NOT extend vite.config.ts, which loads the
// @cloudflare/vite-plugin dev-server machinery we don't need in tests).
export default defineConfig({
  plugins: [atlasFinanceWasmVitestPlugin()],
  resolve: { alias: [{ find: '@jsquash/webp/codec/enc/webp_enc.wasm', replacement: fileURLToPath(new URL('./worker/__tests__/webp-wasm-loader.ts', import.meta.url)) }] },
  test: {
    environment: 'node',
    include: ['worker/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
