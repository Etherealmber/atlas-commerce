import { isSafeGithubPath } from '../../scripts/issue-ai-lib.mjs';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TRIAGE_MARKER, buildMessages, countTriagesSince, extractIssueRefs, extractRoutes, extractSearchTerms,
  isEligibleIssue, parseTriage, prLinkMarker, renderFixedComment, renderPrLinkComment, renderTriageComment,
  routeToComponent, sanitizeForModel,
} from '../../scripts/issue-ai-lib.mjs';

const crash = [
  "[crash 20e5df40e6681ae4] Erreur TypeError lors du survol d'un élément sur la page employés",
  '- Page : `/employees`',
  '- User-Agent : Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  '### Message',
  "Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'.",
  '### Stack',
  "TypeError: parameter 1 is not of type 'Node'.",
  '    at onPointerLeave (https://stock.afmarbre.com/assets/index-WzoGLqjG.js:5:40409)',
  '    at b1 (https://stock.afmarbre.com/assets/vendor-react-DOxluXnj.js:48:127582)',
].join('\n');

describe('issue AI assistant — pure helpers', () => {
  it('extracts useful code identifiers and routes from a crash report (no bundle hashes / UA noise)', () => {
    const terms = extractSearchTerms(crash);
    expect(terms).toContain('onPointerLeave');
    expect(terms).toContain('contains');
    expect(terms.join(' ')).not.toMatch(/WzoGLqjG|DOxluXnj|AppleWebKit|Gecko|Safari/);
    expect(extractRoutes(crash)).toEqual(['/employees']);
    expect(routeToComponent('/purchase-orders/12')).toBe('PurchaseOrders');
  });

  it('finds closing references in PR text and branch names, ignoring other repos', () => {
    const r = extractIssueRefs('Fixes #242, closes #12 and #13\nRefs #99\nFixes other/repo#5', 'arena/1234-x');
    expect(r.closing).toEqual([12, 13, 242]);
    expect(r.mentioned).toEqual([99]);
    expect(extractIssueRefs('Corrige le bug', 'fix/321-employees-hover').closing).toEqual([321]);
    expect(extractIssueRefs('Résout #7', '').closing).toEqual([]);
    expect(extractIssueRefs('resolved: #7').closing).toEqual([7]);
  });

  it('only analyses open bug reports, never security issues or PRs', () => {
    expect(isEligibleIssue({ title: 'x', body: crash, labels: [{ name: 'crash-report' }], state: 'open' }).ok).toBe(true);
    expect(isEligibleIssue({ title: 'Ajouter un export', body: 'suggestion', labels: [], state: 'open' }).ok).toBe(false);
    expect(isEligibleIssue({ title: 'XSS', body: 'bug', labels: [{ name: 'security' }], state: 'open' }).ok).toBe(false);
    expect(isEligibleIssue({ title: 'bug', pull_request: {}, labels: [] }).ok).toBe(false);
    expect(isEligibleIssue({ title: 'question', body: '', labels: [], state: 'open' }, { force: true }).ok).toBe(true);
  });

  it('redacts secrets and personal data before calling the model', () => {
    const s = sanitizeForModel('key gsk_abcdefghijklmnopqrstuv mail a.b@x.ma tel 0612345678 ip 10.1.2.3 url /print?token=abc.def&x=1 atlasdemo.aaaaaaaaaaaaaaaaaaaaaa');
    expect(s).not.toMatch(/gsk_|a\.b@x\.ma|0612345678|10\.1\.2\.3|token=abc|atlasdemo\.a/);
    expect(sanitizeForModel('x'.repeat(50), 10)).toContain('[tronqué]');
  });

  it('builds a bounded prompt and parses a fenced / noisy JSON answer', () => {
    const msgs = buildMessages({
      repo: 'o/r',
      issue: { number: 242, title: 'Crash', body: crash, labels: [{ name: 'bug' }] },
      files: ['src/App.tsx'],
      snippets: Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, line: 1, text: 'y'.repeat(900) })),
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content.length).toBeLessThan(10_000); // ~2.5k tokens: fits the 8k TPM free tier
    const t = parseTriage('```json\n{"title":"Crash survol","summary":"Plantage","cause":"contains(null)","where":["src/App.tsx","../etc/passwd"],"repro":["Ouvrir /employees"],"fix":"Garde instanceof Node","tests":"vitest","severity":"HIGH","area":"nope","confidence":"high","needs_info":""}\n```');
    expect(t).not.toBeNull();
    expect(t!.severity).toBe('high');
    expect(t!.area).toBe('other');
    expect(t!.where).toEqual(['src/App.tsx']);
    expect(parseTriage('désolé, pas de JSON')).toBeNull();
  });

  it('renders one marked comment with a copy-paste fix prompt that asks for « Fixes #n »', () => {
    const t = parseTriage('{"summary":"Plantage au survol","cause":"relatedTarget null","where":["src/App.tsx"],"fix":"instanceof Node","severity":"high","area":"ui"}')!;
    const body = renderTriageComment(t, { repo: 'o/r', issue: { number: 242, title: 'Crash' }, model: 'openai/gpt-oss-120b' });
    expect(body.startsWith(TRIAGE_MARKER)).toBe(true);
    expect(body).toContain('Prompt de correction');
    expect(body).toContain('Fixes #242');
    expect(body).toContain('`src/App.tsx`');
    expect(body).toContain('| élevée | ui |');
    expect(countTriagesSince([{ body, created_at: '2026-10-20T08:00:00Z' }, { body: 'merci', created_at: '2026-10-20T09:00:00Z' }], '2026-10-20T00:00:00Z')).toBe(1);
  });

  it('renders PR link / fixed comments with idempotency markers', () => {
    const pr = { number: 250, title: 'Fix hover crash', user: { login: 'dev' }, base: { ref: 'main' } };
    expect(renderPrLinkComment({ pr, closing: true })).toContain(prLinkMarker(250));
    expect(renderPrLinkComment({ pr, closing: false })).toContain('Fixes #<n>');
    expect(renderFixedComment({ pr, sha: 'abcdef1234' })).toContain('`abcdef1`');
  });

  it('restricts GitHub requests to the configured repository', () => {
    expect(isSafeGithubPath('owner/repo', 'repos/owner/repo/issues/12/comments?per_page=100')).toBe(true);
    expect(isSafeGithubPath('owner/repo', 'repos/owner/other/issues/1')).toBe(false);
    expect(isSafeGithubPath('owner/repo', 'repos/owner/repo/../../other')).toBe(false);
    expect(isSafeGithubPath('owner/repo', 'repos/owner/repo/%2e%2e/other')).toBe(false);
    expect(isSafeGithubPath('owner/repo', 'https://example.com')).toBe(false);
  });

  it('workflow wires the secret, never runs PR code and only reacts to maintainer commands', () => {
    const yml = readFileSync('.github/workflows/issue-ai.yml', 'utf8');
    expect(yml).toContain('secrets.GROQ_API_KEY');
    expect(yml).toContain('pull_request_target');
    expect(yml).toMatch(/ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    expect(yml).not.toMatch(/github\.event\.pull_request\.head\.(sha|ref)/);
    const runner = readFileSync('scripts/issue-ai.mjs', 'utf8');
    expect(runner).toContain("['OWNER', 'MEMBER', 'COLLABORATOR']");
  });
});
