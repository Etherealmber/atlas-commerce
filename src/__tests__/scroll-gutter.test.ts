import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextGutterState } from '../lib/scrollGutter';

const base = { current: false, scrollbarWidth: 15, scrollHeight: 3000, viewportHeight: 800, locked: false };

describe('scroll gutter (hamburger / modal locks never shift the page)', () => {
  it('reserves the gutter when a classic scrollbar is visible', () => {
    expect(nextGutterState(base)).toBe(true);
  });

  it('keeps the gutter while a scroll lock hides the scrollbar', () => {
    expect(nextGutterState({ ...base, current: true, locked: true })).toBe(true);
    expect(nextGutterState({ ...base, current: true, locked: true, scrollHeight: 500 })).toBe(true);
  });

  it('does nothing with overlay scrollbars (phones, macOS)', () => {
    expect(nextGutterState({ ...base, scrollbarWidth: 0 })).toBe(false);
    expect(nextGutterState({ ...base, current: true, scrollbarWidth: 0 })).toBe(false);
  });

  it('releases the gutter once the page no longer scrolls', () => {
    expect(nextGutterState({ ...base, current: true, scrollHeight: 700 })).toBe(false);
    expect(nextGutterState({ ...base, current: true, scrollHeight: 2000 })).toBe(true);
  });

  it('does not add a gutter in the middle of a lock', () => {
    expect(nextGutterState({ ...base, locked: true })).toBe(false);
  });

  it('is wired in main.tsx and styled in index.css', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    expect(main).toMatch(/installScrollGutter\(/);
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/html\.atlas-vscroll:not\(\.phone-shell\)\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });
});

describe('focus menu scrim (About / Nouveautés / legal pages)', () => {
  it('stays a translucent veil in dark mode — the page behind it never "disappears"', () => {
    const css = readFileSync(new URL('../styles/focus-sidebar.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /button\.atlas-focus-backdrop:not\(#scrim-g\):not\(#scrim-h\):not\(#scrim-i\)[^{]*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background:\s*rgba\(5, 7, 12, 0\.52\)\s*!important/);
    expect(rule![1]).toMatch(/backdrop-filter:\s*blur\(4px\)\s*!important/);
  });
});
