import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('settings « Annuler » reverts in place', () => {
  const src = read('src/pages/Settings.tsx');

  it('never reloads the page', () => {
    expect(src).not.toMatch(/location\.reload\(/);
    expect(src).toContain('className="secondary settings-sticky-discard" disabled={saving} onClick={discardSettings}');
  });

  it('restores the last loaded / saved snapshot', () => {
    expect(src).toContain('const savedSettingsRef = useRef<any>(null);');
    const discard = src.slice(src.indexOf('const discardSettings = () => {'), src.indexOf('const save = async () => {'));
    expect(discard).toContain('setSettings(savedSettingsRef.current)');
    expect(discard).toContain('setSettingsDirty(false)');
    expect(discard).toContain('setFieldErrors({})');
    // snapshot refreshed on load and after a successful save
    expect(src).toMatch(/savedSettingsRef\.current = next; setSettings\(next\);/);
    expect(src).toMatch(/setSettings\(res\.data\);\s*savedSettingsRef\.current = res\.data;/);
  });
});

describe('buttons beside fields + save bar', () => {
  const css = stripComments(read('src/styles/input-actions.css'));

  it('is loaded after element-pills and before dark-force', () => {
    const main = read('src/main.tsx');
    const a = main.indexOf("import './styles/element-pills.css'");
    const b = main.indexOf("import './styles/input-actions.css'");
    const c = main.indexOf("import './styles/dark-force.css'");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('stretches field-adjacent buttons to the field height and flattens disabled ones', () => {
    expect(css).toMatch(/:has\(> :is\(input:not\(\[type="checkbox"\]\)[^{]+> button:not\(\[aria-label\]\)[^{]+\{[^}]*align-self: stretch !important;[^}]*min-height: 40px !important;[^}]*opacity: 1 !important/);
    expect(css).toMatch(/> button:disabled:not\(\[aria-label\]\)[^{]+\{[^}]*background: var\(--ia-disabled-bg\) !important;[^}]*cursor: not-allowed !important/);
    // four ID boosts beat element-pills (three)
    expect(css).toContain(':not(#ia-a):not(#ia-b):not(#ia-c):not(#ia-d)');
  });

  it('save bar: neutral « Annuler » pill + dark primary « Enregistrer », both 36px', () => {
    expect(css).toMatch(/\.settings-sticky-save-actions > button\.secondary \{[^}]*height: 36px !important;[^}]*background: var\(--ia-soft\) !important/);
    expect(css).toMatch(/\.settings-sticky-save-actions > \.ac-save-toggle \{[^}]*height: 36px !important;[^}]*background: var\(--ia-primary\) !important/);
    expect(css).toMatch(/html\[data-theme="dark"\] \{[^}]*--ia-primary: #f4f4f5;/);
  });

  it('OTP rows align field + Confirmer + Annuler and drop the black ghost button', () => {
    for (const p of ['src/components/AccountSecurityPanel.tsx', 'src/components/AgentSecurityPanel.tsx']) {
      const src = read(p);
      expect(src).toContain('<div className="ac-otp-row">');
      expect(src).not.toContain('className="btn ghost"');
      expect(src).toContain('className="btn secondary" onClick={() => setOtp(null)}>Annuler');
    }
    expect(css).toMatch(/html\[data-theme="dark"\] body \.ac-otp-row[^{]*> input \{[^}]*background: #1c1c1f !important/);
  });

  it('knowledge « Mémoriser » / « Ajouter » are primary actions', () => {
    const src = read('src/components/settings/AgentKnowledgePanel.tsx');
    expect(src).toMatch(/className="primary"\s*disabled=\{busy \|\| !mem\.trim\(\)\}/);
    expect(src).toMatch(/className="primary"\s*disabled=\{busy \|\| !rule\.trim\(\)\}/);
  });
});
