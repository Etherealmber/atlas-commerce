// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TimedUndoDelete } from '../components/ui/TimedUndoDelete';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const read = (p: string) => readFileSync(p, 'utf8');

describe('in-element action pills (Produits row style on every page)', () => {
  const css = read('src/styles/element-pills.css');

  it('is loaded after density-compact and before dark-force', () => {
    const main = read('src/main.tsx');
    const at = (s: string) => main.indexOf(s);
    expect(at("import './styles/element-pills.css'")).toBeGreaterThan(at("import './styles/density-compact.css'"));
    expect(at("import './styles/element-pills.css'")).toBeLessThan(at("import './styles/dark-force.css'"));
  });

  it('only targets buttons inside elements (rows, panels, cards, Paramètres) — never page-header actions', () => {
    const scope = ':is(.ac-panel, .card, .settings-main, .row-actions, .row-actions-cell, .ac-ops-row-actions, .bal-tx-actions)';
    expect(css).toContain(`html body ${scope} button:is(.secondary, .danger)`);
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/top-page-actions|ac-desktop-dock|page-header/);
    for (const skip of ['.ac-seg-btn', '.ac-pager-hit', '[role="switch"]', '[role="tab"]', '[aria-pressed]', '.quote-number-link', '.pc-act']) {
      expect(css).toContain(skip);
    }
  });

  it('uses the exact Produits pill tokens in light and dark, a red danger pill and a compact variant', () => {
    expect(css).toMatch(/--pill-line: #e8eaef;[\s\S]*--pill-bg: #f4f4f5;[\s\S]*--pill-ink: #0f172a;/);
    expect(css).toMatch(/html\[data-theme="dark"\] \{[^}]*--pill-line: #2a2a2e;[^}]*--pill-bg: #26262b;[^}]*--pill-ink: #f4f4f5;/);
    expect(css).toMatch(/height: 32px !important;[\s\S]*padding: 0 12px 0 10px !important;[\s\S]*border-radius: 999px !important;[\s\S]*font-size: 12\.5px !important;/);
    expect(css).toContain('background: var(--pill-danger-bg) !important;');
    expect(css).toMatch(/html\[data-ui-density="compact"\][^{]*button:is\(\.secondary, \.danger\)[^{]*\{\s*height: 28px !important;/);
    expect(css).toContain(':not(#pill-a):not(#pill-b):not(#pill-c)');
  });

  it('row / card deletes are the red round trash; header bulk deletes and danger zones keep their label', () => {
    const iconRows: Record<string, number> = {
      Balance: 1, Bills: 2, Clients: 2, Employees: 2, InventoryOps: 2, Invoices: 1, QuickSale: 1,
      Quotes: 1, Receipts: 1, Reimbursements: 1, Settings: 4, Vendors: 2,
    };
    for (const [page, n] of Object.entries(iconRows)) {
      const src = read(`src/pages/${page}.tsx`);
      expect(src.split('<TimedUndoDelete iconOnly width="34px"').length - 1, page).toBe(n);
    }
    expect(read('src/pages/Bills.tsx')).toMatch(/<TimedUndoDelete\s+deleteLabel=\{`Supprimer \(\$\{selected\.size\}\)`\}/);
    expect(read('src/pages/InvoiceDetail.tsx')).toMatch(/ac-danger-zone-actions[\s\S]*<TimedUndoDelete\s+deleteLabel="Supprimer"/);
  });

  it('TimedUndoDelete marks the icon variant so the pill CSS can size it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement('div', null,
      createElement(TimedUndoDelete, { iconOnly: true, deleteLabel: 'Supprimer DV-1' }),
      createElement(TimedUndoDelete, { deleteLabel: 'Supprimer' }),
    )));
    const [icon, labelled] = [...host.querySelectorAll('.ac-timed-delete')];
    expect(icon.classList.contains('ac-timed-delete--icon')).toBe(true);
    expect(icon.querySelector('[role="button"]')?.getAttribute('aria-label')).toBe('Supprimer DV-1');
    expect(labelled.classList.contains('ac-timed-delete--icon')).toBe(false);
    act(() => root.unmount());
    host.remove();
  });

  it('Paramètres row buttons drop their inline sizes so the pill applies', () => {
    const src = read('src/pages/Settings.tsx');
    expect(src).not.toContain("fontSize: 12, marginRight: 6");
    expect(src.split('<td className="row-actions-cell"').length - 1).toBeGreaterThanOrEqual(4);
  });

  it('the Devis number stays a blue text link (not a black button)', () => {
    const q = read('src/pages/quote-actions.css');
    expect(q).toMatch(/button\.quote-number-link:not\(#qnum-a\):not\(#qnum-b\) \{[^}]*background: transparent !important;[^}]*color: #2563eb !important;/);
  });
});

describe('D1 production migrations', () => {
  it('can be run by hand from Actions (list / apply with APPLY confirmation), never automatically', () => {
    const yml = read('.github/workflows/d1-migrations-apply.yml');
    expect(yml).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(yml).not.toMatch(/^\s*(push|pull_request|schedule):/m);
    expect(yml).toContain('environment: production');
    expect(yml).toMatch(/if: inputs\.action == 'apply' && inputs\.confirm != 'APPLY'[\s\S]*exit 1/);
    expect(yml).toContain('npx wrangler d1 migrations list DB --remote --config wrangler.jsonc');
    expect(yml).toMatch(/if: inputs\.action == 'apply'\n\s*run: \|[\s\S]*npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc/);
    expect(yml).toContain('GITHUB_STEP_SUMMARY');
  });

  it('the manual production deploy applies pending migrations right before uploading the code', () => {
    const yml = read('.github/workflows/rust-finance-wasm.yml');
    const migrate = yml.indexOf('npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc');
    const deploy = yml.indexOf('run: npx wrangler deploy --config dist/company_stock/wrangler.json', yml.indexOf('deploy-production:'));
    expect(migrate).toBeGreaterThan(yml.indexOf('deploy-production:'));
    expect(migrate).toBeGreaterThan(0);
    expect(migrate).toBeLessThan(deploy);
  });
});
