// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import PhoneWelcome, { PHONE_WELCOME_STEPS } from '../mobile/PhoneWelcome';
import { PhoneOnboarding, PHONE_ONBOARDING_STEPS, phoneCardSide } from '../mobile/PhoneOnboarding';
import {
  getOnboarding,
  getPhoneOnboarding,
  isPhoneOnboardingPending,
  queuePhoneOnboarding,
  restartPhoneOnboarding,
} from '../lib/onboarding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('atlas_welcome_completed', 'false');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const byText = (sel: string, text: string) =>
  Array.from(document.body.querySelectorAll(sel)).find((b) => (b.textContent || '').includes(text));

describe('mobile web welcome (PhoneWelcome)', () => {
  it('walks 5 thumb-sized steps and finishing queues the separate mobile tour', async () => {
    expect(PHONE_WELCOME_STEPS).toEqual(['hello', 'theme', 'features', 'shots', 'ready']);
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/welcome'] }, createElement(PhoneWelcome))));
    expect(document.querySelector('.pw-stage')?.getAttribute('data-step')).toBe('hello');
    await click(byText('button.pw-btn--primary', 'Commencer'));
    expect(document.querySelector('.pw-stage')?.getAttribute('data-step')).toBe('theme');
    await click(byText('button.pw-theme', 'Sombre'));
    expect(localStorage.getItem('atlas-theme')).toBe('dark');
    for (let i = 0; i < 3; i += 1) await click(document.querySelector('button.pw-btn--primary'));
    expect(document.querySelector('.pw-stage')?.getAttribute('data-step')).toBe('ready');
    expect(document.body.textContent).toContain('elle n’ajoute rien à votre base de données et vous pouvez la passer à tout moment');
    await click(byText('button.pw-btn--primary', 'Ouvrir Atlas'));
    expect(localStorage.getItem('atlas_welcome_completed')).toBe('true');
    expect(getPhoneOnboarding()).toEqual({ status: 'pending', step: 0 });
    expect(getOnboarding()).toBeNull(); // the desktop tour is untouched
  });

  it('« Passer » finishes the welcome without starting the tour', async () => {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(PhoneWelcome))));
    await click(byText('button.pw-skip', 'Passer'));
    expect(localStorage.getItem('atlas_welcome_completed')).toBe('true');
    expect(getPhoneOnboarding()?.status).toBe('done');
  });

  it('phones get the mobile welcome, PCs keep the full guide', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("const PhoneWelcome = lazyRetry(() => import('./mobile/PhoneWelcome'));");
    expect(app).toMatch(/function WelcomeGate\(\) \{\n\s+const isPhone = useIsPhoneShell\(\);/);
    expect(app).toMatch(/if \(isPhone\) \{[\s\S]*?<PhoneWelcome \/>/);
  });
});

describe('mobile guided tour (PhoneOnboarding)', () => {
  it('has its own storage, steps that open their pages, and replay from Réglages', () => {
    queuePhoneOnboarding();
    expect(isPhoneOnboardingPending()).toBe(true);
    expect(getOnboarding()).toBeNull();
    expect(PHONE_ONBOARDING_STEPS.map((s) => s.id)).toEqual(['home', 'dock', 'scan', 'quick', 'products', 'agent', 'profile']);
    expect(PHONE_ONBOARDING_STEPS.map((s) => s.route || '/m')).toEqual(['/m', '/m', '/m', '/m', '/m/products', '/m/agent', '/m/profile']);
    restartPhoneOnboarding();
    expect(getPhoneOnboarding()).toEqual({ status: 'pending', step: 0 });
    expect(readFileSync('src/mobile/PhoneSettings.tsx', 'utf8')).toContain('restartPhoneOnboarding(); nav(\'/m\');');
    expect(readFileSync('src/mobile/PhoneApp.tsx', 'utf8')).toContain('<PhoneOnboarding />');
  });

  it('puts the card on the side away from the target (never on top of it)', () => {
    expect(phoneCardSide(null, 800)).toBe('center');
    expect(phoneCardSide({ top: 20, left: 300, width: 40, height: 40 }, 800)).toBe('bottom');
    expect(phoneCardSide({ top: 740, left: 0, width: 390, height: 58 }, 800)).toBe('top');
  });

  it('is demo-only, stays invisible until placed, then Suivant / Passer work', async () => {
    queuePhoneOnboarding();
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/m'] }, createElement(PhoneOnboarding))));
    const card = document.body.querySelector('.po-card');
    expect(card?.classList.contains('is-placed')).toBe(false);
    expect(card?.getAttribute('aria-hidden')).toBe('true');
    expect(card?.textContent).toContain('Démonstration uniquement : rien n’est ajouté à votre base de données');
    expect(document.body.querySelector('.po-shield')).toBeTruthy();
    await click(byText('.po-card button', 'Suivant'));
    expect(getPhoneOnboarding()).toEqual({ status: 'pending', step: 1 });
    await click(byText('.po-card button', 'Passer'));
    expect(getPhoneOnboarding()?.status).toBe('done');
    expect(document.body.querySelector('.po-card')).toBeNull();
    const src = readFileSync('src/mobile/PhoneOnboarding.tsx', 'utf8');
    expect(src).not.toMatch(/from '\.\.\/api'/);
  });
});

describe('desktop tour waits for the page to settle', () => {
  it('hides the card until the target is stable and no skeleton is left', () => {
    const src = readFileSync('src/components/GuidedOnboarding.tsx', 'utf8');
    expect(src).toContain('stableTicks >= SETTLE_TICKS && !shimmering');
    expect(src).toContain("className={`ac-onboard-card${placed ? ' is-placed' : ''}`}");
    const css = readFileSync('src/App.css', 'utf8');
    expect(css).toMatch(/\.ac-onboard-card:not\(\.is-placed\) \{\n\s+visibility: hidden;/);
  });
});

describe('payroll advance cap conflict (409) on the Employees page', () => {
  it('never silently shrinks: shows the remaining allowance and asks to confirm', () => {
    const src = readFileSync('src/pages/Employees.tsx', 'utf8');
    expect(src).toContain("code === 'ADVANCE_CAP_EXCEEDED' || code === 'ADVANCE_CAP'");
    expect(src).toContain('Number(capData.max_advance ?? 0)');
    expect(src).toContain('Montant ajusté à ${fmt(left)} : vérifiez puis confirmez.');
    expect(src).toContain("code === 'ADVANCE_CONFLICT'");
    const worker = readFileSync('worker/routes/employees.ts', 'utf8');
    expect(worker).toContain("code: 'ADVANCE_CAP_EXCEEDED'");
    expect(worker).toMatch(/code: 'ADVANCE_CAP_EXCEEDED',\s*data: \{ max_advance: hardLeft[^}]*\},\s*\}, 409\);/);
  });
});
