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
  ])('reports a challenge as inconclusive without claiming an outage or security passes', (health) => {
    const { doc, report, requests } = runPatrol(health);
    expect(doc.coverage).toBe('incomplete');
    expect(doc.reachable).toBeNull();
    expect(doc.findings).toHaveLength(1);
    expect(doc.findings[0].severity).toBe('medium');
    expect(doc.findings[0].detail).toContain('unverified');
    expect(doc.totalChecks).toBe(1);
    expect(requests).toEqual(['/api/health']);
    expect(report).toContain('Contrôles incomplets');
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

  it('does not claim authorization succeeded when later probes are challenged', () => {
    const { doc } = runPatrol({ status: 200, body: '{"success":true,"data":{"ok":true}}' }, true);
    for (const id of ['authz-users', 'forged-token-r2', 'authz-android-release-post']) {
      const finding = doc.findings.find((r: any) => r.id === id);
      expect(finding.severity).toBe('medium');
      expect(finding.detail).toContain('not verified');
    }
  });
});
