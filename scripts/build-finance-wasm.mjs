#!/usr/bin/env node
/**
 * Builds `rust/atlas-finance-core` for `wasm32-unknown-unknown` in release mode,
 * copies the compiled `.wasm` artifact to `worker/wasm/atlas_finance_core.wasm`,
 * and verifies ABI v2 + zero imports + all 19 exports + memory safety + precision smoke checks.
 *
 * Features:
 *   - Toolchain verification (auto-installs via rustup in Cloudflare Workers Builds / CI)
 *   - Content-addressed caching (`worker/wasm/.finance-wasm-build.json`) skipping
 *     unnecessary Rust recompilation when sources and Rust 1.82.0 toolchain are unchanged
 *   - Mandatory binary verification on every run (even on cache hit)
 *
 * Flags:
 *   --strict      Fail non-zero if Rust toolchain cannot be verified/installed (default in npm scripts)
 *   --check-only  Skip compilation and verify existing `worker/wasm/atlas_finance_core.wasm`
 *   --force       Ignore build cache and force `cargo test` + `cargo build`
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRustWasmToolchain, isAutomatedBuildEnv } from './ensure-rust-wasm-toolchain.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const crateDir = resolve(rootDir, 'rust/atlas-finance-core');
const manifestPath = resolve(crateDir, 'Cargo.toml');
const targetWasm = resolve(crateDir, 'target/wasm32-unknown-unknown/release/atlas_finance_core.wasm');
const outWasm = resolve(rootDir, 'worker/wasm/atlas_finance_core.wasm');
const cacheStampPath = resolve(rootDir, 'worker/wasm/.finance-wasm-build.json');

const strict = process.argv.includes('--strict');
const checkOnly = process.argv.includes('--check-only');
const forceRebuild = process.argv.includes('--force') || process.env.ATLAS_FORCE_WASM_REBUILD === '1';

const REQUIRED_EXPORTS = [
  'memory',
  'fc_abi_version',
  'fc_alloc',
  'fc_dealloc',
  'fc_round2',
  'fc_round_dh',
  'fc_round6',
  'fc_round_with_mode',
  'fc_is_valid_ymd',
  'fc_classify_doc_state',
  'fc_classify_doc_remaining',
  'fc_days_between',
  'fc_compute_payroll',
  'fc_compute_refund_split',
  'fc_compute_invoice_batch',
  'fc_apply_bulk_discount',
  'fc_validate_credit_prefix',
  'fc_validate_next_credit_number',
  'fc_validate_period',
];

function collectRustInputs(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRustInputs(full));
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      files.push(full);
    }
  }
  return files;
}

function computeBuildFingerprint(rustcVer) {
  const hash = createHash('sha256');
  const trackedFiles = [
    resolve(rootDir, 'rust-toolchain.toml'),
    resolve(crateDir, 'Cargo.toml'),
    ...(existsSync(resolve(crateDir, 'Cargo.lock')) ? [resolve(crateDir, 'Cargo.lock')] : []),
    resolve(rootDir, 'scripts/build-finance-wasm.mjs'),
    ...collectRustInputs(resolve(crateDir, 'src')),
  ];
  hash.update(`rustc:${rustcVer}\n`);
  for (const file of trackedFiles) {
    hash.update(`file:${file.replace(rootDir, '')}\n`);
    hash.update(readFileSync(file));
    hash.update('\n');
  }
  return hash.digest('hex');
}

export async function verifyWasmBinary(wasmPath) {
  const bytes = readFileSync(wasmPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const mod = await WebAssembly.compile(bytes);

  const imports = WebAssembly.Module.imports(mod);
  if (imports.length > 0) {
    throw new Error(`Unexpected WASM imports detected: ${imports.map((i) => `${i.module}.${i.name}`).join(', ')}`);
  }

  const instance = await WebAssembly.instantiate(mod, {});
  const exportsObj = instance.exports;

  const missing = REQUIRED_EXPORTS.filter((name) => {
    if (name === 'memory') return !(exportsObj.memory instanceof WebAssembly.Memory);
    return typeof exportsObj[name] !== 'function';
  });
  if (missing.length > 0) {
    throw new Error(`Missing required WASM ABI exports: ${missing.join(', ')}`);
  }

  const abi = Number(exportsObj.fc_abi_version());
  if (abi !== 2) {
    throw new Error(`Unexpected WASM ABI version: expected 2, got ${abi}`);
  }

  // Immediate deterministic IEEE-754 + memory alloc/dealloc + overlap + error-code checks
  const r35 = exportsObj.fc_round2(35.855);
  if (r35 !== 35.86) throw new Error(`fc_round2(35.855) failed: expected 35.86, got ${r35}`);
  const rDh = exportsObj.fc_round_dh(0.49999999999999994);
  if (rDh !== 0) throw new Error(`fc_round_dh(0.49999999999999994) failed: expected 0, got ${rDh}`);
  const rBig = exportsObj.fc_round2(1e307);
  if (!Number.isFinite(rBig)) throw new Error(`fc_round2(1e307) overflowed to non-finite ${rBig}`);
  if (exportsObj.fc_is_valid_ymd(2026, 2, 31) !== 0) throw new Error('fc_is_valid_ymd accepted invalid 2026-02-31');
  if (exportsObj.fc_is_valid_ymd(2024, 2, 29) !== 1) throw new Error('fc_is_valid_ymd rejected leap 2024-02-29');
  if (exportsObj.fc_validate_credit_prefix(0, 3) >= 0) throw new Error('fc_validate_credit_prefix(null) did not return negative error code');
  if (exportsObj.fc_alloc(0) !== 0) throw new Error('fc_alloc(0) must return null pointer');

  const inPtr = exportsObj.fc_alloc(48);
  const outPtr = exportsObj.fc_alloc(112);
  if (!inPtr || !outPtr) throw new Error('fc_alloc returned null pointer');
  try {
    if ((inPtr % 8) !== 0 || (outPtr % 8) !== 0) {
      throw new Error(`fc_alloc returned unaligned pointers (${inPtr}, ${outPtr})`);
    }
    new Float64Array(exportsObj.memory.buffer, inPtr, 6).set([2, 120, 120, 20, 1, 1]);
    const rc = exportsObj.fc_compute_invoice_batch(inPtr, 1, outPtr, 20, 0, 0, 1, 0);
    if (rc !== 0) throw new Error(`fc_compute_invoice_batch returned error ${rc}`);
    const out = new Float64Array(exportsObj.memory.buffer, outPtr, 14);
    if (out[11] !== 200 || out[12] !== 40 || out[13] !== 240) {
      throw new Error(`fc_compute_invoice_batch unexpected totals: [${out[11]}, ${out[12]}, ${out[13]}]`);
    }
    // Verify aliasing/overlap guard rejects overlapping inPtr/outPtr
    const overlapRc = exportsObj.fc_compute_invoice_batch(inPtr, 1, inPtr, 20, 0, 0, 1, 0);
    if (overlapRc >= 0) throw new Error(`fc_compute_invoice_batch allowed overlapping pointers (${overlapRc})`);
  } finally {
    exportsObj.fc_dealloc(inPtr, 48);
    exportsObj.fc_dealloc(outPtr, 112);
  }

  const sizeKiB = (statSync(wasmPath).size / 1024).toFixed(2);
  return { sha256, abi, sizeKiB };
}

async function main() {
  if (!checkOnly) {
    let toolchain;
    try {
      toolchain = await ensureRustWasmToolchain({
        autoInstall: process.argv.includes('--install') || isAutomatedBuildEnv(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (strict) {
        console.error('[finance-wasm] ERROR:', msg);
        process.exit(1);
      }
      console.warn('[finance-wasm] WARN:', msg);
      if (existsSync(outWasm)) {
        const info = await verifyWasmBinary(outWasm);
        console.log(`[finance-wasm] Verified existing ${outWasm} (${info.sizeKiB} KiB, sha256=${info.sha256.slice(0, 16)}…, ABI v${info.abi}).`);
      }
      return;
    }

    const fingerprint = computeBuildFingerprint(toolchain.rustcVer);
    if (!forceRebuild && existsSync(outWasm) && existsSync(cacheStampPath)) {
      try {
        const stamp = JSON.parse(readFileSync(cacheStampPath, 'utf8'));
        const actualSha = createHash('sha256').update(readFileSync(outWasm)).digest('hex');
        if (stamp.fingerprint === fingerprint && stamp.wasmSha256 === actualSha) {
          const info = await verifyWasmBinary(outWasm);
          console.log(
            `[finance-wasm] Cache hit (unchanged Rust sources & ${toolchain.channel}) — verified ${outWasm} (${info.sizeKiB} KiB, sha256=${info.sha256.slice(0, 16)}…, ABI v${info.abi}).`,
          );
          return;
        }
      } catch {
        // Fall through to full rebuild on corrupt cache stamp
      }
    }

    // Cache miss or forced rebuild: remove any stale .wasm / stamp so a failed build never leaves stale artifacts
    rmSync(outWasm, { force: true });
    rmSync(cacheStampPath, { force: true });

    console.log('[finance-wasm] Running Rust unit & ABI tests...');
    execSync(`cargo test --manifest-path "${manifestPath}"`, { stdio: 'inherit', cwd: rootDir });

    console.log('[finance-wasm] Building wasm32-unknown-unknown --release...');
    execSync(
      `cargo build --manifest-path "${manifestPath}" --target wasm32-unknown-unknown --release`,
      { stdio: 'inherit', cwd: rootDir },
    );

    if (!existsSync(targetWasm)) {
      throw new Error(`Expected compiled WASM artifact at ${targetWasm}, but it was not produced.`);
    }

    mkdirSync(dirname(outWasm), { recursive: true });
    copyFileSync(targetWasm, outWasm);

    let info;
    try {
      info = await verifyWasmBinary(outWasm);
    } catch (err) {
      rmSync(outWasm, { force: true });
      rmSync(cacheStampPath, { force: true });
      throw err;
    }
    writeFileSync(
      cacheStampPath,
      JSON.stringify(
        {
          fingerprint,
          rustcVersion: toolchain.rustcVer,
          wasmSha256: info.sha256,
          abiVersion: info.abi,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(
      `[finance-wasm] Built & verified ${outWasm} (${info.sizeKiB} KiB, sha256=${info.sha256.slice(0, 16)}…, ABI v${info.abi}, 0 imports, ${REQUIRED_EXPORTS.length} exports OK).`,
    );
    return;
  }

  if (!existsSync(outWasm)) {
    throw new Error(`WASM artifact missing at ${outWasm}`);
  }
  const info = await verifyWasmBinary(outWasm);
  console.log(
    `[finance-wasm] Verified ${outWasm} (${info.sizeKiB} KiB, sha256=${info.sha256.slice(0, 16)}…, ABI v${info.abi}, 0 imports, ${REQUIRED_EXPORTS.length} exports OK).`,
  );
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error('[finance-wasm] ERROR:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
