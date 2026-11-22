import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const DIST_WRANGLER = resolve(process.cwd(), 'dist/company_stock/wrangler.json');
const DIST_ASSETS = resolve(process.cwd(), 'dist/company_stock/assets');
const WASM_PATH = resolve(process.cwd(), 'worker/wasm/atlas_finance_core.wasm');
const REQUIRE_WASM = process.env.ATLAS_REQUIRE_WASM === '1';
const HAS_BUILD = existsSync(DIST_WRANGLER);
const HAS_WASM = existsSync(WASM_PATH);

const VALID_ENGINE_STATUSES = new Set([
  'wasm_active',
  'typescript_fallback',
  'wasm_initialization_failed',
  'abi_incompatible',
  'wasm_not_bundled',
]);

describe('Cloudflare Workers (workerd) Production Integration', () => {
  const workersToDispose: Array<{ dispose: () => Promise<void> }> = [];

  afterAll(async () => {
    for (const w of workersToDispose) {
      await w.dispose().catch(() => {});
    }
    workersToDispose.length = 0;
  });

  const runtimeIt = HAS_BUILD || REQUIRE_WASM ? it : it.skip;

  runtimeIt(
    'boots built production Worker in workerd, verifies /api/health finance_core status & isolate reuse',
    async () => {
      expect(
        existsSync(DIST_WRANGLER),
        `Built Worker bundle missing at ${DIST_WRANGLER}. Run "npm run build" first.`,
      ).toBe(true);

      const { unstable_startWorker } = await import('wrangler');
      const w = await unstable_startWorker({
        config: DIST_WRANGLER,
        dev: { server: { port: 0 }, inspector: false },
      });
      workersToDispose.push(w);

      const r1 = await w.fetch('http://localhost/api/health');
      expect(r1.status).toBe(200);
      const j1 = (await r1.json()) as {
        success: boolean;
        data: {
          ok: boolean;
          d1: boolean;
          kv: boolean;
          r2: boolean;
          finance_core: {
            contract_version: string;
            engine: string;
            status: string;
            abi_version: number | null;
            wasm_bundled: boolean;
            exports_verified: boolean;
            initError?: unknown;
          };
        };
      };

      expect(j1.success).toBe(true);
      expect(j1.data.ok).toBe(true);
      expect(j1.data.d1).toBe(true);
      expect(VALID_ENGINE_STATUSES.has(j1.data.finance_core.status)).toBe(true);
      // Never leak raw internal error/stack details in public /api/health
      expect(j1.data.finance_core).not.toHaveProperty('initError');

      if (HAS_WASM || REQUIRE_WASM) {
        const assets = existsSync(DIST_ASSETS) ? readdirSync(DIST_ASSETS) : [];
        const bundledFinanceWasm = assets.some((f) => f.includes('atlas_finance_core') && f.endsWith('.wasm'));
        expect(bundledFinanceWasm).toBe(true);
        expect(j1.data.finance_core).toEqual({
          contract_version: '1.0.0',
          engine: 'wasm',
          status: 'wasm_active',
          abi_version: 2,
          wasm_bundled: true,
          exports_verified: true,
        });
      } else {
        expect(j1.data.finance_core.status).toBe('wasm_not_bundled');
        expect(j1.data.finance_core.engine).toBe('ts-mirror');
        expect(j1.data.finance_core.wasm_bundled).toBe(false);
      }

      // Second request in same workerd isolate confirms reuse and stability
      const r2 = await w.fetch('http://localhost/api/health');
      expect(r2.status).toBe(200);
      const j2 = (await r2.json()) as { data: { finance_core: unknown } };
      expect(j2.data.finance_core).toEqual(j1.data.finance_core);
    },
    30_000,
  );

  runtimeIt(
    'enforces FINANCE_REQUIRE_WASM fail-closed 503 on /api/* while keeping /api/health responsive in workerd',
    async () => {
      if (HAS_WASM) {
        // When compiled WASM IS bundled, verify FINANCE_REQUIRE_WASM=true keeps /api/health 200 and does NOT 503.
        const { unstable_startWorker } = await import('wrangler');
        const w = await unstable_startWorker({
          config: DIST_WRANGLER,
          bindings: { FINANCE_REQUIRE_WASM: { type: 'plain_text', value: 'true' } },
          dev: { server: { port: 0 }, inspector: false },
        });
        workersToDispose.push(w);

        const healthRes = await w.fetch('http://localhost/api/health');
        expect(healthRes.status).toBe(200);
        const healthBody = (await healthRes.json()) as { data: { finance_core: { status: string } } };
        expect(healthBody.data.finance_core.status).toBe('wasm_active');

        const protectedRes = await w.fetch('http://localhost/api/invoices');
        expect(protectedRes.status).toBe(401); // Passed finance engine gate cleanly to auth
        return;
      }

      // When WASM is not bundled, FINANCE_REQUIRE_WASM=true MUST fail closed with 503 on /api/* while /api/health stays 200
      const { unstable_startWorker } = await import('wrangler');
      const w = await unstable_startWorker({
        config: DIST_WRANGLER,
        bindings: { FINANCE_REQUIRE_WASM: { type: 'plain_text', value: 'true' } },
        dev: { server: { port: 0 }, inspector: false },
      });
      workersToDispose.push(w);

      const healthRes = await w.fetch('http://localhost/api/health');
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { data: { finance_core: { status: string } } };
      expect(healthBody.data.finance_core.status).toBe('wasm_not_bundled');

      const blockedRes = await w.fetch('http://localhost/api/invoices');
      expect(blockedRes.status).toBe(503);
      const blockedBody = (await blockedRes.json()) as {
        success: boolean;
        code: string;
        error: string;
        finance_core: { status: string; initError?: unknown };
      };
      expect(blockedBody.success).toBe(false);
      expect(blockedBody.code).toBe('FINANCE_ENGINE_UNAVAILABLE');
      expect(blockedBody.error).toBe('FINANCE_WASM_REQUIRED');
      expect(blockedBody.finance_core).not.toHaveProperty('initError');
    },
    30_000,
  );

  runtimeIt(
    'supports intentional TypeScript fallback mode in workerd when FINANCE_ENGINE_MODE=ts-fallback',
    async () => {
      const { unstable_startWorker } = await import('wrangler');
      const w = await unstable_startWorker({
        config: DIST_WRANGLER,
        bindings: { FINANCE_ENGINE_MODE: { type: 'plain_text', value: 'ts-fallback' } },
        dev: { server: { port: 0 }, inspector: false },
      });
      workersToDispose.push(w);

      // Directly hitting /api/health as the first request must report typescript_fallback
      const healthRes = await w.fetch('http://localhost/api/health');
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { data: { finance_core: { status: string; engine: string } } };
      expect(healthBody.data.finance_core.status).toBe('typescript_fallback');
      expect(healthBody.data.finance_core.engine).toBe('ts-mirror');

      // Protected endpoints also operate normally in intentional TS fallback mode
      const apiRes = await w.fetch('http://localhost/api/invoices');
      expect(apiRes.status).toBe(401);
    },
    30_000,
  );
});
