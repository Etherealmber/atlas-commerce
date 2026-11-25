// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { themedShotSrc, useThemedShot } from '../lib/useDocTheme';
import { normalizeMetricsDaily } from '../lib/metricSeries';
import { AtlasLockup } from '../components/brand/AtlasLockup';

const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('demo captures follow the theme', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-theme'); document.body.innerHTML = ''; });

  it('maps the phone and desktop captures to their dark versions, which exist', () => {
    for (const n of ['phone-home-demo', 'phone-products-demo', 'phone-balance-demo', 'desktop-products-demo']) {
      expect(themedShotSrc(`/shots/${n}.webp`, 'dark')).toBe(`/shots/${n}-dark.webp`);
      expect(themedShotSrc(`/shots/${n}.webp`, 'light')).toBe(`/shots/${n}.webp`);
      expect(existsSync(`public/shots/${n}-dark.webp`)).toBe(true);
    }
    // No dark capture → keep the light one rather than a broken image.
    expect(themedShotSrc('/shots/android-scan-demo.webp', 'dark')).toBe('/shots/android-scan-demo.webp');
  });

  it('switches live when the page theme changes', async () => {
    function Probe() { return createElement('img', { src: useThemedShot('/shots/phone-products-demo.webp') }); }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(Probe)); });
    expect(host.querySelector('img')!.getAttribute('src')).toBe('/shots/phone-products-demo.webp');
    await act(async () => { document.documentElement.setAttribute('data-theme', 'dark'); await new Promise((r) => setTimeout(r, 0)); });
    expect(host.querySelector('img')!.getAttribute('src')).toBe('/shots/phone-products-demo-dark.webp');
    await act(async () => { root.unmount(); });
  });

  it('is used by the home page, the download/desktop previews and the phone welcome', () => {
    expect(read('src/pages/Home.tsx')).toContain("useThemedShot('/shots/phone-products-demo.webp')");
    expect(read('src/components/DownloadPreview.tsx')).toContain("shot('/shots/desktop-products-demo.webp')");
    expect(read('src/components/DownloadHeroVisual.tsx')).toContain('useThemedShot(');
    expect(read('src/mobile/PhoneWelcome.tsx')).toContain('themedShotSrc(');
  });
});

describe('login and topbar logos', () => {
  it('the login uses the animated vector lockup (no PNG), same size in both themes', () => {
    const login = read('src/pages/Login.tsx');
    expect(login).not.toContain('/atlas-logo-dark.png');
    expect(login).toContain('className="atlas-login-lockup-svg"');
    expect(login).toContain('className="atlas-login-phone-lockup"');
    const css = stripComments(read('src/styles/login-auth.css'));
    expect(css).toMatch(/\.atlas-lockup\.atlas-login-lockup-svg\s*\{[^}]*--lk-h:\s*72px/);
    expect(css).toMatch(/\.atlas-lockup\.atlas-login-phone-lockup\s*\{[^}]*--lk-h:\s*54px/);
    // Dark theme only changes the colour of the phone lockup, never its size.
    const darkRule = /html\[data-theme="dark"\][^{]*atlas-login-phone-lockup\s*\{([^}]*)\}/.exec(css);
    expect(darkRule?.[1]).toContain('color');
    expect(darkRule?.[1]).not.toContain('--lk-h');
  });

  it('the public topbar shows the animated mark instead of the raster icon, never hidden by phone span rules', () => {
    const chrome = read('src/components/PublicChrome.tsx');
    expect(chrome).not.toContain('/atlas-icon-light.png');
    expect(chrome).toContain('className="settings-topbar-brand-mark"');
    const app = stripComments(read('src/App.css'));
    expect(app).toMatch(/\.settings-topbar-brand \.atlas-lockup\.settings-topbar-brand-mark[^{]*\{[^}]*display:\s*inline-flex !important/);
  });

  it('a tap replays the tick ripple on touch screens', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(AtlasLockup, { play: 'none', markOnly: true })); });
    const el = host.querySelector<HTMLElement>('.atlas-lockup')!;
    const tap = () => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await act(async () => { tap(); });
    expect(el.className).toContain('is-tap-a');
    await act(async () => { tap(); });
    expect(el.className).toContain('is-tap-b');
    await act(async () => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); });
    expect(el.className).toContain('is-tap-b'); // mouse uses :hover instead
    await act(async () => { root.unmount(); });
  });
});

describe('public topbar touch states', () => {
  it('the language pill keeps the trio height, has a press state and no stuck hover on touch', () => {
    const app = stripComments(read('src/App.css'));
    expect(app).toMatch(/public-lang-btn:not\(#lg-g\):not\(#lg-h\):not\(#lg-i\)\s*\{[^}]*min-height:\s*32px !important/);
    expect(app).toMatch(/@media \(hover: none\)\s*\{[^@]*public-lang-btn:hover/);
    expect(app).toMatch(/public-lang-btn:active[^{]*\{[^}]*transform:\s*scale\(\.94\)/);
    expect(app).toMatch(/@media \(max-width: 480px\)\s*\{[^@]*settings-topbar-left[^{]*\{[^}]*flex:\s*0 0 auto !important/);
  });

  it('« Se connecter » has a short « Connexion » label for narrow phones', () => {
    const chrome = read('src/components/PublicChrome.tsx');
    expect(chrome).toContain('<span className="psc-short" aria-hidden="true">Connexion</span>');
    expect(chrome).toContain('aria-label="Se connecter"');
  });
});

describe('metric series payload', () => {
  it('drops malformed payloads instead of crashing the cards', () => {
    expect(normalizeMetricsDaily([])).toBeNull();
    expect(normalizeMetricsDaily({})).toBeNull();
    expect(normalizeMetricsDaily({ series: {}, dates: 'x' })).toBeNull();
    const ok = normalizeMetricsDaily({ days: 7, dates: ['2026-10-20'], series: { products: [3] } });
    expect(ok).toEqual({ days: 7, dates: ['2026-10-20'], series: { products: [3] }, kinds: {} });
  });
});
