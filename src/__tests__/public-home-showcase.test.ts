// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  expect(cards[1].textContent).toContain('Android natif · capture anonymisée');
  expect(cards[2].textContent).toContain('Web sur ordinateur · données fictives');
  expect(host.querySelector('#features')).not.toBeNull();
  expect(host.querySelector('#faq details')).not.toBeNull();
});

it('shows section content when IntersectionObserver is unavailable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await act(async () => { root.render(createElement(MemoryRouter, { children: createElement(Home) })); });
  const reveals = [...host.querySelectorAll('.rise')];
  expect(reveals.length).toBeGreaterThan(0);
  expect(reveals.every(element => element.classList.contains('is-in'))).toBe(true);
});
