// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhoneSettings from '../mobile/PhoneSettings';
import PhoneProfile from '../mobile/PhoneProfile';
import { api } from '../api';
import { resetWelcome } from '../lib/welcome';
import {
  finishOnboarding,
  finishPhoneOnboarding,
  getOnboarding,
  getPhoneOnboarding,
  setOnboardingStep,
} from '../lib/onboarding';
import { formatProfileUpdatedAt, profileDataFromServer, timeZoneOptions, PROFILE_TIME_ZONES } from '../lib/profilePrefs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('redoing the welcome guide restarts the guided tour from zero', () => {
  it('resetWelcome clears finished or half-done tours (desktop and mobile)', () => {
    finishOnboarding();
    finishPhoneOnboarding();
    expect(getOnboarding()?.status).toBe('done');
    resetWelcome();
    expect(localStorage.getItem('atlas_welcome_completed')).toBe('false');
    expect(getOnboarding()).toBeNull();
    expect(getPhoneOnboarding()).toBeNull();

    setOnboardingStep(6);
    sessionStorage.setItem('atlas_phone_welcome_step', '3');
    resetWelcome();
    expect(getOnboarding()).toBeNull();
    expect(sessionStorage.getItem('atlas_phone_welcome_step')).toBeNull();
  });

  it('finishing either welcome always starts the tour at step 1, even after a previous « done »', () => {
    const desktop = readFileSync('src/pages/Welcome.tsx', 'utf8');
    expect(desktop).toMatch(/markWelcomeCompleted\(\);\s*restartOnboarding\(\);/);
    expect(desktop).not.toContain('queueOnboarding');
    const phone = readFileSync('src/mobile/PhoneWelcome.tsx', 'utf8');
    expect(phone).toContain('if (withTour) restartPhoneOnboarding();');
    expect(phone).not.toContain('queuePhoneOnboarding');
  });

  it('mobile Réglages has « Guide d’accueil », which resets and opens /welcome', async () => {
    finishPhoneOnboarding();
    localStorage.setItem('atlas_welcome_completed', 'true');
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/m/settings'] }, createElement(Routes, null,
      createElement(Route, { path: '/m/settings', element: createElement(PhoneSettings, { theme: 'system', onTheme: vi.fn(), animations: true, onAnimations: vi.fn(), compact: false, onCompact: vi.fn(), scale: 'md', onScale: vi.fn(), startTab: '/m', onStartTab: vi.fn() }) }),
      createElement(Route, { path: '/welcome', element: createElement('p', null, 'Welcome route') }),
    ))));
    const btn = host.querySelector<HTMLButtonElement>('button.ph-setting-welcome');
    expect(btn?.textContent).toContain('Guide d’accueil');
    await act(async () => btn!.click());
    expect(localStorage.getItem('atlas_welcome_completed')).toBe('false');
    expect(getPhoneOnboarding()).toBeNull();
    expect(host.textContent).toContain('Welcome route');
  });
});

describe('« Modifier le profil » data comes from and goes to the database', () => {
  it('maps /api/auth/me fields and formats the D1 update time', () => {
    const d = profileDataFromServer({ display_name: 'MY Marbre', email: 'a@b.ma', timezone: 'Europe/Paris', working_hours: '08:00 – 17:00', job_title: 'Gérant', avatar_url: '', profile_updated_at: '2026-11-25 13:05:00' }, null);
    expect(d).toMatchObject({ fullName: 'MY Marbre', timezone: 'Europe/Paris', workingHours: '08:00 – 17:00', title: 'Gérant' });
    expect(d.lastUpdated).toBe(formatProfileUpdatedAt('2026-11-25 13:05:00'));
    expect(d.lastUpdated).toMatch(/2026/);
    expect(profileDataFromServer({}, null).timezone).toBe('Africa/Casablanca');
    expect(formatProfileUpdatedAt('')).toBe('');
    expect(timeZoneOptions('Asia/Tokyo').at(-1)).toEqual({ id: 'Asia/Tokyo', label: 'Asia/Tokyo' });
    expect(timeZoneOptions('Europe/Paris')).toBe(PROFILE_TIME_ZONES);
  });

  it('desktop Settings sends timezone / working_hours / job_title and no longer keeps a local-only copy', () => {
    const src = readFileSync('src/pages/Settings.tsx', 'utf8');
    expect(src).toContain('timezone: data.timezone,');
    expect(src).toContain('working_hours: data.workingHours,');
    expect(src).toContain('job_title: data.title,');
    expect(src).toContain('setProfileData((prev) => profileDataFromServer(m, prev));');
    expect(src).not.toContain("localStorage.setItem('atlas-profile'");
    expect(src).not.toContain('/* keep local */');
    const dlg = readFileSync('src/components/ui/EditProfile.tsx', 'utf8');
    expect(dlg).toContain('setSaveError(err?.message');
    const css = readFileSync('src/styles/shell.css', 'utf8');
    expect(css).toMatch(/\.ac-edit-profile-form select:not\(#prf-a\):not\(#prf-b\) \{[^}]*height: 44px !important;/);
  });

  it('mobile profile edits the same fields and saves them through PATCH /api/auth/me', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ data: { display_name: 'Amine', email: 'a@b.ma', phone: '', job_title: 'Gérant', working_hours: '09:00 – 18:00', timezone: 'Africa/Casablanca' } } as any);
    const update = vi.spyOn(api, 'updateMe').mockResolvedValue({ data: { display_name: 'Amine', job_title: 'Comptable', working_hours: '08:00 – 16:00', timezone: 'Europe/Paris' } } as any);
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(PhoneProfile))));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('Gérant');
    expect(host.textContent).toContain('Maroc (Casablanca)');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Modifier le profil"]')!.click());
    const dialog = document.body.querySelector('.ph-profile-edit')!;
    const inputs = [...dialog.querySelectorAll('label')];
    const set = (label: string, value: string) => {
      const el = inputs.find((l) => l.textContent?.startsWith(label))!.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    };
    await act(async () => { set('Fonction', 'Comptable'); set('Horaires', '08:00 – 16:00'); set('Fuseau horaire', 'Europe/Paris'); });
    await act(async () => (dialog.querySelector('form') as HTMLFormElement).requestSubmit());
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ job_title: 'Comptable', working_hours: '08:00 – 16:00', timezone: 'Europe/Paris' }));
    expect(host.textContent).toContain('France (Paris)');
  });
});

describe('products catalogue: bento chooser + photos everywhere', () => {
  it('uses the dashboard segmented pill, real photos (large ones too) in grid, list and Santé du stock', () => {
    const src = readFileSync('src/pages/Products.tsx', 'utf8');
    expect(src).toContain('className="pc-view" role="group"');
    expect(src).toContain('className="ac-seg-btn pc-view-btn"');
    expect(src.match(/largeImageProductId=\{p\.image_inline_large \? p\.id : undefined\}/g)?.length).toBe(2);
    expect(src).not.toContain('desktop-product-card');
    const dash = readFileSync('src/pages/Dashboard.tsx', 'utf8');
    expect(dash).toContain('className="ari-av ac-dash-art"');
    const css = readFileSync('src/pages/products-catalog.css', 'utf8');
    expect(css).toContain('border-radius: 16px !important;');
    expect(css).toContain('html[data-theme="dark"] .ac-products {');
    expect(readFileSync('src/styles/dark-force.css', 'utf8')).not.toContain('desktop-product-card');
  });
});
