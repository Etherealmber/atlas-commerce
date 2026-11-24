import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

describe('Neutral charcoal dark mode unification', () => {
  it('defines chart + inline surface tokens with dark-only --ac-ui-* (light keeps hex fallbacks)', () => {
    const theme = read('src/styles/theme.css');
    const darkBlock = theme.slice(theme.indexOf('html[data-theme="dark"] {'));
    const lightBlock = theme.slice(0, theme.indexOf('html[data-theme="dark"] {'));
    for (const tok of ['--ac-chart-blue', '--ac-chart-ink', '--ac-chart-grid', '--ac-chart-track']) {
      expect(lightBlock).toContain(`${tok}:`);
      expect(darkBlock).toContain(`${tok}:`);
    }
    for (const tok of ['--ac-ui-surface:', '--ac-ui-surface-2:', '--ac-ui-ink:', '--ac-ui-border:', '--ac-ui-solid:']) {
      expect(darkBlock).toContain(tok);
      expect(lightBlock).not.toContain(tok);
    }
  });

  it('keeps Balance mini-bar tones in dark mode instead of a flat grey fill', () => {
    const dark = read('src/styles/dark-force.css');
    expect(dark).not.toContain('.balance-chart-fill { background: #52525b !important; }');
    expect(dark).toMatch(/\.balance-chart-fill[^{]*\{[^}]*var\(--balance-bar/s);
    expect(read('src/pages/Balance.tsx')).toContain("'--balance-bar'");
  });

  it('removes blue-tinted surfaces from dark-force and ends with the neutral finale block', () => {
    const dark = read('src/styles/dark-force.css');
    expect(dark).not.toMatch(/#1e2128|#20232b|#272b35|#15171d|rgba\(22, 24, 30,/i);
    expect(dark.lastIndexOf('Neutral Charcoal finale')).toBeGreaterThan(dark.lastIndexOf('Complete Dimmed Charcoal unification'));
  });

  it('charts and inline-styled widgets no longer hardcode ink colours that vanish on charcoal', () => {
    expect(read('src/pages/Dashboard.tsx')).not.toMatch(/color: '#0f172a'/);
    expect(read('src/pages/Balance.tsx')).not.toMatch(/tone: '#0f172a'/);
    expect(read('src/components/RefreshIconButton.tsx')).not.toContain('fill="#0f172a"');
    expect(read('src/components/AtlasAgent.tsx')).not.toContain('stroke="#1a1d26"');
    const pager = read('src/components/ui/ListPager.tsx');
    expect(pager).not.toMatch(/setProperty\('background', '#ffffff'/);
    expect(pager).toContain('var(--ac-ui-surface, #ffffff)');
  });
});
