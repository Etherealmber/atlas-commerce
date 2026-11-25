#!/usr/bin/env node
// Lists French UI strings found in src/ that have no entry in src/i18n/messages.ts.
// Usage: npm run i18n:missing [-- --limit 200]
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 150;
const msgSrc = readFileSync('src/i18n/messages.ts', 'utf8');
const known = new Set();
for (const m of msgSrc.matchAll(/^\s*\[\s*(['"])((?:\\.|(?!\1).)*)\1\s*,/gm)) known.add(m[2].replace(/\\(['"])/g, '$1').replace(/\s+/g, ' ').trim());
const templ = [...known].filter((k) => k.includes('{')).map((k) => new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{n\\\}/g, '[-+]?\\d[\\d .,]*').replace(/\\\{[a-z]+\\\}/g, '.+?')}$`));

const files = execSync("git ls-files 'src/*.tsx' 'src/**/*.tsx' 'src/lib/*.ts' | grep -v __tests__", { encoding: 'utf8' }).trim().split('\n');
const freq = new Map();
const add = (t, f) => {
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 120 || !/[a-zà-ÿ]{2}/i.test(t)) return;
  if (/[=;{}<>$]|^\w+\.\w+|^[a-z]+[A-Z]|^[a-z_-]+$|^https?:|^\/|var\(|px\b/.test(t)) return;
  if (known.has(t) || templ.some((r) => r.test(t))) return;
  const e = freq.get(t) || { n: 0, files: new Set() };
  e.n++; e.files.add(f); freq.set(t, e);
};
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/>\s*([^<>{}\n]*[A-Za-zÀ-ÿ][^<>{}\n]*?)\s*</g)) add(m[1], f);
  for (const m of s.matchAll(/(?:placeholder|title|aria-label|label|data-tooltip)=["']([^"'{}]+)["']/g)) add(m[1], f);
  for (const m of s.matchAll(/(?:toast|flash|setError|setMsg|setModalError|alert|setSaveMsg)\(\s*'([^'\n]{3,})'/g)) add(m[1], f);
}
const rows = [...freq.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`${known.size} dictionary keys · ${rows.length} unmatched source candidates (not a UI coverage percentage)\n`);
for (const [t, e] of rows.slice(0, limit)) console.log(`${String(e.n).padStart(3)}  ${t}   (${[...e.files][0].replace('src/', '')})`);
