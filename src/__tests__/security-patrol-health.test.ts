/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function runPatrol(health: { status: number; body: string; headers?: Record<string, string> }, challengeOther = false) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-patrol-health-'));
  fixtures.push(dir);
  const mock = join(dir, 'mock-fetch.cjs');
  writeFileSync(mock, `
    const { appendFileSync } = require('node:fs');
    const health = ${JSON.stringify(health)};
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      appendFileSync('requests.txt', path + '\\n');
      if (path === '/api/health') return new Response(health.body, {status: health.status, headers: health.headers});
      if (${JSON.stringify(challengeOther)}) return new Response('Just a moment', {status: 403, headers: {'cf-mitigated': 'challenge'}});
      return new Response(JSON.stringify({success:false,error:'UNAUTHORIZED'}), {status:403, headers:{'content-type':'application/json'}});
    };
  `);
  const env = { ...process.env, PATROL_BASE_URL: 'https://patrol.invalid', CF_API_TOKEN: '', CF_ZONE_ID: '' };
  const output = execFileSync(process.execPath, ['--require', mock, resolve('scripts/security-patrol.mjs')], {
    cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const match = output.match(/::PATROL-JSON::([\s\S]*?)::END-PATROL-JSON::/);
  if (!match) throw new Error('No patrol document');
  return { doc: JSON.parse(match[1]), report: readFileSync(join(dir, 'report.md'), 'utf8'), requests: readFileSync(join(dir, 'requests.txt'), 'utf8').trim().split('\n') };
}

describe('security patrol health checks', () => {
  it.each([
    { status: 403, body: 'Just a moment — cf-challenge' },
    { status: 403, body: 'blocked', headers: { 'cf-mitigated': 'challenge' } },
    { status: 200, body: 'Just a moment — challenge-platform' },
  ])('reports a challenge as « non vérifié » — no finding, no issue, no outage or all-clear claim', (health) => {
    const { doc, report, requests } = runPatrol(health);
    expect(doc.coverage).toBe('incomplete');
    expect(doc.reachable).toBeNull();
    expect(doc.findings).toHaveLength(0);
    expect(doc.inconclusive).toHaveLength(1);
    expect(doc.inconclusive[0]).toMatchObject({ id: 'site-up', ok: false, inconclusive: true, severity: 'none' });
    expect(doc.inconclusive[0].detail).toContain('unverified');
    expect(doc.passed).toBe(0);
    expect(doc.totalChecks).toBe(1);
    expect(requests).toEqual(['/api/health']);
    expect(report).toContain('Contrôles incomplets');
    expect(report).toContain('Contrôles non vérifiés (1)');
    expect(report).toContain('PATROL\\_EDGE\\_TOKEN');
    expect(report).not.toContain('Points à corriger');
    expect(report).not.toContain('Aucun point à corriger');
  });

  it('continues real probes when the health endpoint returns a valid response', () => {
    const { doc, requests } = runPatrol({ status: 200, body: '{"success":true,"data":{"ok":true}}' });
    expect(doc.results.find((r: any) => r.id === 'site-up').ok).toBe(true);
    expect(requests).toContain('/api/canary');
    expect(doc.totalChecks).toBeGreaterThan(1);
  });

  it('keeps genuine HTTP errors and malformed health responses as critical findings', () => {
    for (const health of [{ status: 503, body: 'service unavailable' }, { status: 200, body: '{"success":false}' }]) {
      const { doc } = runPatrol(health);
      const site = doc.findings.find((r: any) => r.id === 'site-up');
      expect(site.severity).toBe('critical');
      expect(site.ok).toBe(false);
    }
  });

  it('does not claim authorization succeeded when later probes are challenged, and does not file them as findings', () => {
    const { doc } = runPatrol({ status: 200, body: '{"success":true,"data":{"ok":true}}' }, true);
    for (const id of ['authz-users', 'forged-token-r2', 'authz-android-release-post', 'canary-subsystems']) {
      expect(doc.findings.find((r: any) => r.id === id)).toBeUndefined();
      const skipped = doc.inconclusive.find((r: any) => r.id === id);
      expect(skipped.ok).toBe(false);
      expect(skipped.detail).toMatch(/not verified/);
    }
    // Edge-blocked WAF payloads are still « blocked » (a 403 is a block, whichever layer).
    expect(doc.results.find((r: any) => r.id === 'waf-xss').ok).toBe(true);
  });

  it('sends the optional PATROL_EDGE_TOKEN as X-Atlas-Patrol, never in the user-agent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-patrol-token-'));
    fixtures.push(dir);
    const mock = join(dir, 'mock-fetch.cjs');
    writeFileSync(mock, `
      const { appendFileSync } = require('node:fs');
      globalThis.fetch = async (url, init) => {
        appendFileSync('headers.txt', JSON.stringify(init.headers) + '\\n');
        return new Response('Just a moment', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
      };
    `);
    execFileSync(process.execPath, ['--require', mock, resolve('scripts/security-patrol.mjs')], {
      cwd: dir, env: { ...process.env, PATROL_BASE_URL: 'https://patrol.invalid', CF_API_TOKEN: '', CF_ZONE_ID: '', PATROL_EDGE_TOKEN: 'sekret-123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const headers = JSON.parse(readFileSync(join(dir, 'headers.txt'), 'utf8').trim().split('\n')[0]);
    expect(headers['X-Atlas-Patrol']).toBe('sekret-123');
    expect(headers['User-Agent']).not.toContain('sekret');
  });

  it('the workflow files only confirmed findings and writes every report to the run summary', () => {
    const yml = readFileSync(resolve('.github/workflows/security-patrol.yml'), 'utf8');
    expect(yml).toContain('PATROL_EDGE_TOKEN: ${{ secrets.PATROL_EDGE_TOKEN }}');
    expect(yml).toContain('cat report.md >> "$GITHUB_STEP_SUMMARY"');
    expect(yml).toMatch(/if \[ "\$FINDINGS" = "0" \] && \[ "\$INCONCLUSIVE" != "0" \]; then[\s\S]*::warning::[\s\S]*elif \[ "\$FINDINGS" != "0" \]; then/);
  });
});
