import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('login « Continuer » button states (v0.9.3)', () => {
  it('is not mislabelled as a theme toggle (inherited transparent / red [class*=toggle] states)', () => {
    const src = readFileSync('src/pages/Login.tsx', 'utf8');
    expect(src).toContain('className="atlas-login-submit"');
    expect(src).not.toMatch(/atlas-login-submit[^"]*theme-toggle/);
  });
  it('pins background + label colour for hover, active, touch and disabled in both themes', () => {
    const css = strip(readFileSync('src/styles/login-auth.css', 'utf8'));
    const base = 'button.atlas-login-submit:not(#lg-g1):not(#lg-g2)';
    for (const state of [':active:not(:disabled)', ':hover:not(:disabled)', ':hover:not(:active)', ':disabled']) {
      expect(css).toContain(`.atlas-login.atlas-login--auth7 ${base}${state}`);
      expect(css).toContain(`html[data-theme="dark"].atlas-login-page body .atlas-login.atlas-login--auth7 ${base}${state}`);
    }
    expect(css).toContain('-webkit-tap-highlight-color: transparent');
    expect(css).toMatch(/@media \(hover: none\)/);
  });
  it('demo logins skip the passkey / biometric enrolment offer', () => {
    const src = readFileSync('src/pages/Login.tsx', 'utf8');
    expect(src).toContain('const skipBioOffer = !!data.demo?.active || isDemoToken(data.token);');
  });
});
