/**
 * v0.7 — backend-controlled minimum supported Android version.
 *
 * The policy (enabled + floor versionCode) is owned by owner/admin via
 * PUT /api/admin/app-update, persisted in `app_config` (source of truth,
 * never touched by CI release ingestion) and mirrored into the R2
 * `latest.json` manifest so the public update check can echo it without a
 * DB round-trip. Reads follow the existing order: R2 manifest first,
 * app_config fallback.
 *
 * Enforcement: Android API clients (`X-Atlas-Client: android`) that advertise
 * a version code BELOW the floor get HTTP 426 `APP_UPDATE_REQUIRED` with the
 * update payload. Clients whose version is UNKNOWN (no header — installed
 * builds predating the header) are NOT blocked (no fleet-wide lockout); they
 * are steered to the update screen by the public update check
 * (minimumVersionRequired / mandatory). Web clients, bootstrap/health and the
 * update-check / APK download routes are never blocked.
 * The version header is compatibility metadata, NOT a security credential:
 * authentication, authorization, WebAuthn and device binding stay untouched.
 */
import { pickUiLang, tr, type UiLang } from './error-i18n';

export type MinVersionPolicy = { enabled: boolean; code: number };

export const MIN_VERSION_CONFIG_KEYS = {
  enabled: 'android_min_version_enabled',
  code: 'android_min_version_code',
} as const;

/** Short TTL cache so every Android API request doesn't hit D1. */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; policy: MinVersionPolicy } | null = null;

/** Test-only: drop the TTL cache between in-process databases. */
export function resetMinVersionPolicyCacheForTests(): void {
  cache = null;
}

export function parseMinVersionPolicy(enabledRaw: unknown, codeRaw: unknown): MinVersionPolicy {
  const enabled =
    enabledRaw === true || enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 1;
  const code = Math.floor(Number(codeRaw ?? 0));
  return { enabled, code: Number.isFinite(code) && code > 0 ? code : 0 };
}

/** Policy embedded in a manifest, or null when the manifest carries none. */
export function policyFromManifest(manifest: any): MinVersionPolicy | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const has =
    'minimumVersionEnabled' in manifest || 'minimumSupportedVersionCode' in manifest;
  if (!has) return null;
  return parseMinVersionPolicy(
    manifest.minimumVersionEnabled,
    manifest.minimumSupportedVersionCode,
  );
}

export async function readMinVersionPolicy(
  db: { prepare: (sql: string) => any } | null | undefined,
  opts: { bypassCache?: boolean } = {},
): Promise<MinVersionPolicy> {
  if (!opts.bypassCache && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.policy;
  let policy: MinVersionPolicy = { enabled: false, code: 0 };
  if (db) {
    try {
      const rows = await db
        .prepare(`SELECT key, value FROM app_config WHERE key = ? OR key = ?`)
        .bind(MIN_VERSION_CONFIG_KEYS.enabled, MIN_VERSION_CONFIG_KEYS.code)
        .all();
      const map: Record<string, string> = {};
      for (const r of (rows?.results || []) as any[]) map[String(r.key)] = String(r.value || '');
      policy = parseMinVersionPolicy(
        map[MIN_VERSION_CONFIG_KEYS.enabled],
        map[MIN_VERSION_CONFIG_KEYS.code],
      );
    } catch { /* no app_config yet → policy disabled (backward compatible) */ }
  }
  cache = { at: Date.now(), policy };
  return policy;
}

export async function writeMinVersionPolicy(
  db: { prepare: (sql: string) => any },
  policy: MinVersionPolicy,
): Promise<void> {
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`)
    .run();
  await db
    .prepare(
      `INSERT INTO app_config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(MIN_VERSION_CONFIG_KEYS.enabled, policy.enabled ? '1' : '0')
    .run();
  await db
    .prepare(
      `INSERT INTO app_config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(MIN_VERSION_CONFIG_KEYS.code, String(policy.code))
    .run();
  cache = { at: Date.now(), policy };
}

/** Manifest copy of the policy (public check echoes it without a DB hit). */
export function manifestWithPolicy(manifest: any, policy: MinVersionPolicy): any {
  const base = manifest && typeof manifest === 'object' ? manifest : {};
  return {
    ...base,
    minimumVersionEnabled: policy.enabled,
    minimumSupportedVersionCode: policy.enabled ? policy.code : 0,
  };
}

/**
 * CI release ingestion must NEVER reset the admin policy: carry it from the
 * previous manifest, or from app_config when the manifest had none.
 */
export function carryPolicyIntoManifest(
  newManifest: any,
  oldManifest: any,
  dbPolicy: MinVersionPolicy | null,
): { manifest: any; policy: MinVersionPolicy } {
  const policy = policyFromManifest(oldManifest) || dbPolicy || { enabled: false, code: 0 };
  return { manifest: manifestWithPolicy(newManifest, policy), policy };
}

/** A blocking policy needs a positive floor AND a usable update to point at. */
export function validateMinVersionPolicy(policy: MinVersionPolicy, manifest: any): string | null {
  if (!policy.enabled) return null;
  if (!Number.isInteger(policy.code) || policy.code < 1) {
    return 'minimumSupportedVersionCode doit être un entier ≥ 1';
  }
  const available = Math.floor(Number(manifest?.versionCode || 0));
  if (!Number.isFinite(available) || available < 1) {
    return 'Aucune release disponible : impossible d\'activer une politique bloquante';
  }
  const apkUrl = String(manifest?.apkUrl || manifest?.apk_url || '').trim();
  if (!/^https:\/\/\S+$/i.test(apkUrl)) {
    return 'Aucune URL APK utilisable : impossible d\'activer une politique bloquante';
  }
  if (policy.code > available) {
    return `Le plancher (${policy.code}) ne peut pas dépasser la release disponible (${available})`;
  }
  return null;
}

/** Routes an outdated Android client must still reach to update itself. */
export const ANDROID_MIN_GUARD_EXEMPT = ['/api/health', '/api/app/android-update'];

export function androidClientMeta(c: any): { isAndroid: boolean; code: number | null } {
  const client = String(c.req.header('X-Atlas-Client') || '').trim().toLowerCase();
  const raw = String(c.req.header('X-Atlas-App-Version-Code') || '').trim();
  let code: number | null = null;
  if (raw !== '') {
    const parsed = Number.parseInt(raw, 10);
    code = Number.isFinite(parsed) ? parsed : null;
  }
  return { isAndroid: client === 'android', code };
}

export function updateRequiredBody(manifest: any, policy: MinVersionPolicy, lang: UiLang = 'fr') {
  return {
    success: false,
    code: 'APP_UPDATE_REQUIRED',
    error: tr(lang, 'update_required'),
    update: {
      versionCode: Math.floor(Number(manifest?.versionCode || 0)) || null,
      versionName: manifest?.versionName || manifest?.version_name || null,
      apkUrl: manifest?.apkUrl || manifest?.apk_url || null,
      minimumSupportedVersionCode: policy.code,
    },
  };
}

/**
 * Hono middleware: enforce the floor on Android API clients ONLY.
 * Version headers are compatibility metadata — never a security credential.
 */
export function androidMinVersionGuard(deps: {
  readPolicy: (db: any) => Promise<MinVersionPolicy>;
  readManifest: (env: any) => Promise<any>;
}) {
  return async (c: any, next: any) => {
    const { isAndroid, code } = androidClientMeta(c);
    if (!isAndroid) return next();
    const path = new URL(c.req.url).pathname;
    if (ANDROID_MIN_GUARD_EXEMPT.some((p) => path === p || path.startsWith(`${p}/`))) {
      return next();
    }
    let policy: MinVersionPolicy;
    try {
      policy = await deps.readPolicy(c.env?.DB);
    } catch {
      policy = { enabled: false, code: 0 };
    }
    if (!policy.enabled) return next();
    // KNOWN version at/above the floor → fine. UNKNOWN version (installed
    // builds whose OkHttp interceptor predates the version headers) must NOT
    // be hard-blocked here — that would lock out the whole current fleet the
    // moment the policy is enabled. Those builds are steered to the update
    // screen by the update check (minimumVersionRequired + mandatory), and
    // builds that DO send the header are enforced strictly below.
    if (code === null || code >= policy.code) return next();
    // Known and below the floor → update prompt.
    let manifest: any = null;
    try {
      manifest = await deps.readManifest(c.env);
    } catch { /* 426 still returned, update URLs best-effort */ }
    return c.json(updateRequiredBody(manifest, policy, pickUiLang(c.req.header('Accept-Language'))), 426);
  };
}
