/**
 * v0.9.3 (O) — phone scan page, phone KPI strip, Settings unsaved bar,
 * bottom toasts and modern file inputs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { kpiValue, HOME_KPIS, EMPLOYEE_KPIS, CLIENT_KPIS, SCAN_KPIS } from '../mobile/PhoneKpis';

const read = (f: string) => readFileSync(f, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('phone scan page', () => {
  const src = read('src/mobile/PhoneApp.tsx');
  it('drops « En ligne », Image, Contrôle rayon and « Envoyés aujourd’hui »', () => {
    expect(src).not.toContain("'En ligne'");
    expect(src).not.toContain('Contrôle rayon');
    expect(src).not.toContain('Envoyés aujourd');
    expect(src).not.toContain('ph-scan-file-input');
    expect(src).not.toContain('decodeImageFile');
  });
  it('shows « Hors ligne » only offline and puts « Ajouter un produit » in the header', () => {
    expect(src).toMatch(/\{!isOnline\(\) && <span className="ph-scan-status is-offline"[^>]*>Hors ligne<\/span>\}/);
    expect(src).toMatch(/className="ph-scan-add"[^>]*onClick=\{openAddProduct\}/);
  });
  it('the manual code card only renders after a failed scan', () => {
    expect(src).toContain('const [scanFailed, setScanFailed] = useState(false);');
    expect(src).toContain('{showManualCode && <>');
    expect(src).toMatch(/const showManualCode = scanFailed \|\|/);
    // every failure path flips the flag
    expect(src.match(/setScanFailed\(true\)/g)!.length).toBeGreaterThanOrEqual(5);
  });
  it('renders the KPI strip on scan, home, employees and clients', () => {
    expect(src).toContain('<PhoneKpiStrip items={SCAN_KPIS}');
    expect(read('src/mobile/PhoneHome.tsx')).toContain('<PhoneKpiStrip items={HOME_KPIS}');
    expect(read('src/mobile/PhoneEmployees.tsx')).toContain('<PhoneKpiStrip items={EMPLOYEE_KPIS}');
    expect(read('src/mobile/PhoneClients.tsx')).toContain('<PhoneKpiStrip items={CLIENT_KPIS}');
  });
});

describe('phone KPI values', () => {
  it('flows sum the current period, levels take the latest known value', () => {
    expect(kpiValue([1, 2, 3, 4, 5, 6], 'flow', 3)).toBe(15);
    expect(kpiValue([1, null, 4], 'flow', 3)).toBe(5);
    expect(kpiValue([7, 9, null], 'level', 3)).toBe(9);
    expect(kpiValue([null, null], 'level', 2)).toBeNull();
    expect(kpiValue(undefined, 'flow', 7)).toBeNull();
  });
  it('only uses keys the metrics endpoint serves', () => {
    const metrics = read('worker/routes/metrics.ts');
    for (const kpi of [...HOME_KPIS, ...EMPLOYEE_KPIS, ...CLIENT_KPIS, ...SCAN_KPIS]) {
      expect(metrics, kpi.k).toMatch(new RegExp(`\\b${kpi.k}: '(flow|level)'`));
    }
  });
});

describe('Settings unsaved bar and backup toast', () => {
  const src = read('src/pages/Settings.tsx');
  it('every in-form edit marks the page dirty, and the bar shows as soon as it is', () => {
    expect(src).toContain('const editSettings = (fn: (prev: any) => any) => {');
    const after = src.slice(src.indexOf('const editSettings'));
    expect(after).not.toMatch(/\bsetSettings\(\(prev: any\) =>/);
    expect(src).toContain('{canSaveSection && (settingsDirty || (justSaved && !topActionsVisible) || blockedNotice) && createPortal(');
  });
  it('keeps the inline « Enregistrer toutes les règles » button (both save paths)', () => {
    expect(src).toContain('Enregistrer toutes les règles');
  });
  it('listing backups no longer toasts a count', () => {
    expect(src).not.toMatch(/sauvegarde\(s\)`, 'success'/);
  });
});

describe('toasts and file inputs', () => {
  it('toasts sit at the bottom', () => {
    const css = stripComments(read('src/index.css'));
    const rule = /\.app-toast-stack \{([^}]*)\}/.exec(css)![1];
    expect(rule).toMatch(/top: auto/);
    expect(rule).toMatch(/bottom: calc\(18px \+ env\(safe-area-inset-bottom/);
  });
  it('visible file inputs get the drop-zone style with a pill button', () => {
    const css = stripComments(read('src/styles/form-controls.css'));
    expect(css).toMatch(/input\[type="file"\][^{]*:not\(#up-g\):not\(#up-h\):not\(#up-i\) \{[^}]*border: 1\.5px dashed/);
    expect(css).toMatch(/::file-selector-button \{[^}]*border-radius: 999px/);
  });
});
