// Pure helpers for the « AI issue assistant » GitHub Action (scripts/issue-ai.mjs).
// No I/O here so everything is unit-tested in src/__tests__/issue-ai-lib.test.ts.

export const TRIAGE_MARKER = '<!-- atlas-ai-triage v1 -->';
export const prLinkMarker = (pr) => `<!-- atlas-pr-link #${Number(pr)} -->`;
export const FIXED_MARKER = '<!-- atlas-fixed-by -->';

export const AREAS = ['ui', 'api', 'auth', 'demo', 'reports', 'invoices', 'stock', 'finance', 'android', 'database', 'i18n', 'other'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const STOPWORDS = new Set([
  'error', 'errors', 'typeerror', 'referenceerror', 'failed', 'execute', 'parameter', 'type', 'object', 'undefined',
  'null', 'function', 'cannot', 'read', 'properties', 'property', 'message', 'stack', 'index', 'assets', 'chunk',
  'https', 'http', 'node', 'true', 'false', 'return', 'async', 'await', 'promise', 'window', 'document', 'react',
  'anonymous', 'unknown', 'atlas', 'commerce', 'version', 'route', 'canal', 'navigateur', 'occurrences', 'beta',
  'the', 'and', 'with', 'from', 'this', 'that', 'pour', 'dans', 'avec', 'une', 'des', 'les', 'sur', 'est', 'pas',
]);

/** Redact secrets / personal data before anything leaves GitHub for the model. */
export function sanitizeForModel(text, limit = 4000) {
  let s = String(text ?? '');
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[clé privée masquée]');
  s = s.replace(/\b(gsk|ghp|gho|ghs|github_pat|sk|xox[bpas]|AKIA)[-_A-Za-z0-9]{12,}\b/g, '[secret masqué]');
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[jwt masqué]');
  s = s.replace(/\batlasdemo\.[A-Za-z0-9._~-]{16,}/g, '[jeton démo masqué]');
  s = s.replace(/([?&](?:token|rt|key|secret|password|sig)=)[^&\s)]+/gi, '$1[masqué]');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email masqué]');
  s = s.replace(/(?:\+212|0)[5-7](?:[\s.-]?\d{2}){4}\b/g, '[téléphone masqué]');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]');
  if (s.length > limit) s = `${s.slice(0, limit)}\n…[tronqué]`;
  return s;
}

/**
 * Issue numbers referenced by a PR. `closing` = GitHub closing keywords
 * (fix/close/resolve) or a branch named like `fix/123-…`, `issue-123`, `gh-123`;
 * `mentioned` = any other `#123`.
 */
export function extractIssueRefs(text, branch = '') {
  const src = String(text ?? '');
  const closing = new Set();
  const all = new Set();
  const kw = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|corrige|ferme)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*(?:,|and|et)\s*#\d+)*)/gi;
  for (const m of src.matchAll(kw)) {
    if (/^[\w.-]+\/[\w.-]+#/.test(m[1])) continue; // cross-repo reference: not ours
    for (const n of m[1].matchAll(/#(\d+)/g)) closing.add(Number(n[1]));
  }
  for (const m of src.matchAll(/(?:^|[^\w/&])#(\d{1,6})\b/g)) all.add(Number(m[1]));
  const b = String(branch ?? '');
  const bm = b.match(/(?:^|[/_-])(?:issue|issues|fix|bug|gh)[/_-]?(\d{1,6})(?:\b|[/_-])/i);
  if (bm) closing.add(Number(bm[1]));
  const mentioned = [...all].filter((n) => !closing.has(n));
  return { closing: [...closing].sort((a, b2) => a - b2), mentioned: mentioned.sort((a, b2) => a - b2) };
}

/** Candidate code identifiers to grep for (stack frames, handlers, components, files, routes). */
export function extractSearchTerms(text, max = 6) {
  const src = String(text ?? '')
    .split('\n')
    .filter((l) => !/user-agent|mozilla\/\d/i.test(l))
    .join('\n')
    .replace(/https?:\/\/\S+/g, (u) => u.replace(/[\w-]+-[A-Za-z0-9_]{6,}\.(?:js|css|mjs)(?::\d+)*/g, ''));
  const scored = new Map();
  const add = (t, w) => {
    const k = t.trim();
    if (k.length < 4 || k.length > 60) return;
    if (STOPWORDS.has(k.toLowerCase())) return;
    if (/^\d+$/.test(k) || /^[a-f0-9]{8,}$/i.test(k)) return;
    scored.set(k, (scored.get(k) || 0) + w);
  };
  for (const m of src.matchAll(/\b([A-Za-z_][\w-]*\.(?:tsx?|jsx?|mjs|css))\b/g)) {
    if (!/-[A-Za-z0-9_]{6,}\.(?:js|css|mjs)$/.test(m[1])) add(m[1], 6); // skip hashed bundle names
  }
  for (const m of src.matchAll(/\bat\s+(?:[\w$]+\.)?([A-Za-z_$][\w$]{3,})\s*\(/g)) add(m[1], 3);
  for (const m of src.matchAll(/\b(on[A-Z][A-Za-z]+|use[A-Z][A-Za-z]+)\b/g)) add(m[1], 5);
  for (const m of src.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z0-9]+)+)\b/g)) add(m[1], 4);
  for (const m of src.matchAll(/'([a-z][A-Za-z]{3,})'\s+on\s+'/g)) add(m[1], 4);
  for (const m of src.matchAll(/\b([a-z]+_[a-z_]+)\b/g)) add(m[1], 2);
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** App routes mentioned in an issue (`/employees`, `/settings?tab=audit`). */
export function extractRoutes(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/(?:^|[\s(`'"])(\/[a-z][a-z0-9-]*(?:\/[a-z0-9:-]+)*)(?=[\s?#)`'".,]|$)/gim)) {
    const r = m[1].toLowerCase();
    if (/^\/(api|assets|tmp|home|usr|src|worker|node_modules)\b/.test(r)) continue;
    out.add(r);
  }
  return [...out].slice(0, 4);
}

/** `/purchase-orders` → `PurchaseOrders` (page component naming in src/pages). */
export function routeToComponent(route) {
  const seg = String(route || '').split('/').filter(Boolean)[0] || '';
  return seg.split('-').filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
}

/** Should this issue be analysed? (bugs / crash reports only; never security, never PRs). */
export function isEligibleIssue(issue, { force = false } = {}) {
  if (!issue || issue.pull_request) return { ok: false, reason: 'not an issue' };
  if (issue.state && issue.state !== 'open') return { ok: false, reason: 'closed' };
  const labels = (issue.labels || []).map((l) => String(typeof l === 'string' ? l : l?.name || '').toLowerCase());
  if (labels.includes('security')) return { ok: false, reason: 'security issues are handled privately' };
  if (labels.includes('no-ai')) return { ok: false, reason: 'no-ai label' };
  if (force) return { ok: true, reason: 'forced' };
  const text = `${issue.title || ''}\n${issue.body || ''}`.toLowerCase();
  const buggy = labels.some((l) => l === 'bug' || l === 'crash-report')
    || /\b(bug|crash|erreur|error|exception|cassé|broken|ne (?:fonctionne|marche) (?:pas|plus)|not working|page blanche|blank page|typeerror)\b/.test(text);
  return buggy ? { ok: true, reason: 'bug' } : { ok: false, reason: 'not a bug report' };
}

export function countTriagesSince(comments, sinceIso) {
  const since = Date.parse(sinceIso);
  return (comments || []).filter((c) => String(c?.body || '').includes(TRIAGE_MARKER)
    && (!Number.isFinite(since) || Date.parse(c.created_at || 0) >= since)).length;
}

export function buildMessages({ repo, issue, snippets = [], files = [] }) {
  const system = [
    'You are a senior engineer triaging bug reports for Atlas Commerce (React 19 + Vite SPA in src/, Cloudflare Worker + Hono + D1 SQLite in worker/, Android app in a separate repo).',
    'Answer ONLY with one JSON object, no markdown fences. Keys:',
    '"title" (short French title, ≤ 80 chars), "summary" (French, 1–2 sentences), "cause" (French, probable root cause, cite identifiers),',
    '"where" (array of up to 4 repo paths, preferably from the provided files), "repro" (array of ≤ 4 short French steps),',
    '"fix" (French, concrete change), "tests" (French, how to verify / which test to add), "severity" (low|medium|high|critical),',
    `"area" (one of ${AREAS.join('|')}), "confidence" (low|medium|high), "needs_info" (French question if the report is too vague, else "").`,
    'Never invent file paths that are not plausible for this layout. Be concise.',
  ].join(' ');
  const parts = [
    `Repository: ${repo}`,
    `Issue #${issue.number}: ${sanitizeForModel(issue.title, 200)}`,
    `Labels: ${(issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).join(', ') || '—'}`,
    '--- Issue body ---',
    sanitizeForModel(issue.body || '(vide)', 3500),
  ];
  if (files.length) parts.push('--- Candidate files ---', files.slice(0, 8).join('\n'));
  if (snippets.length) {
    parts.push('--- Code excerpts (current main) ---');
    let budget = 4200;
    for (const s of snippets) {
      const block = `# ${s.path}:${s.line}\n${s.text}`;
      if (block.length > budget) break;
      parts.push(block);
      budget -= block.length;
    }
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n') },
  ];
}

/** Lenient JSON extraction + normalisation of the model answer. */
export function parseTriage(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let obj = null;
  try { obj = JSON.parse(raw); } catch {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { obj = null; } }
  }
  if (!obj || typeof obj !== 'object') return null;
  const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const list = (v, n, each) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => str(x, each)).filter(Boolean).slice(0, n);
  const severity = SEVERITIES.includes(String(obj.severity).toLowerCase()) ? String(obj.severity).toLowerCase() : 'medium';
  const area = AREAS.includes(String(obj.area).toLowerCase()) ? String(obj.area).toLowerCase() : 'other';
  const confidence = ['low', 'medium', 'high'].includes(String(obj.confidence).toLowerCase()) ? String(obj.confidence).toLowerCase() : 'medium';
  const where = list(obj.where, 4, 160).map((p) => p.replace(/^`|`$/g, '')).filter((p) => !/\.\.|^\/|^[a-z]+:\/\//i.test(p));
  const t = {
    title: str(obj.title, 100),
    summary: str(obj.summary, 600),
    cause: str(obj.cause, 900),
    where,
    repro: list(obj.repro, 4, 200),
    fix: str(obj.fix, 1200),
    tests: str(obj.tests, 600),
    severity,
    area,
    confidence,
    needs_info: str(obj.needs_info, 400),
  };
  return t.summary || t.cause || t.fix ? t : null;
}

const SEV_FR = { low: 'faible', medium: 'moyenne', high: 'élevée', critical: 'critique' };

/** Copy-paste prompt for a coding agent (Codex, Claude Code, Copilot…). */
export function renderFixPrompt(t, { repo, issue }) {
  const lines = [
    `Repository: ${repo} (React + Vite in src/, Cloudflare Worker + Hono + D1 in worker/).`,
    `Fix GitHub issue #${issue.number}: ${t.title || issue.title}`,
    '',
    `Problem: ${t.summary}`,
    t.cause ? `Probable cause: ${t.cause}` : '',
    t.where.length ? `Start with: ${t.where.join(', ')}` : '',
    t.repro.length ? `Reproduce: ${t.repro.map((s, i) => `${i + 1}) ${s}`).join(' ')}` : '',
    t.fix ? `Suggested fix: ${t.fix}` : '',
    '',
    'Requirements:',
    '- Find and fix the root cause (not only the symptom); keep the change minimal and consistent with the surrounding code.',
    `- Add or update a vitest test that fails before the fix${t.tests ? ` (${t.tests})` : ''}.`,
    '- Run `npx tsc --noEmit` and `npx vitest run` — both must pass.',
    '- Do not bump the app version; user-facing text stays in French (with i18n keys where the file already uses them).',
    `- Open a pull request whose description contains "Fixes #${issue.number}" so the issue closes automatically on merge.`,
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export function renderTriageComment(t, { repo, issue, model, files = [] }) {
  const sev = SEV_FR[t.severity] || t.severity;
  const where = (t.where.length ? t.where : files.slice(0, 3)).map((p) => `\`${p}\``).join(', ');
  const prompt = renderFixPrompt({ ...t, where: t.where.length ? t.where : files.slice(0, 3) }, { repo, issue });
  const out = [
    TRIAGE_MARKER,
    '### 🤖 Analyse automatique',
    '',
    `**Résumé** — ${t.summary || '—'}`,
    '',
    `| Gravité | Zone | Confiance |`,
    `|---|---|---|`,
    `| ${sev} | ${t.area} | ${t.confidence} |`,
    '',
    t.cause ? `**Cause probable** — ${t.cause}` : '',
    where ? `**Où regarder** — ${where}` : '',
    t.repro.length ? `**Reproduire**\n${t.repro.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    t.fix ? `**Correctif proposé** — ${t.fix}` : '',
    t.tests ? `**Vérification** — ${t.tests}` : '',
    t.needs_info ? `> ❓ **Information manquante :** ${t.needs_info}` : '',
    '',
    '<details><summary><b>Prompt de correction (à coller dans votre agent de code)</b></summary>',
    '',
    '```text',
    prompt.replace(/```/g, "'''"),
    '```',
    '</details>',
    '',
    `**Suite** — ouvrez une PR contenant \`Fixes #${issue.number}\` : elle sera liée ici automatiquement et le ticket se fermera à la fusion. Commentez \`/atlas-triage\` pour relancer l’analyse.`,
    '',
    `<sub>Généré par ${model} (Groq, offre gratuite) à partir du ticket et du code actuel — à vérifier avant d’agir.</sub>`,
  ];
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

export function renderPrLinkComment({ pr, closing }) {
  const how = closing
    ? 'Ce ticket sera **fermé automatiquement** à la fusion.'
    : 'La PR mentionne ce ticket sans mot-clé de fermeture — ajoutez `Fixes #<n>` à sa description pour la fermeture automatique.';
  return [prLinkMarker(pr.number), `🔗 **Correctif en cours** : #${pr.number} — ${String(pr.title || '').slice(0, 120)} (par @${pr.user?.login || '?'})`, '', how].join('\n');
}

export function renderFixedComment({ pr, sha }) {
  const short = String(sha || '').slice(0, 7);
  return [FIXED_MARKER, `✅ **Corrigé** par #${pr.number}${short ? ` (\`${short}\`)` : ''}, fusionnée dans \`${pr.base?.ref || 'main'}\`.`, '', 'Le correctif sera inclus dans le prochain déploiement. Rouvrez ce ticket si le problème persiste.'].join('\n');
}
