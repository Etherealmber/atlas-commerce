import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without types
import { renderDemoMigrations } from '../../scripts/gen-demo-migrations.mjs';
import { DEMO_MIGRATIONS } from '../lib/demo/migrations';

describe('demo sandbox migrations bundle', () => {
  it('is in sync with migrations/*.sql (run `npm run gen:demo-migrations`)', () => {
    expect(readFileSync('worker/lib/demo/migrations.generated.ts', 'utf8')).toBe(renderDemoMigrations());
    expect(DEMO_MIGRATIONS.map((m) => m.name)).toEqual(readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort());
  });
  it('worker code never relies on a bare import.meta.glob (Vite-only; crashes plain wrangler dev)', () => {
    const src = readFileSync('worker/lib/demo/migrations.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toContain('import.meta.glob');
  });
});
