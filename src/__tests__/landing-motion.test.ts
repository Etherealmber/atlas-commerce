// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useLandingMotion } from '../hooks/useLandingMotion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Example() {
  const ref = useRef<HTMLDivElement>(null);
  useLandingMotion(ref, '.reveal', '.preview');
  return createElement('div', { ref }, createElement('div', { className: 'reveal' }, 'Content'), createElement('div', null, createElement('div', { className: 'preview' })));
}
async function render() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(createElement(Example))); }
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('leaves all content visible without IntersectionObserver', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  await render();
  expect(host.querySelector('.reveal')?.classList.contains('is-in')).toBe(true);
  expect(host.querySelector('.motion-pending')).toBeNull();
});

it('reveals content when it enters view and respects a live reduced-motion change', async () => {
  let callback: IntersectionObserverCallback = () => {};
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
  class Observer { constructor(cb: IntersectionObserverCallback) { callback = cb; } observe = observe; unobserve = unobserve; disconnect = disconnect; }
  vi.stubGlobal('IntersectionObserver', Observer);
  let onChange: (() => void) | undefined;
  const media = { matches: false, addEventListener: (_: string, fn: () => void) => { onChange = fn; }, removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2000, height: 300 } as DOMRect);
  await render();
  const el = host.querySelector('.reveal')!;
  expect(el.classList.contains('motion-pending')).toBe(true);
  await act(async () => callback([{ isIntersecting: true, target: el } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(el.classList.contains('motion-pending')).toBe(false);
  expect(el.classList.contains('is-in')).toBe(true);
  expect(unobserve).toHaveBeenCalledWith(el);
  el.classList.add('motion-pending');
  media.matches = true;
  await act(async () => onChange?.());
  expect(el.classList.contains('motion-pending')).toBe(false);
  expect(disconnect).toHaveBeenCalled();
});
