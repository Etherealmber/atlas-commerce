// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhoneSettings from '../mobile/PhoneSettings';
import PhoneProfile from '../mobile/PhoneProfile';
import PhoneWhatsNew from '../mobile/PhoneWhatsNew';
import { api } from '../api';

vi.mock('../auth', () => ({ getDisplayName: () => 'Atlas', getUsername: () => 'atlas', getRole: () => 'owner', getToken: () => 'session', isLoggedIn: () => true, setProfileCache: vi.fn(), clearToken: vi.fn() }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const click = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
it('settings apply theme, text scale, animations and show language as coming soon', async () => {
  const theme = vi.fn(); const animation = vi.fn(); const scale = vi.fn(); const compact = vi.fn(); const start = vi.fn();
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneSettings, { theme: 'system', onTheme: theme, animations: true, onAnimations: animation, compact: false, onCompact: compact, scale: 'md', onScale: scale, startTab: '/m', onStartTab: start }) })));
  await act(async () => { click('Sombre').click(); click('Grande').click(); click('Compact').click(); document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); });
  expect(theme).toHaveBeenCalledWith('dark'); expect(scale).toHaveBeenCalledWith('lg'); expect(compact).toHaveBeenCalledWith(true); expect(animation).toHaveBeenCalledWith(false);
  await act(async () => { document.querySelector<HTMLButtonElement>('.ph-setting-link')!.click(); });
  expect(document.body.textContent).toContain('arrivent bientôt'); await act(async () => click('Compris').click());
  const select = document.querySelector('select') as any;
  await act(async () => { select.value = '/m/products'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(start).toHaveBeenCalledWith('/m/products');
});
it('opens the mobile web version history from settings and filters Android-only notes', async () => {
  const settings = createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() });
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/m/settings'] }, createElement(Routes, null, createElement(Route, { path: '/m/settings', element: settings }), createElement(Route, { path: '/m/settings/whats-new', element: createElement(PhoneWhatsNew) })) )));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Nouveautés des versions'))!.click());
  expect(host.textContent).toContain('Atlas Commerce Web 0.9.0');
  expect(host.textContent).toContain('19 novembre 2026');
  expect(host.textContent).toContain('Produits sur mobile et PC');
  expect(host.textContent).toContain('Rapports mobiles');
  expect(host.textContent).not.toContain('API de suivi en lecture seule : demandes de stock personnelles');
  expect(localStorage.getItem('atlas-whats-new-seen')).toBe('0.9.0');
});
it('updates only editable profile fields and reports failure without claiming success', async () => {
  vi.spyOn(api, 'getMe').mockResolvedValue({ data: { display_name: 'Atlas', email: 'a@example.com', phone: '123', avatar_url: '/avatar.jpg', notes: 'private' } });
  const update = vi.spyOn(api, 'updateMe').mockRejectedValue(new Error('offline'));
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneProfile) })));
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(update).toHaveBeenCalledWith({ display_name: 'Atlas', email: 'a@example.com', phone: '123' });
  expect(host.textContent).toContain('Impossible d’enregistrer'); expect(host.textContent).not.toContain('Profil enregistré');
});
