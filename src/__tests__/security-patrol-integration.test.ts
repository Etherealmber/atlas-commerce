/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let fixture = '';
afterEach(() => { if (fixture) rmSync(fixture, { recursive: true, force: true }); });

describe('security patrol report writing', () => {
  it('writes a safe report once and fails rather than reusing an existing file', () => {
    fixture = mkdtempSync(join(tmpdir(), 'atlas-patrol-'));
    const preload = join(fixture, 'fetch.cjs');
    writeFileSync(preload, `globalThis.fetch = async () => new Response(JSON.stringify({success:true, data:{ok:true,waf:{blocked:3,lastSig:'<script>@everyone</script>',lastAt:'2026-01-01'}}}), {status:200, headers:{'content-type':'application/json'}});`);
    const args = ['--require', preload, resolve('scripts/security-patrol.mjs')];
    const env = { ...process.env, PATROL_BASE_URL: 'https://patrol.invalid', CF_API_TOKEN: '', CF_ZONE_ID: '' };
    const output = execFileSync(process.execPath, args, { cwd: fixture, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(output).toContain('::PATROL-JSON::');
    const report = readFileSync(join(fixture, 'report.md'), 'utf8');
    expect(report).toContain('&lt;script&gt;\\[at\\]everyone&lt;/script&gt;');
    expect(report).not.toContain('<script>');
    expect(() => execFileSync(process.execPath, args, { cwd: fixture, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow();
    expect(readFileSync(join(fixture, 'report.md'), 'utf8')).toBe(report);
  });
});
