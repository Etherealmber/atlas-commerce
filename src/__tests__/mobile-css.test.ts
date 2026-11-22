import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('mobile theme stylesheets', () => {
  it('lets Agent conversation content scroll behind the floating dock', () => {
    const css = readFileSync('src/mobile/phone.css', 'utf8');
    expect(css).toMatch(/\.ph-agent-msgs\s*\{\s*margin-top:\s*0\s*!important;\s*padding-top:\s*calc\(76px\s*\+\s*env\(safe-area-inset-top,\s*0px\)\)/);
  });
  it('constrains the live scanner and keeps its canvas over the preview', () => {
    const css = readFileSync('src/mobile/phone.css', 'utf8');
    expect(css).toMatch(/\.ph-cam-wrap\s*\{[^}]*height:\s*clamp\(220px,\s*48vw,\s*320px\)/s);
    expect(css).toMatch(/\.ph-cam-wrap\s+\.ph-scan-reader canvas\s*\{[^}]*position:\s*absolute\s*!important/s);
  });
  it('keeps product icon controls visible in both themes', async () => {
    const history = readFileSync('src/pages/product-history.css', 'utf8');
    const products = readFileSync('src/pages/products-mobile-style.css', 'utf8');
    for (const css of [history, products]) expect((await transform(css, { loader: 'css', logLevel: 'silent' })).warnings).toEqual([]);
    expect(history).toContain('product-history-photo-action svg');
    expect(history).toContain('product-history-refresh svg');
    expect(history).toMatch(/product-history-photo-action svg,[\s\S]*?stroke:\s*currentColor\s*!important/);
    expect(history).toContain('html[data-theme="dark"] body .product-history');
    expect(products).toContain('button.secondary[aria-pressed="true"]');
    expect(products).toContain('stroke: currentColor !important');
  });
  it('keeps Android-style floating chrome bounded, themed and motion-aware', () => {
    const css = readFileSync('src/mobile/phone.css', 'utf8');
    expect(css).toContain('.ptab.active:not(.ptab-scan)::before');
    expect(css).toContain('bottom: calc(18px + env(safe-area-inset-bottom, 0px))');
    expect(css).toContain('.phone-topbar.is-collapsed { height: 44px');
    expect(css).toContain('width: min(280px, calc(100vw - 64px))');
    expect(css).toContain('html[data-theme="dark"].phone-shell body .phone-root .phone-tabbar .ptab.active { background: transparent');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
  it('defines visible report selection and preview controls in both themes', () => {
    const css = readFileSync('src/mobile/phone.css', 'utf8');
    expect(css).toContain('.ph-bundle-chips button[aria-pressed="true"]');
    expect(css).toContain('html[data-theme="dark"].phone-shell body .ph-bundle-modal .ph-bundle-chips button[aria-pressed="true"]');
    expect(css).toContain('html[data-theme="dark"].phone-shell body .ph-report-modal .ph-report-tabs button[aria-pressed="true"]');
    expect(css).toContain('html.phone-shell body .ph-report-modal .ph-report-frame { background: #fff !important');
    expect(css).toContain('.phone-root--no-motion .ph-mascot');
  });
  it('does not hide the mobile browser Turnstile container', () => {
    const indexCss = readFileSync('src/index.css', 'utf8');
    const authCss = readFileSync('src/styles/login-auth.css', 'utf8');
    expect(indexCss).not.toMatch(/\.atlas-login--phone\s+(?:\.atlas-turnstile|#cf-turnstile)[^{]*\{[^}]*(?:display:\s*none|visibility:\s*hidden|height:\s*0|pointer-events:\s*none)/s);
    expect(authCss).toMatch(/#cf-turnstile\s*\{[^}]*visibility:\s*visible\s*!important/s);
    expect(authCss).toMatch(/#cf-turnstile\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
  });
  it.each(['src/mobile/phone.css', 'src/styles/login-auth.css', 'src/styles/dark-force.css'])('%s parses without CSS syntax warnings', async (file) => {
    const result = await transform(readFileSync(file, 'utf8'), { loader: 'css', logLevel: 'silent' });
    expect(result.warnings.map((warning) => warning.text)).toEqual([]);
  });
});
