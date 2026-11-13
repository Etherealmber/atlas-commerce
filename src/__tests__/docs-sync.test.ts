/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let fixture = '';
afterEach(() => { if (fixture) rmSync(fixture, { recursive: true, force: true }); });

function setup() {
  fixture = mkdtempSync(join(tmpdir(), 'atlas-docs-sync-'));
  mkdirSync(join(fixture, 'scripts'));
  mkdirSync(join(fixture, 'src'));
  for (const file of ['README.md', 'SECURITY.md', 'LICENSE', 'LICENSE-APACHE', 'src/version.ts', 'scripts/sync-docs.mjs', 'scripts/sync-license.mjs']) {
    cpSync(file, join(fixture, file));
  }
}
function sync(year = 2026) {
  const epoch = Math.floor(Date.UTC(year, 5, 1) / 1000).toString();
  return execFileSync(process.execPath, [join(fixture, 'scripts/sync-docs.mjs')], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: epoch } });
}

describe('documentation badge synchronization', () => {
  it('keeps the project notices in both licenses in sync without changing their terms', () => {
    setup();
    const mitBefore = readFileSync(join(fixture, 'LICENSE'), 'utf8');
    const apacheBefore = readFileSync(join(fixture, 'LICENSE-APACHE'), 'utf8');
    sync(2027);
    for (const [file, before] of [['LICENSE', mitBefore], ['LICENSE-APACHE', apacheBefore]]) {
      expect(readFileSync(join(fixture, file), 'utf8')).toBe(before.replace('Copyright (c) 2026 Etherealmber', 'Copyright (c) 2026-2027 Etherealmber'));
    }
    expect(sync(2027)).toContain('rien à changer');
    sync(2026); // a stale clock must never shorten a previously published range
    expect(readFileSync(join(fixture, 'LICENSE'), 'utf8')).toContain('Copyright (c) 2026-2027 Etherealmber');
  });

  it('fails closed if either project notice is missing', () => {
    setup();
    const apache = join(fixture, 'LICENSE-APACHE');
    writeFileSync(apache, readFileSync(apache, 'utf8').replace('Copyright (c) 2026 Etherealmber', 'missing notice'));
    const mit = readFileSync(join(fixture, 'LICENSE'), 'utf8');
    expect(() => sync(2027)).toThrow();
    expect(readFileSync(join(fixture, 'LICENSE'), 'utf8')).toBe(mit);
  });

  it('keeps both license badges in the same row as the updated version and is idempotent', () => {
    setup();
    const versionPath = join(fixture, 'src/version.ts');
    const source = readFileSync(versionPath, 'utf8');
    writeFileSync(versionPath, source.replace(/(APP_VERSION\s*=\s*')[^']+(')/, (_match, prefix, suffix) => `${prefix}0.9.1-beta${suffix}`));
    sync();
    const readme = readFileSync(join(fixture, 'README.md'), 'utf8');
    const firstRow = readme.match(/<!-- Badges:[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || '';
    expect(firstRow).toContain('href="LICENSE"');
    expect(firstRow).toContain('href="LICENSE-APACHE"');
    expect(firstRow).toContain('version-0.9.1--beta-blue');
    expect(firstRow).toContain('alt="Version 0.9.1-beta"');
    expect(readme).toContain('Version actuelle : **0.9.1-beta**');
    const security = readFileSync(join(fixture, 'SECURITY.md'), 'utf8');
    expect(security).toContain('0.9.x (beta)');
    expect(sync()).toContain('rien à changer');
    expect(readFileSync(join(fixture, 'README.md'), 'utf8')).toBe(readme);
    expect(readFileSync(join(fixture, 'SECURITY.md'), 'utf8')).toBe(security);
  });
});
