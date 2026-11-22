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
  expect(fetchMock.mock.calls.some(([url]) => url.includes('cdn1.afmarbre.com'))).toBe(false);
});

it('does not show a perpetual loading state when the selected desktop platform has no asset', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ tag_name: 'v1', assets: [] }] })));
  await render(Desktop);
  expect(host.querySelector('.dl-hero .dl-cta-wait')?.textContent).toContain('Aucun binaire');
});
