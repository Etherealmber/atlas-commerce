#!/usr/bin/env node
/**
 * CI guard: verifies package.json version matches APP_VERSION in src/version.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionTs = readFileSync(join(root, 'src/version.ts'), 'utf8');
const match = versionTs.match(/export\s+const\s+APP_VERSION\s*=\s*'([^']+)'/);
if (!match) {
  console.error('check-version-sync: APP_VERSION not found in src/version.ts');
  process.exit(1);
}
const appVersion = match[1];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.version !== appVersion) {
  console.error(
    `check-version-sync: mismatch — package.json version (${pkg.version}) !== src/version.ts APP_VERSION (${appVersion})`,
  );
  process.exit(1);
}
console.log(`check-version-sync OK (${appVersion})`);
