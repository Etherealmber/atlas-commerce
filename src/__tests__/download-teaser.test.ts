// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import DownloadTeaser from '../components/DownloadTeaser';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
async function render(path: string) { await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path], children: createElement(DownloadTeaser) }))); }

it('links to Android and persists dismissal', async () => {
  await render('/about');
  const link = host.querySelector<HTMLAnchorElement>('.atlas-dl-teaser-link')!;
  expect(link.getAttribute('href')).toBe('/android');
  expect(link.getAttribute('rel')).toContain('noopener');
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(host.querySelector('.atlas-dl-teaser')).toBeNull();
  expect(localStorage.getItem('atlas-dl-teaser')).toBe('off');
});

it('does not show on the Android download page', async () => {
  await render('/android');
  expect(host.querySelector('.atlas-dl-teaser')).toBeNull();
});
