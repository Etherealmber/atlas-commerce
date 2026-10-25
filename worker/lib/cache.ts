/**
 * Cache layer — KV free-tier aware (100k reads / 1k writes per day).
 *
 * Strategy:
 * 1. In-isolate memory is the primary store (0 KV cost).
 * 2. KV is used sparingly for multi-isolate sharing, with write throttling.
 * 3. Invalidate = bump gen in memory (+ at most 1 KV write / 45s).
 * 4. All KV ops are best-effort; failures never break the request.
 */

const GEN_KEY = 'cache:gen';
const DASHBOARD_BASE = 'dash';
const SETTINGS_BASE = 'settings';
const PRODUCTS_PREFIX = 'products:';

/** Default TTL (seconds). Longer = fewer refreshes. */
export const DEFAULT_CACHE_TTL = 1800; // 30 min

/** Memory store: key → { value, expMs } */
const memStore = new Map<string, { value: unknown; exp: number }>();
const MEM_MAX = 80;

let memGen: { value: number; fetchedAt: number } | null = null;
const MEM_GEN_MS = 120_000; // 2 min before re-reading gen from KV

let lastGenKvWrite = 0;
const GEN_KV_WRITE_MIN_MS = 45_000; // at most ~2 gen writes / minute

let kvReadBudget = 0;
let kvWriteBudget = 0;
let budgetWindowStart = Date.now();
/** Soft daily-ish budgets per isolate (reset every hour of isolate life) */
const KV_READ_SOFT_CAP = 800; // per hour / isolate
const KV_WRITE_SOFT_CAP = 40;

function rollBudget() {
  const now = Date.now();
  if (now - budgetWindowStart > 3_600_000) {
    kvReadBudget = 0;
    kvWriteBudget = 0;
    budgetWindowStart = now;
  }
}

function canKvRead(): boolean {
  rollBudget();
  return kvReadBudget < KV_READ_SOFT_CAP;
}

function canKvWrite(): boolean {
  rollBudget();
  return kvWriteBudget < KV_WRITE_SOFT_CAP;
}

function memGet<T>(key: string): T | null {
  const e = memStore.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) {
    memStore.delete(key);
    return null;
  }
  return e.value as T;
}

function memPut(key: string, value: unknown, ttlSeconds: number) {
  const ttl = Math.max(30, Math.min(86400, Math.floor(ttlSeconds || DEFAULT_CACHE_TTL)));
  memStore.set(key, { value, exp: Date.now() + ttl * 1000 });
  if (memStore.size > MEM_MAX) {
    // drop oldest-ish (Map insertion order)
    const first = memStore.keys().next().value;
    if (first) memStore.delete(first);
  }
}

function memDelPrefix(prefix: string) {
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot on purpose: keys are deleted during the loop
  for (const k of [...memStore.keys()]) {
    if (k.startsWith(prefix)) memStore.delete(k);
  }
}

export async function getCacheGen(kv: KVNamespace | undefined): Promise<number> {
  const now = Date.now();
  if (memGen && now - memGen.fetchedAt < MEM_GEN_MS) return memGen.value;
  if (!kv || !canKvRead()) {
    return memGen?.value || 1;
  }
  try {
    kvReadBudget++;
    const raw = await kv.get(GEN_KEY, 'text');
    const n = Math.max(1, Number(raw) || 1);
    memGen = { value: n, fetchedAt: now };
    return n;
  } catch {
    return memGen?.value || 1;
  }
}

export async function bumpCacheGen(kv: KVNamespace | undefined): Promise<void> {
  const cur = memGen?.value || 1;
  const next = cur + 1;
  memGen = { value: next, fetchedAt: Date.now() };
  // Drop versioned memory keys so this isolate sees fresh data
  memDelPrefix('dash');
  memDelPrefix('settings');
  memDelPrefix(PRODUCTS_PREFIX);
  memDelPrefix('g');

  if (!kv || !canKvWrite()) return;
  const now = Date.now();
  if (now - lastGenKvWrite < GEN_KV_WRITE_MIN_MS) return; // throttle KV writes
  try {
    kvWriteBudget++;
    lastGenKvWrite = now;
    await kv.put(GEN_KEY, String(next), { expirationTtl: 86400 * 30 });
  } catch {
    /* ignore — free tier cap or network */
  }
}

export async function kvGetJson<T>(kv: KVNamespace | undefined, key: string): Promise<T | null> {
  const hit = memGet<T>(key);
  if (hit != null) return hit;
  if (!kv || !canKvRead()) return null;
  try {
    kvReadBudget++;
    const raw = await kv.get(key, 'text');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    memPut(key, parsed, DEFAULT_CACHE_TTL);
    return parsed;
  } catch {
    return null;
  }
}

export async function kvPutJson(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const ttl = Math.max(60, Math.min(86400, Math.floor(ttlSeconds || DEFAULT_CACHE_TTL)));
  memPut(key, value, ttl);
  // Skip most KV writes under free tier — memory covers same-isolate traffic
  if (!kv || !canKvWrite()) return;
  // Only persist "heavy" shared keys to KV (dashboard / settings), not every product list variant
  const shared = key.includes('dash') || key.includes('settings') || key === GEN_KEY;
  if (!shared && kvWriteBudget > KV_WRITE_SOFT_CAP / 2) return;
  try {
    kvWriteBudget++;
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    /* ignore */
  }
}

export async function kvDel(kv: KVNamespace | undefined, key: string): Promise<void> {
  memStore.delete(key);
  // Never spend KV delete quota on free tier — rely on TTL
  void kv;
}

export async function dashboardCacheKey(kv?: KVNamespace): Promise<string> {
  const g = await getCacheGen(kv);
  return `${DASHBOARD_BASE}:g${g}`;
}

export async function settingsCacheKey(kv?: KVNamespace): Promise<string> {
  const g = await getCacheGen(kv);
  return `${SETTINGS_BASE}:g${g}`;
}

export async function productsCacheKey(kv?: KVNamespace, suffix?: string): Promise<string> {
  const g = await getCacheGen(kv);
  const s = (suffix || 'all').slice(0, 120);
  return `${PRODUCTS_PREFIX}g${g}:${s || 'all'}`;
}

/** @deprecated */
export function configCacheKey(k: string): string {
  return `cfg:${k}`;
}

export async function invalidateDashboardCache(kv: KVNamespace | undefined): Promise<void> {
  await bumpCacheGen(kv);
}

export async function invalidateAllBusinessCache(kv: KVNamespace | undefined): Promise<void> {
  await bumpCacheGen(kv);
}
