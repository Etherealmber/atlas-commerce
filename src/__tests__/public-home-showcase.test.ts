// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Home from '../pages/Home';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

it('keeps platform links and clearly labels the demonstration screenshots', async () => {
  await act(async () => { root.render(createElement(MemoryRouter, { children: createElement(Home) })); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(host.querySelector('.hm-skip')?.getAttribute('href')).toBe('#contenu');
  const cards = host.querySelectorAll('#plateformes .hm-platform-card');
  expect(cards).toHaveLength(3);
  expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('/login');
  expect(cards[1].querySelector('a')?.getAttribute('href')).toBe('/android');
  expect(cards[2].querySelector('a')?.getAttribute('href')).toBe('/desktop');
  expect(cards[0].textContent).toContain('Web mobile · données fictives');
  expect(cards[1].textContent).toContain('Web mobile · données fictives');
  expect(cards[2].textContent).toContain('Web sur ordinateur · données fictives');
  expect(host.querySelector('#features')).not.toBeNull();
  expect(host.querySelector('#faq details')).not.toBeNull();
});

it('keeps the mobile download split toggle narrow and its main action flexible', () => {
  const css = readFileSync('src/App.css', 'utf8');
  expect(css).toMatch(/\.hm-cta \.public-download-main\s*\{[^}]*flex:\s*1 1 auto/s);
  expect(css).toMatch(/\.hm-cta \.public-download-toggle\s*\{[^}]*flex:\s*0 0 48px;\s*width:\s*48px\s*!important/s);
});

it('shows section content when IntersectionObserver is unavailable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await act(async () => { root.render(createElement(MemoryRouter, { children: createElement(Home) })); });
  const reveals = [...host.querySelectorAll('.rise')];
  expect(reveals.length).toBeGreaterThan(0);
  expect(reveals.every(element => element.classList.contains('is-in'))).toBe(true);
});

it('builds the feature cards from live app UI — no screenshots, no photos', async () => {
  await act(async () => { root.render(createElement(MemoryRouter, { children: createElement(Home) })); });
  const live = [...host.querySelectorAll('#features .hm-fx.hm-live')];
  expect(live).toHaveLength(5);
  for (const card of live) {
    expect(card.getAttribute('role')).toBe('img');
    expect(card.getAttribute('aria-label')).toMatch(/fictiv/);
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.hm-live-inner')?.getAttribute('aria-hidden')).toBe('true');
  }
  expect(host.querySelector('#features .hm-fx-shot')).toBeNull();
  expect(host.querySelector('#features img[src*="/shots/"]')).toBeNull();
  // Same app pieces: product cards with stock chips, §8 status badges, agent bubbles.
  expect(host.querySelectorAll('#features .hl-pcard')).toHaveLength(2);
  expect(host.querySelector('#features .hl-badge.is-warning')?.textContent).toBe('Partielle');
  expect(host.querySelector('#features .hl-bubble.is-user')?.textContent).toContain('ventes');
  // No hand-drawn SVG chart or fake window chrome left on the page.
  expect(host.querySelector('#features svg[viewBox="0 0 220 68"]')).toBeNull();
  expect(host.querySelector('.hm-window-bar')).toBeNull();
  expect(host.querySelector('.hm-window img')?.getAttribute('src')).toBe('/shots/site-dashboard-light.webp');
  expect(host.querySelector('.hm-start')?.getAttribute('href')).toBe('/login');
  const split = host.querySelector('.hm-cta .public-download-split')!;
  const toggle = split.querySelector<HTMLButtonElement>('.public-download-toggle')!;
  expect(split.querySelector('.public-download-main')).not.toBeNull();
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(split.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelectorAll('.hm-steps li')).toHaveLength(3);
});
