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
  async function mount(confirm = true) {
    await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(Login))); });
    if (confirm) {
      const input = container.querySelector<HTMLInputElement>('#username')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'testuser');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    }
  }
  it('asks for an identity before showing password and verification, without the demo banner', async () => {
    (window as any).turnstile = { render: vi.fn(() => 'id'), remove: vi.fn() };
    await mount(false);
    expect(container.querySelector('#password')).toBeNull();
    expect(container.querySelector('#cf-turnstile')).toBeNull();
    expect(container.querySelector('.atlas-login-demo')).toBeNull();
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain('Veuillez saisir votre identifiant');
    const input = container.querySelector<HTMLInputElement>('#username')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.querySelector('#password')).not.toBeNull();
    expect(container.querySelector('#cf-turnstile')).not.toBeNull();
    expect((window as any).turnstile.render.mock.calls[0][1].appearance).toBe('always');
    await act(async () => { container.querySelector<HTMLButtonElement>('.atlas-login-identity button')!.click(); });
    expect(container.querySelector<HTMLInputElement>('#username')!.value).toBe('test');
    expect(container.querySelector('#password')).toBeNull();
  });
  it('shows username and password together on desktop', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
    (window as any).turnstile = { render: vi.fn(() => 'desktop-id'), remove: vi.fn() };
    await mount(false);
    expect(container.querySelector('#username')).not.toBeNull();
    expect(container.querySelector('#password')).not.toBeNull();
    expect(container.querySelector('#cf-turnstile')).not.toBeNull();
    expect(container.querySelector('.atlas-login-identity')).toBeNull();
  });
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
  it('reports configuration fetch failure, blocks login, and retries without losing the credentials', async () => {
    let configCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('turnstile-config')) {
        if (++configCalls === 1) throw new Error('offline');
        return { ok: true, json: async () => ({ data: { enabled: true, site_key: 'test-site-key' } }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const render = vi.fn((_el: HTMLElement, _options: any) => 'id');
    (window as any).turnstile = { render, remove: vi.fn() };
    await mount();
    const input = container.querySelector<HTMLInputElement>('#password')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'example-password');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.atlas-turnstile-retry')).not.toBeNull();
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/login'))).toBe(false);
    await act(async () => { container.querySelector<HTMLButtonElement>('.atlas-turnstile-retry')!.click(); });
    expect(input.value).toBe('example-password');
    expect(configCalls).toBe(2);
    expect(render).toHaveBeenCalledOnce();
    expect(container.querySelector('#cf-turnstile')).not.toBeNull();
  });
  it('surfaces a hanging config request and lets the user retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('turnstile-config')) return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
      return { ok: true, json: async () => ({}) };
    });
    await mount();
    expect(container.textContent).toContain('Chargement de la vérification de sécurité');
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(container.querySelector('.atlas-turnstile-retry')).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/auth/login'))).toBe(false);
  });
  it('permits normal server handling when the endpoint explicitly says verification is disabled', async () => {
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.includes('turnstile-config') ? { data: { enabled: false, site_key: null } } : {} }));
    await mount();
    expect(container.querySelector('#cf-turnstile')).toBeNull();
    expect(container.querySelector('.atlas-turnstile-retry')).toBeNull();
  });
  it('offers verification retry if the server rejects a token', async () => {
    const render = vi.fn((_el: HTMLElement, _options: any) => 'widget-id');
    (window as any).turnstile = { render, remove: vi.fn(), reset: vi.fn() };
    fetchMock.mockImplementation(async (url: string) => ({
      ok: !url.includes('/api/auth/login'),
      json: async () => url.includes('turnstile-config') ? { data: { enabled: true, site_key: 'test-site-key' } } : url.includes('/api/auth/login') ? { code: 'TURNSTILE_FAILED' } : {},
    }));
    await mount();
    const input = container.querySelector<HTMLInputElement>('#password')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'example-password'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { render.mock.calls[0][1].callback('rejected-token'); });
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain('Vérification anti-bot échouée');
    expect(container.querySelector('.atlas-turnstile-retry')).not.toBeNull();
    expect((window as any).turnstile.reset).toHaveBeenCalled();
  });
  it('shows retry after script failure and reloads the script without bypassing the challenge', async () => {
    await mount();
    const script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]')!;
    expect(script).not.toBeNull();
    await act(async () => { script.dispatchEvent(new Event('error')); });
    expect(container.textContent).toContain('Si la vérification ne s’affiche pas');
    const button = container.querySelector<HTMLButtonElement>('.atlas-turnstile-retry')!;
    await act(async () => { button.click(); });
    const replacement = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(script);
    expect(container.textContent).not.toContain('Si la vérification ne s’affiche pas');
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
    await setInput('#password', 'example-password');
    const submit = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
    const logins = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/login'));
    const options = render.mock.calls[0][1];
    // An expired token is invalidated: submitting still waits for a fresh one.
    await act(async () => { options.callback('old-token'); options['expired-callback'](); });
    await submit();
    expect(container.textContent).toContain('n’a pas encore fourni de jeton');
    expect(logins()).toHaveLength(0);
    // The fresh token resumes the pending login by itself (phones: tap on the widget).
    await act(async () => { render.mock.calls.at(-1)![1].callback('test-token'); });
    await act(async () => { await new Promise((r) => window.setTimeout(r, 150)); });
    await act(async () => { await new Promise((r) => window.setTimeout(r, 0)); });
    expect(logins()).toHaveLength(1);
    expect(JSON.parse(String(logins()[0][1]?.body)).turnstile_token).toBe('test-token');
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
    expect(container.textContent).toContain('Si la vérification ne s’affiche pas');
  });
});
