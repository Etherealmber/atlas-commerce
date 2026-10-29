#!/usr/bin/env node
/**
 * sync-docs.mjs — v0.7.2
 * Réécrit les blocs `<!-- SUPPORT-SYNC:<clé>:start/end -->` de README.md et
 * SECURITY.md à partir de APP_VERSION (src/version.ts).
 *
 * Politique de support : seule la MINEURE COURANTE est supportée. Dès qu'une
 * nouvelle mineure sort (ex. 0.8.0), la mineure précédente (0.7) passe en fin
 * de support — comme 0.6 l'est depuis 0.7.0.
 *
 * Exécuté par .github/workflows/docs-sync.yml à chaque push sur main qui
 * touche src/version.ts ; le workflow commit & push si les docs changent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const versionSrc = readFileSync(join(root, 'src/version.ts'), 'utf8');
const m = versionSrc.match(/APP_VERSION\s*=\s*'([^']+)'/);
if (!m) {
  console.error('sync-docs: APP_VERSION introuvable dans src/version.ts');
  process.exit(1);
}
const version = m[1]; // ex. 0.7.2-beta
const [major, minor] = version.split('-')[0].split('.').map(Number);
if (!Number.isFinite(major) || !Number.isFinite(minor)) {
  console.error(`sync-docs: version illisible (${version})`);
  process.exit(1);
}
const cur = `${major}.${minor}`;
const prev = minor > 0 ? `${major}.${minor - 1}` : `${major - 1}.9`;
const next = `${major}.${minor + 1}`;
const badge = version.replace(/-/g, '--'); // shields.io : - → --

let changed = false;

function replaceBlock(file, key, content) {
  const path = join(root, file);
  const src = readFileSync(path, 'utf8');
  const start = `<!-- SUPPORT-SYNC:${key}:start -->`;
  const end = `<!-- SUPPORT-SYNC:${key}:end -->`;
  const i = src.indexOf(start);
  const j = src.indexOf(end);
  if (i < 0 || j < i || j < 0) {
    console.error(`sync-docs: bloc « ${key} » manquant/cassé dans ${file}`);
    process.exit(1);
  }
  const out = `${src.slice(0, i + start.length)}\n${content}\n${src.slice(j)}`;
  if (out !== src) {
    writeFileSync(path, out);
    console.log(`sync-docs: ${file} — bloc « ${key} » mis à jour (${version})`);
    changed = true;
  } else {
    console.log(`sync-docs: ${file} — bloc « ${key} » déjà à jour`);
  }
}

replaceBlock(
  'README.md',
  'badge',
  `![Version](https://img.shields.io/badge/version-${badge}-blue)`,
);

replaceBlock(
  'README.md',
  'support',
  `Version actuelle : **${version}** (gelée jusqu'au prochain ordre de push).

> **Politique de support** : seule la mineure courante (**${cur}**) reçoit correctifs et mises à jour de sécurité. Dès la sortie de la mineure suivante (ex. ${next}.0), la mineure précédente passe immédiatement en fin de support — ${prev}.x l'est depuis ${cur}.0. Les versions ${prev}.x et antérieures ne sont plus supportées.`,
);

replaceBlock(
  'SECURITY.md',
  'supported',
  `| Version        | Supported          |
| -------------- | ------------------ |
| ${cur}.x (beta)   | :white_check_mark: |
| ${prev}.x and older| :x:                |
| 1.0.0 (future) | :white_check_mark: at release |

**Policy:** only the current minor (**${cur}**) is supported. When the next minor
ships (e.g. ${next}.0), the previous minor reaches end of support immediately —
${prev}.x ended with the ${cur}.0 release. Only the latest beta on \`main\` receives
security updates. Production runs the Cloudflare Worker build of \`main\`;
previews run per-branch sandboxes.`,
);

console.log(changed ? 'sync-docs: docs modifiées' : 'sync-docs: rien à changer');
