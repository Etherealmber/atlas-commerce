/**
 * Builds the isolated environment a demo request runs with.
 *
 * Allow-list approach: only plain, non-secret configuration and the bindings
 * the app needs are carried over. Every shared resource is either removed
 * (KV cache, second D1, e-mail, SMS, AI, release tokens…) or namespaced to the
 * sandbox (Durable Object hubs, R2 keys), so demo traffic can never read or
 * change production data, counters or notifications.
 */
import type { Env } from '../../env';
import { DEMO_PASSWORD, DEMO_USERNAME } from './policy';

/** Non-secret `vars` copied as-is (see wrangler.jsonc). */
const SAFE_VARS = [
  'ENVIRONMENT',
  'CACHE_TTL_SECONDS',
  'WEBAUTHN_ENABLED',
  'WEBAUTHN_RP_ID',
  'WEBAUTHN_RP_NAME',
  'WEBAUTHN_ALLOWED_ORIGINS',
  'WEBAUTHN_REQUIRE_UV',
  'WEBAUTHN_ANDROID_PACKAGE',
  'WEBAUTHN_ANDROID_CERT_HASH',
  'WEBAUTHN_ANDROID_CERT_SHA1',
  'FINANCE_REQUIRE_WASM',
  'FINANCE_ENGINE_MODE',
  'REPORT_TICKET_TTL_SECONDS',
] as const;

/** Durable Object hubs, re-keyed per sandbox (counters, realtime, quotas…). */
const HUBS = ['MOBILE_HUB', 'RESTORE_HUB', 'NUMBER_HUB', 'AGENT_QUOTA_HUB'] as const;

export function namespacedDurableObjects(ns: DurableObjectNamespace, prefix: string): DurableObjectNamespace {
  const wrapped = {
    idFromName: (name: string) => ns.idFromName(`${prefix}${name}`),
    idFromString: (id: string) => ns.idFromString(id),
    newUniqueId: (opts?: unknown) => (ns as any).newUniqueId(opts),
    get: (id: DurableObjectId, opts?: unknown) => (ns as any).get(id, opts),
    getByName: (name: string, opts?: unknown) => (ns as any).get(ns.idFromName(`${prefix}${name}`), opts),
    jurisdiction: () => wrapped,
  };
  return wrapped as unknown as DurableObjectNamespace;
}

function wrapObject<T extends object>(obj: T, prefix: string): T {
  if (!obj || typeof obj !== 'object') return obj;
  return new Proxy(obj, {
    get(target, prop) {
      if (prop === 'key') {
        const k = String((target as any).key || '');
        return k.startsWith(prefix) ? k.slice(prefix.length) : k;
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/** R2 bucket view restricted to `prefix` (keys are rewritten both ways). */
export function prefixedBucket(bucket: R2Bucket, prefix: string): R2Bucket {
  const k = (key: string) => `${prefix}${String(key || '').replace(/^\/+/, '')}`;
  const view = {
    head: async (key: string) => wrapObject((await bucket.head(k(key))) as any, prefix),
    get: async (key: string, opts?: any) => wrapObject((await bucket.get(k(key), opts)) as any, prefix),
    put: async (key: string, value: any, opts?: any) => wrapObject((await bucket.put(k(key), value, opts)) as any, prefix),
    delete: async (keys: string | string[]) => bucket.delete(Array.isArray(keys) ? keys.map(k) : k(keys)),
    list: async (opts: any = {}) => {
      const res: any = await bucket.list({ ...opts, prefix: k(opts?.prefix || ''), startAfter: opts?.startAfter ? k(opts.startAfter) : undefined });
      return {
        ...res,
        objects: (res.objects || []).map((o: any) => wrapObject(o, prefix)),
        delimitedPrefixes: (res.delimitedPrefixes || []).map((p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p)),
      };
    },
    createMultipartUpload: (key: string, opts?: any) => (bucket as any).createMultipartUpload(k(key), opts),
    resumeMultipartUpload: (key: string, id: string) => (bucket as any).resumeMultipartUpload(k(key), id),
  };
  return view as unknown as R2Bucket;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildDemoEnv(env: Env, db: D1Database, sandboxKey: string): Promise<Env> {
  const demo: Record<string, unknown> = {};
  for (const name of SAFE_VARS) {
    const v = (env as any)[name];
    if (typeof v === 'string') demo[name] = v;
  }
  demo.ASSETS = env.ASSETS;
  demo.DB = db;
  for (const hub of HUBS) {
    const ns = (env as any)[hub];
    if (ns) demo[hub] = namespacedDurableObjects(ns, `demo:${sandboxKey}:`);
  }
  if (env.IMAGES) demo.IMAGES = prefixedBucket(env.IMAGES, `demo/${sandboxKey}/`);
  // The sandbox owner logs in with test / test. The session-signing secret is
  // derived from the real one so demo tokens can never validate in production.
  demo.ADMIN_USERNAME = DEMO_USERNAME;
  demo.ADMIN_PASSWORD = DEMO_PASSWORD;
  demo.JWT_SECRET = await sha256Hex(`atlas-demo-session|${env.JWT_SECRET || env.ADMIN_PASSWORD || 'local'}`);
  demo.OTP_FROM = 'demo@atlas.invalid';
  demo.OTP_TO = 'demo@atlas.invalid';
  demo.ATLAS_DEMO = '1';
  return demo as unknown as Env;
}
