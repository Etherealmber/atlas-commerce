#!/usr/bin/env node
// AI issue assistant — run by .github/workflows/issue-ai.yml.
//
//  issues (opened / labeled / reopened), `/atlas-triage` comment, manual dispatch
//    → analyse the bug with Groq (free tier), post ONE comment with summary, cause,
//      files, fix + a copy-paste « fix prompt », add severity/area labels, assign.
//  pull_request_target (opened / edited / reopened / ready_for_review)
//    → link every referenced issue (comment once, `in-progress` label, assign PR author).
//  pull_request_target closed + merged
//    → close the issues the PR fixes (Fixes/Closes/Resolves #n or branch `fix/123-…`).
//
// Needs: GITHUB_TOKEN (issues + pull-requests write), GROQ_API_KEY (repo secret).
// Never checks out or executes PR code — only reads event metadata.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  AREAS, TRIAGE_MARKER, FIXED_MARKER, prLinkMarker, buildMessages, countTriagesSince, extractIssueRefs, isSafeGithubPath,
  extractRoutes, extractSearchTerms, isEligibleIssue, parseTriage, renderFixedComment, renderPrLinkComment,
  renderTriageComment, routeToComponent,
} from './issue-ai-lib.mjs';

const env = process.env;
const REPO = env.GITHUB_REPOSITORY;
const TOKEN = env.GITHUB_TOKEN;
const MODEL = env.GROQ_MODEL || 'openai/gpt-oss-120b';
const DAILY_LIMIT = Math.max(1, Number(env.GROQ_DAILY_LIMIT || 25));
const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
const eventName = env.GITHUB_EVENT_NAME || '';

const log = (...a) => console.log('[issue-ai]', ...a);
const warn = (msg) => console.log(`::warning::${String(msg).replace(/\r?\n/g, ' ')}`);

async function gh(path, { method = 'GET', body } = {}) {
  // Only GitHub REST endpoints for this repository are permitted. Never let
  // event metadata or an API response choose a host or escape the repo path.
  if (!isSafeGithubPath(REPO, path)) throw new Error('Invalid GitHub API path');
  const res = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'atlas-issue-ai',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path} → ${res.status} ${data?.message || ''}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
const soft = (p) => p.catch((e) => { warn(e.message); return null; });

async function ensureLabel(name, color, description) {
  await gh(`repos/${REPO}/labels`, { method: 'POST', body: { name, color, description } }).catch(() => null);
}
async function addLabels(issue, labels) {
  if (labels.length) await soft(gh(`repos/${REPO}/issues/${issue}/labels`, { method: 'POST', body: { labels } }));
}
async function issueComments(issue) {
  return (await gh(`repos/${REPO}/issues/${issue}/comments?per_page=100`)) || [];
}

// ---------- repo context (base branch checkout; never PR code) ----------
function git(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}
function repoContext(issue) {
  const text = `${issue.title}\n${issue.body || ''}`;
  const tracked = git(['ls-files', 'src', 'worker']).split('\n').filter((f) => /\.(tsx?|mjs|css)$/.test(f) && !f.includes('__tests__'));
  if (!tracked.length) return { files: [], snippets: [] };
  const hits = new Map();
  const bump = (f, w) => hits.set(f, (hits.get(f) || 0) + w);
  for (const route of extractRoutes(text)) {
    const comp = routeToComponent(route).toLowerCase();
    if (!comp) continue;
    for (const f of tracked) {
      const base = f.split('/').pop().replace(/\.\w+$/, '').toLowerCase();
      if (base === comp) bump(f, f.startsWith('src/pages/') ? 8 : 6);
    }
  }
  const terms = extractSearchTerms(text);
  const snippets = [];
  for (const term of terms) {
    if (/\.(tsx?|jsx?|mjs|css)$/.test(term)) {
      for (const f of tracked) if (f.endsWith(`/${term}`)) bump(f, 7);
      continue;
    }
    const out = git(['grep', '-n', '-F', '-I', '--max-count=2', term, '--', 'src', 'worker', ':!**/__tests__/**']);
    const lines = out.split('\n').filter(Boolean).slice(0, 12);
    for (const l of lines) {
      const m = l.match(/^([^:]+):(\d+):/);
      if (!m) continue;
      bump(m[1], 3);
      if (snippets.length < 6 && !snippets.some((s) => s.path === m[1])) snippets.push({ path: m[1], line: Number(m[2]), term });
    }
  }
  const files = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 8);
  const withText = snippets
    .sort((a, b) => (hits.get(b.path) || 0) - (hits.get(a.path) || 0))
    .slice(0, 4)
    .map((s) => {
      let src = '';
      try { src = readFileSync(s.path, 'utf8'); } catch { return null; }
      const all = src.split('\n');
      const from = Math.max(0, s.line - 7);
      const text2 = all.slice(from, s.line + 8).map((l, i) => `${from + i + 1}| ${l.slice(0, 180)}`).join('\n');
      return { path: s.path, line: s.line, text: text2 };
    })
    .filter(Boolean);
  return { files, snippets: withText };
}

// ---------- Groq ----------
async function groq(messages) {
  const base = { model: MODEL, messages, temperature: 0.2, max_completion_tokens: 1100 };
  const attempts = [
    { ...base, reasoning_effort: 'low', response_format: { type: 'json_object' } },
    { ...base, response_format: { type: 'json_object' } },
    base,
  ];
  for (const body of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40_000);
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    if (res.status === 429) {
      warn(`Groq rate limit (retry-after ${res.headers.get('retry-after') || '?'}s) — skipping, the issue stays untouched.`);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (res.status === 400 && body !== base) { log('Groq 400, retrying with a simpler request:', data?.error?.message || ''); continue; }
    if (!res.ok) { warn(`Groq ${res.status}: ${data?.error?.message || 'error'}`); return null; }
    return data?.choices?.[0]?.message?.content || null;
  }
  return null;
}

async function defaultAssignee() {
  if (env.ISSUE_ASSIGNEE) return env.ISSUE_ASSIGNEE;
  const owner = event.repository?.owner;
  return owner?.type === 'User' ? REPO.split('/')[0] : '';
}

async function triage(issueNumber, { force = false } = {}) {
  const issue = await gh(`repos/${REPO}/issues/${issueNumber}`);
  const elig = isEligibleIssue(issue, { force });
  if (!elig.ok) { log(`#${issueNumber}: skipped (${elig.reason})`); return; }

  const comments = await issueComments(issueNumber);
  const previous = comments.find((c) => String(c.body || '').includes(TRIAGE_MARKER));
  if (previous && !force) { log(`#${issueNumber}: already analysed`); return; }

  // Assign first — useful even when the model is unavailable.
  if (!(issue.assignees || []).length) {
    const who = await defaultAssignee();
    if (who) await soft(gh(`repos/${REPO}/issues/${issueNumber}/assignees`, { method: 'POST', body: { assignees: [who] } }));
  }

  if (!env.GROQ_API_KEY) { warn('GROQ_API_KEY secret missing — AI analysis skipped (labels/assignment still applied).'); return; }
  if (String(env.GROQ_ENABLED || 'true').toLowerCase() === 'false') { log('GROQ_ENABLED=false'); return; }

  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const recent = (await soft(gh(`repos/${REPO}/issues/comments?since=${midnight.toISOString()}&per_page=100`))) || [];
  const used = countTriagesSince(recent, midnight.toISOString());
  if (used >= DAILY_LIMIT) { warn(`Daily AI triage cap reached (${used}/${DAILY_LIMIT}) — try /atlas-triage tomorrow.`); return; }

  const { files, snippets } = repoContext(issue);
  log(`#${issueNumber}: ${files.length} candidate files, ${snippets.length} excerpts, model ${MODEL}`);
  const answer = await groq(buildMessages({ repo: REPO, issue, files, snippets }));
  const t = parseTriage(answer);
  if (!t) { warn(`#${issueNumber}: model answer unusable — nothing posted.`); return; }

  const body = renderTriageComment(t, { repo: REPO, issue, model: MODEL, files });
  if (previous) await gh(`repos/${REPO}/issues/comments/${previous.id}`, { method: 'PATCH', body: { body } });
  else await gh(`repos/${REPO}/issues/${issueNumber}/comments`, { method: 'POST', body: { body } });

  await ensureLabel('ai-triaged', '0E8A16', 'Analysé automatiquement (Groq)');
  await ensureLabel(`severity:${t.severity}`, t.severity === 'critical' ? 'B60205' : t.severity === 'high' ? 'D93F0B' : t.severity === 'medium' ? 'FBCA04' : 'C2E0C6', 'Gravité estimée');
  if (AREAS.includes(t.area)) await ensureLabel(`area:${t.area}`, '5319E7', 'Zone estimée par le triage automatique');
  const labels = ['ai-triaged', `severity:${t.severity}`, `area:${t.area}`];
  if (t.needs_info) { await ensureLabel('needs-info', 'D4C5F9', 'Waiting for more details'); labels.push('needs-info'); }
  await addLabels(issueNumber, labels);
  log(`#${issueNumber}: analysis posted (${t.severity}/${t.area})`);
}

async function linkPr(pr) {
  const refs = extractIssueRefs(`${pr.title}\n${pr.body || ''}`, pr.head?.ref || '');
  const targets = [...refs.closing.map((n) => [n, true]), ...refs.mentioned.map((n) => [n, false])];
  if (!targets.length) { log(`PR #${pr.number}: no linked issue`); return; }
  await ensureLabel('in-progress', '1D76DB', 'Une PR corrige ce ticket');
  for (const [n, closing] of targets.slice(0, 10)) {
    const issue = await soft(gh(`repos/${REPO}/issues/${n}`));
    if (!issue || issue.pull_request || issue.state !== 'open') continue;
    const comments = await issueComments(n);
    if (!comments.some((c) => String(c.body || '').includes(prLinkMarker(pr.number)))) {
      await soft(gh(`repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: { body: renderPrLinkComment({ pr, closing }) } }));
    }
    if (closing) {
      await addLabels(n, ['in-progress']);
      const login = pr.user?.login;
      if (login && !String(login).endsWith('[bot]') && !(issue.assignees || []).some((a) => a.login === login)) {
        await soft(gh(`repos/${REPO}/issues/${n}/assignees`, { method: 'POST', body: { assignees: [login] } }));
      }
    }
    log(`PR #${pr.number} linked to #${n}${closing ? ' (closes)' : ''}`);
  }
}

async function closeFixed(pr) {
  const refs = extractIssueRefs(`${pr.title}\n${pr.body || ''}`, pr.head?.ref || '');
  for (const n of refs.closing.slice(0, 10)) {
    const issue = await soft(gh(`repos/${REPO}/issues/${n}`));
    if (!issue || issue.pull_request) continue;
    const comments = await issueComments(n);
    if (!comments.some((c) => String(c.body || '').includes(FIXED_MARKER) && String(c.body || '').includes(`#${pr.number}`))) {
      await soft(gh(`repos/${REPO}/issues/${n}/comments`, { method: 'POST', body: { body: renderFixedComment({ pr, sha: pr.merge_commit_sha }) } }));
    }
    await soft(gh(`repos/${REPO}/issues/${n}/labels/in-progress`, { method: 'DELETE' }));
    await ensureLabel('fixed', '0E8A16', 'Corrigé par une PR fusionnée');
    await addLabels(n, ['fixed']);
    if (issue.state === 'open') await soft(gh(`repos/${REPO}/issues/${n}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } }));
    log(`#${n} closed by PR #${pr.number}`);
  }
}

async function unlinkClosed(pr) {
  const refs = extractIssueRefs(`${pr.title}\n${pr.body || ''}`, pr.head?.ref || '');
  for (const n of refs.closing.slice(0, 10)) await soft(gh(`repos/${REPO}/issues/${n}/labels/in-progress`, { method: 'DELETE' }));
}

async function main() {
  if (!REPO || !TOKEN) throw new Error('GITHUB_REPOSITORY / GITHUB_TOKEN missing');
  if (eventName === 'issues') {
    const issue = event.issue;
    if (event.sender?.type === 'Bot' && !(issue.labels || []).some((l) => l.name === 'crash-report')) { log('opened by a bot — skipped'); return; }
    if (event.action === 'labeled' && !['bug', 'crash-report'].includes(event.label?.name)) return;
    const n = Number(issue.number);
    if (Number.isSafeInteger(n) && n > 0) await triage(n);
  } else if (eventName === 'issue_comment') {
    const c = event.comment;
    const trusted = ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c?.author_association);
    if (!event.issue?.pull_request && trusted && /^\s*\/atlas-triage\b/i.test(c?.body || '')) {
      const n = Number(event.issue.number);
      if (Number.isSafeInteger(n) && n > 0) await triage(n, { force: true });
    }
  } else if (eventName === 'workflow_dispatch') {
    const n = Number(event.inputs?.issue);
    if (Number.isSafeInteger(n) && n > 0) await triage(n, { force: true });
  } else if (eventName === 'pull_request_target' || eventName === 'pull_request') {
    const number = Number(event.pull_request?.number);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid pull request number');
    // Re-fetch metadata from GitHub instead of forwarding event-file contents.
    const pr = await gh(`repos/${REPO}/pulls/${number}`);
    if (event.action === 'closed') {
      if (pr.merged) await closeFixed(pr);
      else await unlinkClosed(pr);
    } else {
      await linkPr(pr);
    }
  } else {
    log(`event ${eventName} ignored`);
  }
}

main().catch((e) => {
  // Never fail the workflow on an assistant problem — just report it.
  warn(e?.message || String(e));
});
