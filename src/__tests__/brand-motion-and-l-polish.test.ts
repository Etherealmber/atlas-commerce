import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AtlasLoader } from '../components/brand/AtlasLoader';
import { SidebarBrandLogo } from '../components/brand/SidebarBrandLogo';
import { ATLAS_BEAM, ATLAS_EASE, MARK_CENTER, TICK_INNER, TICK_OUTER, atlasTicks } from '../components/brand/atlasMark';
import { ATLAS_LETTERS, LOCKUP_WIDTH, WORDMARK_X } from '../components/brand/atlasWordmark';
import { PHONE_ONBOARDING_STEPS, spotlightRect } from '../mobile/PhoneOnboarding';

const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8');
const css = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '');

describe('sunburst brand mark', () => {
  it('keeps the original geometry: 15 ticks + a beam toward the wordmark', () => {
    const ticks = atlasTicks();
    expect(ticks).toHaveLength(15);
    for (const t of ticks) {
      expect(Math.hypot(t.x1 - MARK_CENTER, t.y1 - MARK_CENTER)).toBeCloseTo(TICK_INNER, 0);
      expect(Math.hypot(t.x2 - MARK_CENTER, t.y2 - MARK_CENTER)).toBeCloseTo(TICK_OUTER, 0);
    }
    expect(ATLAS_BEAM).toEqual({ x1: 126, y1: 126, x2: 251, y2: 126 });
    expect(ATLAS_EASE).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(ATLAS_LETTERS.map((l) => l.ch).join('')).toBe('Atlas');
    expect(WORDMARK_X).toBeGreaterThan(251);
    expect(LOCKUP_WIDTH).toBe(735);
  });

  it('SidebarBrandLogo keeps the wordmark in the DOM when collapsed (no display:none)', () => {
    const open = renderToStaticMarkup(createElement(SidebarBrandLogo, { isCollapsed: false, subtitle: 'Stock & facturation' }));
    const closed = renderToStaticMarkup(createElement(SidebarBrandLogo, { isCollapsed: true, subtitle: 'Stock & facturation' }));
    expect(open).toContain('atlas-brand-word');
    expect(closed).toContain('atlas-brand-word');
    expect(closed).toContain('is-collapsed');
    expect(closed).toContain('Atlas Commerce');
    expect(open).toContain('Stock &amp; facturation');
    const brand = css('src/components/brand/atlas-brand.css');
    expect(brand).not.toMatch(/display:\s*none/);
    expect(brand).toMatch(/cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
    expect(brand).toMatch(/prefers-reduced-motion/);
    expect(brand).toMatch(/clip-path/);
  });

  it('AtlasLoader: splash lockup with status, inline mark, decorative when the label is empty', () => {
    const splash = renderToStaticMarkup(createElement(AtlasLoader, { mode: 'splash' }));
    expect(splash).toContain('atlas-loader--splash');
    expect(splash).toContain('atlas-loader-word');
    expect(splash).toContain('Chargement…');
    const inline = renderToStaticMarkup(createElement(AtlasLoader, { label: 'Analyse…' }));
    expect(inline).toContain('role="status"');
    expect(inline).toContain('aria-label="Analyse…"');
    const deco = renderToStaticMarkup(createElement(AtlasLoader, { label: '' }));
    expect(deco).toContain('aria-hidden="true"');
    expect(deco).not.toContain('role="status"');
    expect(css('src/components/brand/atlas-brand.css')).toMatch(/100dvh/);
  });
});

describe('mobile guided tour opens its pages', () => {
  it('routes products / agent / profile and unions the raised Scan icon', () => {
    const byId = Object.fromEntries(PHONE_ONBOARDING_STEPS.map((s) => [s.id, s]));
    expect(byId.products.route).toBe('/m/products');
    expect(byId.agent.route).toBe('/m/agent');
    expect(byId.profile.route).toBe('/m/profile');
    const rect = (top: number, left: number, w: number, h: number) => ({ top, left, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) });
    const child = { getBoundingClientRect: () => rect(700, 170, 50, 50) };
    const el = { getBoundingClientRect: () => rect(736, 160, 70, 60), querySelectorAll: () => [child] } as unknown as Element;
    expect(spotlightRect(el)).toEqual({ top: 700, left: 160, width: 70, height: 96 });
  });

  it('Atlas Agent pending reply is a shimmer skeleton, not three dots', () => {
    const app = read('src/mobile/PhoneApp.tsx');
    expect(app).toContain('ph-agent-pending');
    expect(app).toContain('ph-agent-shimmer');
    const phone = css('src/mobile/phone.css');
    expect(phone).toMatch(/\.ph-agent-shimmer/);
    expect(phone).toMatch(/prefers-reduced-motion/);
  });
});

describe('audit journal, tables and D1 target', () => {
  it('audit controls live in one toolbar above the search; no duplicate range select', () => {
    const s = read('src/pages/Settings.tsx');
    expect(s).toContain('journal-toolbar');
    expect(s).toContain('<TopPageActions>');
    expect(s).toContain('<ApiLogPanel range={auditRange} />');
    expect(s).not.toMatch(/<option[^>]*>\s*7 derniers jours/);
  });

  it('tables restyle every list but the Products catalogue', () => {
    expect(read('src/pages/Products.tsx')).toContain('ac-catalog-table');
    const t = css('src/styles/tables.css');
    expect(t).toMatch(/table:not\(\.ac-catalog-table\)/);
    expect(t).not.toMatch(/:not\(\.ac-products-table\)/);
    expect(read('src/main.tsx')).toMatch(/styles\/tables\.css/);
  });

  it('binds DB_TARGET by name and the workflow can set it up with CF_API_TOKEN + CF_ZONE_ID', () => {
    const w = read('wrangler.jsonc');
    expect(w).toMatch(/"binding":\s*"DB_TARGET"[\s\S]*?"database_name":\s*"atlas-db"/);
    const wf = read('.github/workflows/d1-migrations-apply.yml');
    expect(wf).toContain('setup-target');
    expect(wf).toContain('secrets.CF_API_TOKEN');
    expect(wf).toContain('secrets.CF_ZONE_ID');
    expect(read('src/components/DbMigrationPanel.tsx')).toContain('setup-target');
  });

  it('compact top actions are round 40px buttons (36px in compact density)', () => {
    const shell = css('src/styles/shell.css');
    expect(shell).toMatch(/desktop-catalog-actions-slot--compact[^{]*\{[^}]*border-radius:\s*999px/);
    expect(shell).toMatch(/width:\s*40px/);
    expect(shell).toMatch(/html\[data-ui-density="compact"\][^{]*desktop-catalog-actions-slot--compact[^{]*\{[^}]*36px/);
  });
});
