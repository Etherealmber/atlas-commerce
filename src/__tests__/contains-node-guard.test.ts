/**
 * Crash « Failed to execute 'contains' on 'Node': parameter 1 is not of type
 * 'Node' » (every page, desktop): React gives `window` as relatedTarget when
 * the pointer leaves the browser window from the top dock, and the handler
 * passed it straight to `el.contains()`. Event targets must be narrowed with
 * `instanceof Node` before `contains()`.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|ts)$/.test(p)) out.push(p);
  }
  return out;
}

describe('contains() never receives a non-Node event target', () => {
  it('no `(relatedTarget|target) as Node` cast feeds contains()', () => {
    const root = new URL('../', import.meta.url).pathname;
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const src = readFileSync(file, 'utf8');
      if (/contains\(\s*(e|ev|event)\.(related)?[tT]arget\s+as\s+Node\s*\)/.test(src) || /(relatedTarget|\.target)\s+as\s+Node(\s*\|\s*null)?\s*;/.test(src)) {
        offenders.push(file.slice(root.length));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the dock / actions leave + blur handlers narrow relatedTarget', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const uses = app.match(/=\s*event\.relatedTarget;/g) || [];
    expect(uses.length).toBe(3);
    expect((app.match(/instanceof Node && event\.currentTarget\.contains\(/g) || []).length).toBe(3);
  });
});
