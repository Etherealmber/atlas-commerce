#!/usr/bin/env node
/**
 * Themes / CSS guard — three deterministic checks, zero new dependencies.
 *
 *  1. STRUCTURAL (always, all files): balanced braces/parens after comment
 *     stripping, and every hex color has 3/4/6/8 digits.
 *  2. ORDER: dark-force.css must stay the LAST stylesheet imported by
 *     src/main.tsx (it is the single source of truth for dark surfaces and
 *     must win the cascade).
 *  3. NO NEW WHITE IN DARK (pull-request mode only): declarations like
 *     `background: #fff|#ffffff|white` added INSIDE an
 *     html[data-theme="dark"] block fail the check — pre-existing ones are
 *     tolerated so the gate starts green.
 *
 * Exit 0 = pass, 1 = fail with a printed list.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const problems = [];

function cssFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) cssFiles(p, out);
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** line numbers (1-based) of structural problems in one file */
function structural(file, css) {
  const clean = stripComments(css);
  const lines = clean.split('\n');
  let brace = 0;
  let paren = 0;
  lines.forEach((ln, i) => {
    for (const ch of ln) {
      if (ch === '{') brace++;
      if (ch === '}') brace--;
      if (ch === '(') paren++;
      if (ch === ')') paren--;
      if (brace < 0) problems.push(`${file}:${i + 1}: unexpected "}"`);
      if (paren < 0) problems.push(`${file}:${i + 1}: unexpected ")"`);
    }
    for (const hex of ln.matchAll(/#([0-9a-fA-F]+)(?![0-9a-fA-F-])/g)) {
      if (![3, 4, 6, 8].includes(hex[1].length)) {
        problems.push(`${file}:${i + 1}: invalid hex color "#${hex[1]}"`);
      }
    }
  });
  if (brace !== 0) problems.push(`${file}: unbalanced braces (${brace > 0 ? 'missing ' + brace + ' "}"' : 'extra ' + -brace + ' "}"'})`);
  if (paren !== 0) problems.push(`${file}: unbalanced parentheses (${paren})`);
}

/** line numbers (1-based) where a white background declaration sits inside a dark block */
function whiteInDarkLines(css) {
  const clean = stripComments(css);
  const lines = clean.split('\n');
  const stack = [];
  const hits = new Set();
  let buf = '';
  lines.forEach((ln, i) => {
    // accumulate selector text until "{"
    for (let k = 0; k < ln.length; k++) {
      const ch = ln[k];
      if (ch === '{') {
        stack.push(buf.trim());
        buf = '';
      } else if (ch === '}') {
        stack.pop();
        buf = '';
      } else if (ch === ';') {
        const decl = (buf + ln.slice(0, 0)).trim();
        buf = '';
        void decl;
      } else {
        buf += ch;
      }
    }
    const decl = buf.trim();
    const darkCtx = stack.some((s) => /data-theme=["']?dark/i.test(s));
    if (darkCtx && /(background|background-color)\s*:\s*(#fff\b|#ffffff\b|white\b)/i.test(decl) && !/transparent/i.test(decl)) {
      hits.add(i + 1);
    }
    if (ln.includes(';')) buf = '';
  });
  return hits;
}

function addedLines(file, base) {
  try {
    const out = execSync(
      `git diff -U0 --no-color ${base}...HEAD -- "${file}"`,
      { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    const added = new Set();
    let cur = 0;
    for (const ln of out.split('\n')) {
      const h = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (h) {
        cur = Number(h[1]);
        continue;
      }
      if (ln.startsWith('+') && !ln.startsWith('+++')) {
        added.add(cur);
        cur++;
      } else if (ln.startsWith(' ') || ln.startsWith('-')) {
        if (ln.startsWith(' ')) cur++;
      }
    }
    return added;
  } catch {
    return null;
  }
}

// ---- run ------------------------------------------------------------------
const files = cssFiles(path.join(root, 'src'));
for (const f of files) structural(path.relative(root, f), readFileSync(f, 'utf8'));

// dark-force last in main.tsx
const main = readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
const cssImports = [...main.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1]);
if (cssImports.length && !/dark-force\.css$/.test(cssImports[cssImports.length - 1])) {
  problems.push(`src/main.tsx: dark-force.css must be the LAST css import (found "${cssImports[cssImports.length - 1]}" after it)`);
}

// PR mode: no NEW white-in-dark declarations
const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null;
if (base) {
  for (const f of files) {
    const rel = path.relative(root, f);
    const hits = whiteInDarkLines(readFileSync(f, 'utf8'));
    if (!hits.size) continue;
    const added = addedLines(rel, base);
    if (!added) continue;
    for (const ln of hits) {
      if (added.has(ln)) problems.push(`${rel}:${ln}: new white background inside a dark-theme block`);
    }
  }
}

if (problems.length) {
  console.error('CSS guard FAILED:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`CSS guard OK — ${files.length} stylesheets checked.`);
