// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhoneSettings from '../mobile/PhoneSettings';
import PhoneProfile from '../mobile/PhoneProfile';
import PhoneWhatsNew from '../mobile/PhoneWhatsNew';
import { api } from '../api';

vi.mock('../components/ui/AvatarImage', () => ({ AvatarImage: ({ fallback }: { fallback: any }) => fallback }));
vi.mock('../auth', () => ({ getDisplayName: () => 'Atlas', getUsername: () => 'atlas', getRole: () => 'owner', getToken: () => 'session', isLoggedIn: () => true, setProfileCache: vi.fn(), clearToken: vi.fn() }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
it('settings apply theme, text scale, animations and open the real language picker', async () => {
  const theme = vi.fn(); const animation = vi.fn(); const scale = vi.fn(); const compact = vi.fn(); const start = vi.fn();
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneSettings, { theme: 'system', onTheme: theme, animations: true, onAnimations: animation, compact: false, onCompact: compact, scale: 'md', onScale: scale, startTab: '/m', onStartTab: start }) })));
  await act(async () => { click('Sombre').click(); click('Grande').click(); click('Compact').click(); document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(); });
  expect(theme).toHaveBeenCalledWith('dark'); expect(scale).toHaveBeenCalledWith('lg'); expect(compact).toHaveBeenCalledWith(true); expect(animation).toHaveBeenCalledWith(false);
  await act(async () => { document.querySelector<HTMLButtonElement>('.ph-setting-link')!.click(); });
  expect(document.body.textContent).toContain('العربية'); expect(document.body.textContent).toContain('English');
  expect(document.querySelectorAll('.ac-lang-row[role="radio"]').length).toBe(3);
  await act(async () => (document.querySelector('.ac-lang-ok') as HTMLButtonElement).click());
  const select = document.querySelector('select') as any;
  await act(async () => { select.value = '/m/products'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(start).toHaveBeenCalledWith('/m/products');
});
it('opens the complete version history with platform badges and desktop category icons', async () => {
  const settings = createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() });
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/m/settings'] }, createElement(Routes, null, createElement(Route, { path: '/m/settings', element: settings }), createElement(Route, { path: '/m/settings/whats-new', element: createElement(PhoneWhatsNew) })) )));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Nouveautés des versions'))!.click());
  expect(host.textContent).toContain('Atlas Commerce 0.9.3');
  expect(host.textContent).toContain('25 novembre 2026');
  expect(host.textContent).toContain('Produits sur mobile et PC');
  expect(host.textContent).toContain('Rapports mobiles');
  expect(host.textContent).toContain('API de suivi en lecture seule : demandes de stock personnelles');
  for (const platform of ['web', 'android', 'desktop', 'server']) expect(host.querySelector(`.wn-plat--${platform}`)).not.toBeNull();
  const latest = host.querySelector('.ph-release-card')!;
  for (const icon of ['improve', 'fix']) expect(latest.querySelector(`.wn-sec-ico--${icon} svg`)).not.toBeNull();
  const desktopCard = host.querySelectorAll('.ph-release-card')[2]!;
  const serverDesktopOnly = [...desktopCard.querySelectorAll('li')].find(li => li.textContent?.includes('Le serveur vérifie le défi'))!;
  expect([...serverDesktopOnly.querySelectorAll('.wn-plat')].map(el => el.textContent)).toEqual(['Desktop', 'Serveur']);
  expect(localStorage.getItem('atlas-whats-new-seen')).toBe('0.9.3');
});
it('updates only editable profile fields and reports failure without claiming success', async () => {
  vi.spyOn(api, 'getMe').mockResolvedValue({ data: { display_name: 'Atlas', email: 'a@example.com', phone: '123', avatar_url: '/avatar.jpg', notes: 'private' } });
  const update = vi.spyOn(api, 'updateMe').mockRejectedValue(new Error('offline'));
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneProfile) })));
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Modifier le profil"]')!.click(); });
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(update).toHaveBeenCalledWith({ display_name: 'Atlas', email: 'a@example.com', phone: '123', job_title: '', working_hours: '', timezone: 'Africa/Casablanca' });
  expect(document.body.textContent).toContain('Impossible d’enregistrer'); expect(document.body.textContent).not.toContain('Profil enregistré');
});
it('saves scanner preferences locally and restores them when settings reopen', async () => {
  const settings = () => createElement(MemoryRouter, { children: createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() }) });
  await act(async () => root.render(settings()));
  const scanSwitch = (text: string) => [...host.querySelectorAll('label')].find(label => label.textContent?.includes(text))!.querySelector<HTMLInputElement>('input')!;
  expect(scanSwitch('Ouvrir la caméra automatiquement').checked).toBe(false);
  expect(scanSwitch('Vibration au scan').checked).toBe(true);
  expect(scanSwitch('Signal sonore au scan').checked).toBe(false);
  await act(async () => { scanSwitch('Ouvrir la caméra automatiquement').click(); scanSwitch('Vibration au scan').click(); scanSwitch('Signal sonore au scan').click(); });
  expect(localStorage.getItem('atlas_phone_scan_auto_camera')).toBe('on');
  expect(localStorage.getItem('atlas_phone_scan_vibrate')).toBe('off');
  expect(localStorage.getItem('atlas_phone_scan_sound')).toBe('on');
  await act(async () => root.render(null));
  await act(async () => root.render(settings()));
  expect(scanSwitch('Ouvrir la caméra automatiquement').checked).toBe(true);
  expect(scanSwitch('Vibration au scan').checked).toBe(false);
  expect(scanSwitch('Signal sonore au scan').checked).toBe(true);
  expect(host.querySelector<HTMLAnchorElement>('a[href="/privacy"]')?.target).toBe('_blank');
});
it('reports when a scanner preference cannot be saved', async () => {
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() }) })));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('blocked'); } });
  const input = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('Vibration au scan'))!.querySelector('input')!;
  await act(async () => input.click());
  expect(input.checked).toBe(true); expect(host.textContent).toContain('Impossible de sauvegarder');
});
it('asks for confirmation before signing out and allows cancellation', async () => {
  const { clearToken } = await import('../auth');
  vi.spyOn(api, 'getMe').mockResolvedValue({ data: {} });
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneProfile) })));
  await act(async () => click('Se déconnecter de cette session').click());
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('La session actuelle sera fermée');
  expect(clearToken).not.toHaveBeenCalled();
  await act(async () => click('Annuler').click());
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(clearToken).not.toHaveBeenCalled();
});
it('shares the mobile link using the browser share sheet', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  try {
    await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() }) })));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Partager Atlas Commerce'))!.click());
    expect(share).toHaveBeenCalledWith({ title: 'Atlas Commerce', url: `${window.location.origin}/m` });
  } finally { Reflect.deleteProperty(navigator, 'share'); }
});

it('exposes the same live appearance controls on profile', async () => {
  vi.spyOn(api, 'getMe').mockResolvedValue({ data: {} });
  const onTheme = vi.fn();
  const preferences = { theme: 'light', onTheme, animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md' as const, onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() };
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneProfile, { preferences }) })));
  await act(async () => click('Sombre').click());
  expect(onTheme).toHaveBeenCalledWith('dark'); expect(host.textContent).toContain('Appareils liés');
});

it('displays thanks and contributors on mobile settings and whats-new', async () => {
  const settings = createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() });
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/m/settings'] }, createElement(Routes, null, createElement(Route, { path: '/m/settings', element: settings }), createElement(Route, { path: '/m/settings/whats-new', element: createElement(PhoneWhatsNew) })) )));
  expect(host.querySelector('.wn-thanks-card')).not.toBeNull();
  expect(host.textContent).toContain('Remerciements & contributeurs');
  expect(host.textContent).toContain('Merci à');
  expect(host.querySelectorAll('.wn-contributor-pill').length).toBeGreaterThan(0);
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Nouveautés des versions'))!.click());
  expect(host.querySelector('.ph-version-history .wn-thanks-card')).not.toBeNull();
  expect(host.querySelector('.ph-release-card .wn-release-contributors')).not.toBeNull();
  expect(host.textContent).toContain('Merci à');
});
