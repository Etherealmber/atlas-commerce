// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Login from '../pages/Login';

vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: (_target, tag: string) => React.forwardRef(({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileHover: _whileHover, whileTap: _whileTap, ...props }: any, ref: any) => React.createElement(tag, { ...props, ref }, children)) }),
  AnimatePresence: ({ children }: any) => children,
}));
vi.mock('../components/login/AnimatedCharacters', () => ({ default: () => null }));
vi.mock('../fingerprint', () => ({
  getCachedFingerprint: vi.fn().mockResolvedValue('test-device'),
  isBiometricAvailable: vi.fn().mockResolvedValue(false),
  isWebAuthnAvailable: vi.fn().mockReturnValue(false),
  registerWebAuthn: vi.fn(), authenticateWebAuthn: vi.fn(),
  setStoredBiometricCredentialId: vi.fn(), getStoredBiometricCredentialId: vi.fn(),
  getDeviceLabel: vi.fn().mockReturnValue('test'), getDeviceMeta: vi.fn().mockReturnValue({}),
}));
vi.mock('../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth')>()),
  isLoggedIn: () => false,
}));

describe('login Turnstile', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node: any) => {
      // Keep the test offline and dispatch load/error explicitly.
      if (node instanceof HTMLScriptElement) {
        node.type = 'application/json';
        const result = append(node);
        node.type = 'text/javascript';
        return result;
      }
      return append(node);
    });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: query.includes('max-width'), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
    fetchMock = vi.fn(async (url: string) => ({ json: async () => url.includes('turnstile-config') ? { data: { enabled: true, site_key: 'test-site-key' } } : {} }));
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]').forEach(s => s.remove());
    delete (window as any).turnstile;
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });
  async function mount() {
    await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(Login))); });
  }
  it('renders a compact mobile widget and cleans it up on unmount', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
    const remove = vi.fn();
    const render = vi.fn((_el: HTMLElement, _options: any) => 'widget-id');
    (window as any).turnstile = { render, remove };
    await mount();
    expect(container.querySelector('#cf-turnstile')).not.toBeNull();
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0][1]).toMatchObject({ sitekey: 'test-site-key', size: 'compact' });
    await act(async () => root.unmount());
    expect(remove).toHaveBeenCalledWith('widget-id');
    // afterEach can safely unmount again
  });
  it('shows retry after script failure and reloads the script without bypassing the challenge', async () => {
    await mount();
    const script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]')!;
    expect(script).not.toBeNull();
    await act(async () => { script.dispatchEvent(new Event('error')); });
    expect(container.textContent).toContain('Vérification Cloudflare indisponible');
    const button = container.querySelector<HTMLButtonElement>('.atlas-turnstile-retry')!;
    await act(async () => { button.click(); });
    const replacement = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(script);
    expect(container.textContent).not.toContain('Vérification Cloudflare indisponible');
    const render = vi.fn(() => 'new-id');
    (window as any).turnstile = { render, remove: vi.fn() };
    await act(async () => { replacement!.dispatchEvent(new Event('load')); });
    expect(render).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/login'))).toBe(false);
  });
  it('blocks password login until a token is received and invalidates an expired token', async () => {
    const render = vi.fn((_el: HTMLElement, _options: any) => 'widget-id');
    (window as any).turnstile = { render, remove: vi.fn(), reset: vi.fn() };
    await mount();
    const setInput = async (selector: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(selector)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await setInput('#username', 'testuser');
    await setInput('#password', 'example-password');
    const submit = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
    await submit();
    expect(container.textContent).toContain('n’a pas encore fourni de jeton');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/login'))).toBe(false);
    const options = render.mock.calls[0][1];
    await act(async () => { options.callback('test-token'); options['expired-callback'](); });
    await submit();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/login'))).toBe(false);
    await act(async () => { options.callback('test-token'); });
    await submit();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/login'))).toHaveLength(1);
  });
  it('renders flexible light-matched widget on normal phone widths instead of dark compact square', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
    const render = vi.fn((_el: HTMLElement, _options: any) => 'widget-id');
    (window as any).turnstile = { render, remove: vi.fn() };
    await mount();
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0][1]).toMatchObject({ sitekey: 'test-site-key', size: 'flexible', theme: 'light' });
  });
  it('shows retry if the script hangs without firing an error', async () => {
    vi.useFakeTimers();
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(container.textContent).toContain('Vérification Cloudflare indisponible');
  });
});
