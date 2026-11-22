#!/usr/bin/env node
/**
 * Verifies the actual production Worker + Client build output under `dist/`
 * after `vite build`:
 *   1. `dist/company_stock/wrangler.json` and `dist/company_stock/index.js` exist
 *   2. `dist/client/index.html` exists
 *   3. `worker/wasm/atlas_finance_core.wasm` was bundled into
 *      `dist/company_stock/assets/*atlas_finance_core*.wasm`
 *   4. The bundled `.wasm` asset inside `dist/company_stock/assets/` matches
 *      `worker/wasm/atlas_finance_core.wasm` byte-for-byte and passes full
 *      ABI v2 + 0-import + 19-export + memory safety verification.
 *
 * Never substitutes a fake binary or passes silently on missing WASM.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWasmBinary } from './build-finance-wasm.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const sourceWasm = resolve(rootDir, 'worker/wasm/atlas_finance_core.wasm');
const workerWrangler = resolve(rootDir, 'dist/company_stock/wrangler.json');
const workerEntry = resolve(rootDir, 'dist/company_stock/index.js');
const workerAssetsDir = resolve(rootDir, 'dist/company_stock/assets');
const clientIndex = resolve(rootDir, 'dist/client/index.html');

async function main() {
  for (const [label, path] of [
    ['Worker Wrangler manifest', workerWrangler],
    ['Worker bundle entry', workerEntry],
    ['Client index.html', clientIndex],
    ['Source finance WASM binary', sourceWasm],
  ]) {
    if (!existsSync(path)) {
      throw new Error(`${label} missing at ${path}`);
    }
  }

  if (!existsSync(workerAssetsDir)) {
    throw new Error(`Worker assets directory missing at ${workerAssetsDir}`);
  }

  const assets = readdirSync(workerAssetsDir);
  const bundledFiles = assets.filter((name) => name.includes('atlas_finance_core') && name.endsWith('.wasm'));
  if (bundledFiles.length === 0) {
    throw new Error(
      `Compiled finance WASM binary was NOT bundled into ${workerAssetsDir}. ` +
        `Check worker/lib/financeCore.ts import.meta.glob and vite.config.ts.`,
    );
  }

  const workerManifest = JSON.parse(readFileSync(workerWrangler, 'utf8'));
  if (workerManifest.main !== 'index.js') {
    throw new Error(`Expected ${workerWrangler} "main" to be "index.js", got "${workerManifest.main}".`);
  }
  const workerBundleSource = readFileSync(workerEntry, 'utf8');

  const expectedSha = createHash('sha256').update(readFileSync(sourceWasm)).digest('hex');
  for (const file of bundledFiles) {
    const bundledPath = resolve(workerAssetsDir, file);
    const info = await verifyWasmBinary(bundledPath);
    if (info.sha256 !== expectedSha) {
      throw new Error(
        `Bundled WASM ${bundledPath} sha256 (${info.sha256}) differs from ${sourceWasm} (${expectedSha}).`,
      );
    }
    if (!workerBundleSource.includes(file)) {
      throw new Error(
        `Bundled WASM asset ${file} is not referenced in ${workerEntry}.`,
      );
    }
    console.log(
      `[verify-bundle] Production bundle OK: dist/company_stock/assets/${file} (${info.sizeKiB} KiB, sha256=${info.sha256.slice(0, 16)}…, ABI v${info.abi}).`,
    );
  }
}

main().catch((err) => {
  console.error('[verify-bundle] ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
