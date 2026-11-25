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

it('uses real light/dark screenshots in every feature card instead of mock-ups', async () => {
  await act(async () => { root.render(createElement(MemoryRouter, { children: createElement(Home) })); });
  const shots = [...host.querySelectorAll('#features .hm-fx-shot')];
  expect(shots).toHaveLength(5);
  for (const shot of shots) {
    const srcs = [...shot.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs).toHaveLength(2);
    expect(srcs[0]).toMatch(/^\/shots\/site-[a-z-]+-light\.webp$/);
    expect(srcs[1]).toMatch(/^\/shots\/site-[a-z-]+-dark\.webp$/);
  }
  const agent = host.querySelector('.hm-fx-agent img')!;
  expect(agent.getAttribute('alt')).toContain('fictive');
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
