/**
 * API call journal (« Journal des appels API »).
 *
 * Eligible /api/* calls, including failures, are written to `api_log` after the
 * response is sent (ctx.waitUntil, so it never slows a request). Each row
 * keeps what Cloudflare already knows about the caller: country, city,
 * region, ASN and network operator. No third-party geo-IP lookup is needed.
 * That network data also lets us flag VPN, proxy and hosting traffic, like
 * Grabify does.
 *
 * Retention: 30 days max, for both `api_log` and `audit_log`. A purge runs
 * at most once an hour per isolate, and also from the 12 h cron backup job.
 *
 * Free-tier budget: a single INSERT per call, plus 2 indexes. Health probes,
 * static polling and demo-sandbox traffic are skipped (demo data stays out of
 * the real database).
 */
import { schemaOnceForDb } from './schema';

export const API_LOG_RETENTION_DAYS = 30;

export type NetworkKind = 'vpn' | 'proxy' | 'tor' | 'hosting' | 'mobile' | 'residential' | 'unknown';

export type ApiLogGeo = {
  country: string | null;
  city: string | null;
  region: string | null;
  asn: number | null;
  as_org: string | null;
};

export type ApiLogRow = ApiLogGeo & {
  method: string;
  path: string;
  status: number;
  ms: number;
  username: string | null;
  role: string | null;
  ip: string | null;
  ua: string | null;
  request_id: string | null;
  surface: string | null;
};

/** Paths never journaled: probes and high-frequency polling. */
const SKIP_PATH = /^\/api\/(?:health|canary|ping|version)(?:\/|$)|^\/api\/mobile\/(?:snake-score|preferences)$|^\/api\/qr-login\/[^/]+\/poll$|\/events\/stream$/;

export function shouldLogApiCall(path: string, authHeader: string | undefined | null): boolean {
  if (!path.startsWith('/api/')) return false;
  if (SKIP_PATH.test(path)) return false;
  // The demo sandbox has its own database; its traffic must not leak into the
  // real journal.
  if (String(authHeader || '').includes('atlasdemo.')) return false;
  return true;
}

/** Repeated pending QR status reads are not security state changes. Keep every
 * failure, mutation, malformed response and non-pending status in the journal. */
export async function isIdleQrPoll(method: string, path: string, status: number, response: Response): Promise<boolean> {
  if (method.toUpperCase() !== 'GET' || status !== 200 || !/^\/api\/auth\/qr\/session\/[^/]+$/.test(path)) return false;
  try {
    const body = await response.clone().json() as any;
    return body?.success === true && body?.data?.status === 'pending' && !body?.data?.has_device;
  } catch { return false; }
}

/** What Cloudflare attaches to `request.cf`. All fields are optional. */
export function geoFromCf(cf: unknown): ApiLogGeo {
  const o = (cf && typeof cf === 'object' ? cf : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const asn = Number(o.asn);
  return {
    country: str(o.country, 2),
    city: str(o.city),
    region: str(o.region),
    asn: Number.isFinite(asn) && asn > 0 ? asn : null,
    as_org: str(o.asOrganization, 120),
  };
}

const VPN_ORG = /\b(nord ?vpn|express ?vpn|surfshark|proton ?(?:vpn|ag)?|mullvad|private internet access|\bpia\b|cyberghost|ipvanish|windscribe|hide\.?me|tunnelbear|purevpn|hotspot shield|vypr|torguard|astrill|perfect privacy|ovpn|airvpn|ivpn|cloudflare warp|zenmate|atlas ?vpn|psiphon|ultrasurf|hola|urban ?vpn|v2ray|outline)\b/i;
const PROXY_ORG = /\b(proxy|bright ?data|luminati|oxylabs|smartproxy|iproyal|soax|netnut|packetstream|storm ?proxies|webshare|geonode|rayobyte|922 ?s5|zenrows|scraperapi)\b/i;
const TOR_ORG = /\b(tor exit|torservers|tor project|emerald onion|calyx|nos oignons|for privacy net|artikel10)\b/i;
const HOSTING_ORG = /\b(m247|datacamp|cdn77|leaseweb|ovh|hetzner|digitalocean|linode|akamai connected cloud|vultr|choopa|contabo|scaleway|online s\.?a\.?s|amazon|aws|google (?:llc|cloud)|microsoft|azure|oracle|alibaba|tencent|huawei cloud|ionos|hostinger|godaddy|namecheap|hostwinds|psychz|quadranet|colocrossing|buyvm|frantech|g-core|gcore|zenlayer|cogent|hurricane electric|servers\.com|worldstream|i3d|nforce|serverius|kamatera|upcloud|time4vps|hostroyale|packethub|tzulo|clouvider|performive|creanova|fdcservers|cloudflare|fastly|stackpath|incapsula|data ?cent(?:er|re)|hosting|server|cloud|vps|colo)\b/i;
const MOBILE_ORG = /\b(maroc telecom|itissalat al-maghrib|iam\b|orange|inwi|wana|meditel|vodafone|t-mobile|verizon wireless|at&t mobility|mobile|cellular|wireless|lte|4g|5g|telefonica|movistar|airtel|jio|mtn|safaricom|etisalat|du\b|stc\b|mobily|zain|ooredoo|djezzy|mobilis)\b/i;

/** Hosting / anonymiser ASNs that do not always carry an obvious name. */
const HOSTING_ASN = new Set([
  9009, 16276, 24940, 14061, 63949, 20473, 51167, 16509, 14618, 15169, 396982, 8075, 31898, 45102, 60068, 212238, 136787, 202425,
  60781, 28753, 62240, 3223, 53667, 36352, 46562, 29802, 8100, 174, 6939, 13335, 54113, 209, 23470, 50673, 49981, 43350, 141039, 147049,
]);
const VPN_ASN = new Set([
  212238, // Datacamp (NordVPN, Surfshark exits)
  9009, // M247 (many commercial VPNs)
  136787, // TEFINCOM (NordVPN)
  209854, // Surfshark
  39351, // 31173 Services (Mullvad)
  62041, // ProtonVPN / Proton AG
  207137, // PacketHub (ExpressVPN, IPVanish)
  147049, // PacketHub
  13335, // Cloudflare (WARP / iCloud Private Relay egress)
]);

export type NetworkVerdict = { kind: NetworkKind; label: string; risky: boolean };

/**
 * Best-effort classification from the ASN and operator name, the same
 * signals Grabify shows. It is a heuristic. « hosting » means the call came
 * from a data centre: a VPN, a proxy, a bot or a server-side integration.
 */
/** Loopback / private / link-local ranges never carry geo data. */
export function isPrivateIp(ip: string | null | undefined): boolean {
  const v = String(ip || '').trim().toLowerCase();
  if (!v) return false;
  if (v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
  const m = /^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/.exec(v);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function classifyNetwork(asOrg: string | null | undefined, asn?: number | null, ip?: string | null): NetworkVerdict {
  const org = String(asOrg || '').trim();
  const n = Number(asn) || 0;
  if (!org && !n && isPrivateIp(ip)) return { kind: 'unknown', label: 'Réseau local', risky: false };
  if (!org && !n) return { kind: 'unknown', label: 'Inconnu', risky: false };
  if (TOR_ORG.test(org)) return { kind: 'tor', label: 'Tor', risky: true };
  if (VPN_ORG.test(org) || VPN_ASN.has(n)) return { kind: 'vpn', label: 'VPN', risky: true };
  if (PROXY_ORG.test(org)) return { kind: 'proxy', label: 'Proxy', risky: true };
  if (HOSTING_ASN.has(n) || HOSTING_ORG.test(org)) return { kind: 'hosting', label: 'Hébergeur / VPN probable', risky: true };
  if (MOBILE_ORG.test(org)) return { kind: 'mobile', label: 'Réseau mobile', risky: false };
  return { kind: 'residential', label: 'Fournisseur d’accès', risky: false };
}

export async function ensureApiLogTable(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'api_log_v1', async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS api_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      ms INTEGER NOT NULL DEFAULT 0,
      username TEXT,
      role TEXT,
      ip TEXT,
      country TEXT,
      city TEXT,
      region TEXT,
      asn INTEGER,
      as_org TEXT,
      ua TEXT,
      request_id TEXT,
      surface TEXT
    )`).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_api_log_created ON api_log(created_at)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_api_log_ip ON api_log(ip, id)').run();
  });
}

/** Collapse ids so paths group well: /api/invoices/62 → /api/invoices/:id. */
export function normalizeApiPath(path: string): string {
  return path
    .split('?')[0]
    .slice(0, 160)
    .replace(/(\/api\/auth\/qr\/session\/)[^/]+/i, '$1:token')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:token');
}

export async function writeApiLog(db: D1Database, row: ApiLogRow): Promise<void> {
  try {
    await ensureApiLogTable(db);
    await db.prepare(
      `INSERT INTO api_log (method, path, status, ms, username, role, ip, country, city, region, asn, as_org, ua, request_id, surface)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.method.slice(0, 8), normalizeApiPath(row.path), row.status | 0, Math.max(0, Math.round(row.ms)),
      row.username || null, row.role || null, row.ip || null,
      row.country, row.city, row.region, row.asn, row.as_org,
      row.ua ? row.ua.slice(0, 200) : null, row.request_id || null, row.surface || null,
    ).run();
  } catch { /* journaling must never break a request */ }
  await maybePurgeLogs(db);
}

/** Journal deletion is paused until both archives have been reconciled and
 * recovery verified. This deliberately extends D1 retention beyond 30 days;
 * callers must not interpret the zero counts as a successful retention purge. */
export async function maybePurgeLogs(_db: D1Database, _force = false): Promise<{ api: number; audit: number } | null> {
  return null;
}

export async function purgeOldLogs(_db: D1Database, _days = API_LOG_RETENTION_DAYS): Promise<{ api: number; audit: number }> {
  return { api: 0, audit: 0 };
}

/** Latest known network data for each IP (used to enrich audit rows). */
export async function geoForIps(db: D1Database, ips: string[]): Promise<Map<string, ApiLogGeo & NetworkVerdict>> {
  const out = new Map<string, ApiLogGeo & NetworkVerdict>();
  const list = [...new Set(ips.filter(Boolean))].slice(0, 100);
  if (!list.length) return out;
  try {
    await ensureApiLogTable(db);
    const marks = list.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT ip, country, city, region, asn, as_org FROM api_log
       WHERE id IN (SELECT MAX(id) FROM api_log WHERE ip IN (${marks}) AND (country IS NOT NULL OR asn IS NOT NULL) GROUP BY ip)`,
    ).bind(...list).all();
    for (const r of (results || []) as any[]) {
      const geo: ApiLogGeo = { country: r.country ?? null, city: r.city ?? null, region: r.region ?? null, asn: r.asn ?? null, as_org: r.as_org ?? null };
      out.set(String(r.ip), { ...geo, ...classifyNetwork(geo.as_org, geo.asn, String(r.ip)) });
    }
  } catch { /* enrichment is optional */ }
  return out;
}
