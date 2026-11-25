import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const abs = (p: string) => path.resolve(process.cwd(), p);
const read = (p: string) => readFileSync(abs(p), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('button-groups layer', () => {
  const main = read('src/main.tsx');
  const css = stripComments(read('src/styles/button-groups.css'));

  it('loads after input-actions and before dark-force', () => {
    const groups = main.indexOf("import './styles/button-groups.css'");
    expect(groups).toBeGreaterThan(-1);
    expect(groups).toBeGreaterThan(main.indexOf("import './styles/input-actions.css'"));
    expect(groups).toBeLessThan(main.indexOf("import './styles/dark-force.css'"));
  });

  it('gives header action rows one 36px pill', () => {
    expect(css).toMatch(/\.ac-head-actions[\s\S]*?height: 36px !important;[\s\S]*?border-radius: 999px !important;/);
  });

  it('pairs a field and its submit button at 44px', () => {
    expect(css).toMatch(/\.ac-erp-toolbar[\s\S]*?height: 44px !important;/);
  });

  it('makes every popup footer (modal, modal-card, annotator) 40px pills', () => {
    expect(css).toContain(':is(.modal, .modal-card, .ia-modal) :is(.dialog-actions, .modal-actions, .ac-modal-foot, .ac-att-modal-foot, .form-actions, .ia-foot)');
    const foot = css.slice(css.indexOf(':is(.modal, .modal-card, .ia-modal)'));
    expect(foot).toMatch(/height: 40px !important;[\s\S]*?border-radius: 999px !important;/);
    expect(css).toMatch(/\.ac-confirm-foot > button[^{]*\{[^}]*height: 40px !important;[^}]*border-radius: 999px !important;/);
  });

  it('turns the annotator save into the primary action', () => {
    const src = read('src/components/ui/ImageAnnotator.tsx');
    expect(src).toContain('className="btn" disabled={!dirty} onClick={save}');
  });

  it('fills every status badge as a one-line pill', () => {
    for (const tone of ['warning', 'danger', 'info', 'success']) expect(css).toContain(`.badge.${tone}`);
    expect(css).toMatch(/\.badge:is\(\.success, \.warning, \.danger, \.info\)[^{]*\{[^}]*white-space: nowrap !important;[^}]*border-radius: 999px !important;/);
  });

  it('aligns the Support form actions and keeps document numbers on one line', () => {
    expect(css).toMatch(/\.dl-support-actions > \.support-cta-btn[^{]*\{[^}]*height: 46px !important;[^}]*border-radius: 999px !important;/);
    expect(css).toMatch(/\.ac-number-link[^{]*\{[^}]*white-space: nowrap !important;/);
  });

  it('uses only g–z boost ids (never read as hex colours)', () => {
    for (const m of css.matchAll(/#grp-([a-z])/g)) expect(m[1] >= 'g').toBe(true);
  });
});

describe('homepage feature cards are live app UI', () => {
  const home = read('src/pages/Home.tsx');

  it('renders the live demos instead of screenshots', () => {
    for (const demo of ['StockDemo', 'SalesDemo', 'InvoiceDemo', 'AgingDemo', 'AgentDemo']) expect(home).toContain(`<${demo} />`);
    expect(home).not.toMatch(/ThemeShot name="(feature|site-agent)/);
  });

  it('removed the captures, the AI demo photos and their capture script', () => {
    for (const name of ['feature-stock', 'feature-sales', 'feature-invoice', 'feature-aging']) {
      for (const theme of ['light', 'dark']) expect(existsSync(abs(`public/shots/${name}-${theme}.webp`))).toBe(false);
    }
    expect(existsSync(abs('public/shots/demo-products'))).toBe(false);
    expect(existsSync(abs('scripts/capture-feature-shots.mjs'))).toBe(false);
    const demos = read('src/components/home/FeatureDemos.tsx');
    expect(demos).not.toMatch(/<img|\.webp|\.png|\.jpe?g/);
  });

  it('enlarges the hero showcase beyond the text column', () => {
    const app = read('src/App.css');
    expect(app).toContain('--hm-show-w: min(1440px, calc(100vw - 64px));');
    expect(app).toMatch(/\.home-landing \.hm-phone-shot \{ max-width: 270px;/);
  });
});
