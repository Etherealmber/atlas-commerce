// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PublicNav } from '../components/PublicChrome';
import DownloadPreview from '../components/DownloadPreview';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

it('opens its accessible menu and closes it on Escape or outside interaction', async () => {
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PublicNav, { classic: true, links: [{ href: '/desktop', label: 'Bureau' }] }) })));
  const toggle = host.querySelector<HTMLButtonElement>('.pn-burger')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('.pn-mobile-menu')?.id).toBe(toggle.getAttribute('aria-controls'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle);
  await act(async () => toggle.click());
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

it('uses separate, labelled Android and computer previews', async () => {
  await act(async () => root.render(createElement(DownloadPreview, { platform: 'android' })));
  expect(host.querySelectorAll('img')).toHaveLength(2);
  expect(host.textContent).toContain('Atlas sur le terrain');
  await act(async () => root.render(createElement(DownloadPreview, { platform: 'desktop' })));
  expect(host.querySelectorAll('img')).toHaveLength(1);
  expect(host.textContent).toContain('données fictives');
});
