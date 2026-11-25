/**
 * The Workers runtime rejects `fetch(url, { redirect: 'error' })` with
 * « TypeError: Invalid redirect value, must be one of "follow" or "manual" ».
 * That silently broke every GitHub call (crash/report queue never drained,
 * « GitHub injoignable »), Resend mails and the desktop Turnstile check.
 * Worker code must use `redirect: 'manual'` (a 3xx is then simply `!ok`).
 * Browser snippets embedded as strings (webview pages) may keep 'error'.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BROWSER_SNIPPETS = new Set(['desktop-pilot-webview.ts', 'desktop-v3-webview.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('worker fetch redirect mode', () => {
  it("no worker module passes redirect: 'error' to fetch", () => {
    const root = new URL('../', import.meta.url).pathname;
    const offenders = walk(root)
      .filter((p) => !BROWSER_SNIPPETS.has(p.split('/').pop() || ''))
      .filter((p) => /redirect:\s*['"]error['"]/.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(root.length));
    expect(offenders).toEqual([]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('GitHub token validation uses manual redirects and treats 3xx as a failure', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(null, { status: 302, headers: { Location: 'https://example.com' } });
    });
    const { validateGithubToken } = await import('../lib/reports');
    const r = await validateGithubToken('ghp_test');
    expect(calls[0].redirect).toBe('manual');
    expect(r.ok).toBe(false);
  });
});
