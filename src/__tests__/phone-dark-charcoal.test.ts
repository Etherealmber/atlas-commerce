import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const darkForce = readFileSync(resolve(__dirname, '../styles/dark-force.css'), 'utf8');
const phone = readFileSync(resolve(__dirname, '../mobile/phone.css'), 'utf8');

describe('phone shell dark mode — unified charcoal controls', () => {
  it('keeps desktop dark button slabs (#3f3f46 / #c7cbd6 hover) out of the phone shell and user menu', () => {
    const slab = darkForce.split('\n').filter((l) => /^html\[data-theme="dark"\][^{]*:where\(\.btn, button\)/.test(l));
    expect(slab.length).toBeGreaterThan(0);
    for (const line of slab) {
      expect(line).toContain(':not(.phone-shell)');
      expect(line).toContain(':not(.ac-user-dropdown-item)');
    }
    expect(darkForce).toMatch(/html\[data-theme="dark"\]:not\(\.phone-shell\) body button:hover:not\(:disabled\)/);
  });

  it('renders user-menu rows flat on the charcoal panel', () => {
    expect(darkForce).toMatch(/\.ac-user-dropdown-item \{\s*background: transparent !important;/);
    expect(darkForce).toMatch(/\.ac-user-dropdown-item:is\(:hover, :focus-visible\) \{\s*background: #202024 !important;/);
  });

  it('defines the phone charcoal palette and scopes overrides above legacy phone rules', () => {
    expect(phone).toContain('--pd-control: #202024');
    expect(phone).toContain('--pd-card: #18181b');
    expect(phone).toMatch(/html\[data-theme="dark"\]\.phone-shell body #root \.phone-root/);
    // the unified block must be the last dark section in phone.css
    const block = phone.indexOf('Phone dark — unified neutral charcoal controls');
    expect(block).toBeGreaterThan(phone.lastIndexOf('html[data-theme="dark"] .pb-page'));
  });

  it('neutralises the desktop [class*="notif"] catch-all on the phone Info Box page', () => {
    expect(phone).toMatch(/:is\(\.ph-notifications, \.ph-notifications-section, \.ph-notifications-intro-row\)/);
  });
});
