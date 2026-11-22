// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Download from '../pages/Download';
import Desktop from '../pages/Desktop';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals(); });

async function render(component: typeof Download) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(createElement(MemoryRouter, { children: createElement(component) })); await new Promise(resolve => setTimeout(resolve, 20)); });
}

it('uses the Android manifest download without contacting the fallback CDN', async () => {
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('android-update') ? { manifest: { apkUrl: 'https://example.com/atlas.apk', versionName: '1.2' } } : [] }));
  vi.stubGlobal('fetch', fetchMock);
  await render(Download);
  expect(host.querySelector<HTMLAnchorElement>('.dl-cta-main')?.href).toBe('https://example.com/atlas.apk');
  expect(fetchMock.mock.calls.some(([url]) => new URL(url, 'https://atlas.test').hostname === 'cdn1.afmarbre.com')).toBe(false);
});

it('does not show a perpetual loading state when the selected desktop platform has no asset', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ tag_name: 'v1', assets: [] }] })));
  await render(Desktop);
  expect(host.querySelector('.dl-hero .dl-cta-wait')?.textContent).toContain('Aucun binaire');
  expect(host.querySelectorAll('.dl-stat strong')[1].textContent).toBe('—');
  expect(host.querySelector('.dl-release-date')?.textContent).toBe('Date de publication indisponible');
});


it('offers the Android versions link and does not invent a release date when offline', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  await render(Download);
  expect(host.querySelector('.dl-hero .dl-cta-wait')?.textContent).toContain('Manifeste injoignable');
  expect(host.querySelector<HTMLAnchorElement>('.dl-hero a[href="#versions"]')).not.toBeNull();
  expect(host.querySelectorAll('.dl-stat strong')[2].textContent).toBe('—');
});

it('filters desktop release assets without losing the official download links', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ tag_name: 'v2', assets: [
    { name: 'atlas-setup.exe', browser_download_url: 'https://example.com/atlas-setup.exe' },
    { name: 'atlas.dmg', browser_download_url: 'https://example.com/atlas.dmg' },
    { name: 'atlas.AppImage', browser_download_url: 'https://example.com/atlas.AppImage' },
  ] }] })));
  await render(Desktop);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.dl-ed-platforms button')];
  expect(host.querySelectorAll('.dl-ed-download-row')).toHaveLength(3);
  await act(async () => buttons.find(button => button.textContent === 'macOS')!.click());
  expect(host.querySelectorAll('.dl-ed-download-row')).toHaveLength(1);
  expect(host.querySelector<HTMLAnchorElement>('.dl-ed-download-row a')?.href).toBe('https://example.com/atlas.dmg');
  expect(buttons.find(button => button.textContent === 'macOS')?.getAttribute('aria-pressed')).toBe('true');
  await act(async () => buttons.find(button => button.textContent === 'Tous')!.click());
  expect(host.querySelectorAll('.dl-ed-download-row')).toHaveLength(3);
});

it('uses the Android CDN if the same-origin manifest fails', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('android-update')) throw new Error('offline');
    return { ok: true, json: async () => url.includes('latest.json') ? { apkUrl: 'https://example.com/fallback.apk' } : [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  await render(Download);
  expect(host.querySelector<HTMLAnchorElement>('.dl-cta-main')?.href).toBe('https://example.com/fallback.apk');
});

it('does not create a desktop download link when an asset has no URL', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ assets: [{ name: 'atlas.AppImage' }, { name: 'atlas-setup.exe' }, { name: 'atlas.dmg' }] }] })));
  await render(Desktop);
  expect(host.querySelector('.dl-hero .dl-cta-wait')?.textContent).toContain('Aucun binaire');
  expect(host.querySelector('.dl-ed-download-row a')).toBeNull();
});


it('shows the matching Android release publication date separately from its build date', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('android-update')
    ? { manifest: { apkUrl: 'https://example.com/atlas.apk', versionName: '1.8.0', buildDate: '2026-11-15' } }
    : [{ tag_name: 'v1.8.1', published_at: '2026-11-22T00:16:49Z' }, { tag_name: 'v1.8.0', published_at: '2026-11-17T12:03:55Z' }] })));
  await render(Download);
  expect(host.querySelectorAll('.dl-stat strong')[2].textContent).toBe('17 novembre 2026');
  expect(host.querySelector('.dl-release-date')?.textContent).toBe('Publiée le 22 novembre 2026');
  expect(host.querySelector('.dl-ed-hint')?.textContent).toContain('Build : 2026-11-15');
});

it('does not label a build date or a different release as APK publication', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('android-update')
    ? { apkUrl: 'https://example.com/atlas.apk', versionName: '1.7.0', buildDate: '2026-11-15' }
    : [{ tag_name: 'v1.8.0', published_at: '2026-11-17T12:03:55Z' }] })));
  await render(Download);
  expect(host.querySelectorAll('.dl-stat strong')[2].textContent).toBe('—');
});
