/**
 * Worker-facing entry point for the Atlas Commerce Financial Core.
 *
 * When `worker/wasm/atlas_finance_core.wasm` is compiled and present at build time,
 * `@cloudflare/vite-plugin` bundles it as a static `CompiledWasm` `WebAssembly.Module`.
 * We instantiate it once per Worker isolate synchronously, verify zero unexpected imports,
 * ABI v2, and every required export, and fail closed if the bundled module is corrupt/incompatible
 * or if `FINANCE_REQUIRE_WASM === 'true'` is configured without an active WASM instance.
 */
import {
  detachFinanceWasm,
  getFinanceCoreStats,
  initFinanceWasmFromModule,
  isFinanceWasmActive,
  markFinanceWasmBundled,
  markIntentionalTsFallback,
} from '../../shared/financeCore';

export * from '../../shared/financeCore';

type WasmModuleMap = Record<string, { default?: WebAssembly.Module } | WebAssembly.Module>;

let initialized = false;
let loggedOutcome = false;
let wasDetachedForFallback = false;

function loadBundledWasmModules(): WasmModuleMap {
  try {
    return import.meta.glob('../wasm/atlas_finance_core.wasm', {
      eager: true,
      import: 'default',
    }) as WasmModuleMap;
  } catch {
    return {};
  }
}

const bundledWasmModules: WasmModuleMap = loadBundledWasmModules();

function resolveBundledWasmModule(): WebAssembly.Module | null {
  const values = Object.values(bundledWasmModules);
  if (!values.length) return null;
  const entry = values[0];
  if (entry instanceof WebAssembly.Module) return entry;
  if (entry && typeof entry === 'object' && entry.default instanceof WebAssembly.Module) {
    return entry.default;
  }
  return null;
}

export function initWorkerFinanceWasm(): ReturnType<typeof getFinanceCoreStats> {
  if (initialized && !wasDetachedForFallback) return getFinanceCoreStats();
  initialized = true;
  wasDetachedForFallback = false;
  markIntentionalTsFallback(false);
  const mod = resolveBundledWasmModule();
  if (!mod) {
    markFinanceWasmBundled(false);
    detachFinanceWasm('wasm-artifact-absent');
    return getFinanceCoreStats();
  }
  markFinanceWasmBundled(true);
  const ok = initFinanceWasmFromModule(mod);
  const stats = getFinanceCoreStats();
  if (!ok && !loggedOutcome) {
    loggedOutcome = true;
    console.error('[finance-core] Bundled WASM failed verification', {
      status: stats.status,
      code: stats.initError ? stats.initError.split(':')[0] : 'UNKNOWN',
    });
  }
  return stats;
}

/**
 * Verifies the active finance engine at request time:
 * - If a `.wasm` binary WAS bundled (`wasmBundled === true`) but failed instantiation
 *   or ABI/export checks, fail closed (`ok: false`) so a partial/broken ABI is never silently masked.
 * - If `env.FINANCE_REQUIRE_WASM === 'true'` and WASM is not active, fail closed (`ok: false`).
 * - If running in `ENVIRONMENT === 'production'` without a bundled `.wasm` artifact,
 *   emit a single isolate warning so fallback is observable in logs & `/api/health`.
 */
export function verifyWorkerFinanceEngine(env?: {
  ENVIRONMENT?: string;
  FINANCE_REQUIRE_WASM?: string;
  FINANCE_ENGINE_MODE?: string;
}): { ok: true } | { ok: false; error: string; stats: ReturnType<typeof getFinanceCoreStats> } {
  if (env?.FINANCE_ENGINE_MODE === 'ts-fallback' && env?.FINANCE_REQUIRE_WASM !== 'true') {
    if (isFinanceWasmActive()) {
      detachFinanceWasm(null);
    }
    wasDetachedForFallback = true;
    markIntentionalTsFallback(true);
    return { ok: true };
  }
  const stats = initWorkerFinanceWasm();
  if (stats.wasmBundled && !stats.requiredExportsVerified) {
    return {
      ok: false,
      error: stats.status === 'abi_incompatible' ? 'FINANCE_WASM_ABI_INCOMPATIBLE' : 'FINANCE_WASM_INIT_FAILED',
      stats,
    };
  }
  if (env?.FINANCE_REQUIRE_WASM === 'true' && !isFinanceWasmActive()) {
    return {
      ok: false,
      error: 'FINANCE_WASM_REQUIRED',
      stats,
    };
  }
  if (env?.ENVIRONMENT === 'production' && !isFinanceWasmActive() && !loggedOutcome) {
    loggedOutcome = true;
    console.warn('[finance-core] Running TS mirror engine in production', {
      status: stats.status,
      wasmBundled: stats.wasmBundled,
    });
  }
  return { ok: true };
}

export function getWorkerFinanceHealthStats(env?: {
  ENVIRONMENT?: string;
  FINANCE_REQUIRE_WASM?: string;
  FINANCE_ENGINE_MODE?: string;
}): ReturnType<typeof getFinanceCoreStats> {
  verifyWorkerFinanceEngine(env);
  return getFinanceCoreStats();
}

export function resetWorkerFinanceWasmForTest(opts?: { intentionalFallback?: boolean }): void {
  initialized = false;
  loggedOutcome = false;
  wasDetachedForFallback = false;
  markFinanceWasmBundled(false);
  detachFinanceWasm(opts?.intentionalFallback ? 'intentional-ts-fallback' : null);
  if (opts?.intentionalFallback) {
    markIntentionalTsFallback(true);
  }
}
