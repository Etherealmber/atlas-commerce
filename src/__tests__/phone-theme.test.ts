// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPhoneTheme, usePhoneTheme } from '../mobile/usePhoneTheme';
import { setTheme } from '../theme';

let root: Root;
let host: HTMLDivElement;
let dark: boolean;
let listeners: Set<() => void>;

function TestSettings() {
  const [choice, change] = usePhoneTheme();
  return createElement('div', null, createElement('output', null, choice),
    ...(['light', 'dark', 'system'] as const).map((value) => createElement('button', { key: value, onClick: () => change(value) }, value)));
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  dark = false;
  listeners = new Set();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return dark; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })));
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(TestSettings)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('theme-dark');
  document.documentElement.style.colorScheme = '';
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
  await act(async () => button.click());
}

describe('phone theme', () => {
  it('updates the page, native controls and persisted preference', async () => {
    expect(document.documentElement.dataset.theme).toBe('light');
    await click('dark');
    expect(localStorage.getItem('atlas-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    await click('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('temporarily enables transitions only when the resolved theme changes', () => {
    vi.useFakeTimers();
    applyPhoneTheme('dark');
    expect(document.documentElement.classList.contains('phone-theme-transition')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(document.documentElement.classList.contains('phone-theme-transition')).toBe(false);
    applyPhoneTheme('dark');
    expect(document.documentElement.classList.contains('phone-theme-transition')).toBe(false);
    vi.useRealTimers();
  });
  it('uses View Transitions circular reveal when available on mobile', async () => {
    const animate = vi.fn();
    Object.defineProperty(document.documentElement, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { ready: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: startViewTransition,
    });

    try {
      applyPhoneTheme('dark');
      await Promise.resolve();
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.classList.contains('phone-theme-transition')).toBe(false);
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0][1]).toMatchObject({
        pseudoElement: '::view-transition-new(root)',
      });
    } finally {
      delete (document as Document & { startViewTransition?: unknown }).startViewTransition;
      delete (document.documentElement as HTMLElement & { animate?: unknown }).animate;
    }
  });
  it('follows operating-system changes only in system mode', async () => {
    dark = true;
    await act(async () => { listeners.forEach((fn) => fn()); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await click('light');
    dark = false; await act(async () => { listeners.forEach((fn) => fn()); });
    dark = true; await act(async () => { listeners.forEach((fn) => fn()); });
    expect(document.documentElement.dataset.theme).toBe('light');
    await click('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('synchronizes changes made by other theme controls and browser tabs', async () => {
    await act(async () => setTheme('dark'));
    expect(host.querySelector('output')?.textContent).toBe('dark');
    await act(async () => { localStorage.setItem('atlas-theme', 'light'); window.dispatchEvent(new Event('storage')); });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('supports older Safari media query listeners', async () => {
    await act(async () => root.unmount());
    const legacy = new Set<() => void>();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return dark; },
      addListener: (fn: () => void) => legacy.add(fn),
      removeListener: (fn: () => void) => legacy.delete(fn),
    })));
    root = createRoot(host);
    await act(async () => root.render(createElement(TestSettings)));
    expect(legacy.size).toBe(1);
    dark = true;
    await act(async () => { legacy.forEach((fn) => fn()); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await act(async () => root.unmount());
    expect(legacy.size).toBe(0);
    root = createRoot(host);
  });

  it('unsubscribes media listeners on unmount', async () => {
    expect(listeners.size).toBe(1);
    await act(async () => root.unmount());
    expect(listeners.size).toBe(0);
    root = createRoot(host); // afterEach still owns a mounted root
  });
});
