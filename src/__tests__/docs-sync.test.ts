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
  for (const file of ['README.md', 'SECURITY.md', 'src/version.ts', 'scripts/sync-docs.mjs']) {
    cpSync(file, join(fixture, file));
  }
}
function sync() {
  return execFileSync(process.execPath, [join(fixture, 'scripts/sync-docs.mjs')], { encoding: 'utf8' });
}

describe('documentation badge synchronization', () => {
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
