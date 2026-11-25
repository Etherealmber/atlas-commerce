// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { TopbarUserMenu } from '../components/shell/TopbarUserMenu';
import { GuidedOnboarding, ONBOARDING_STEPS } from '../components/GuidedOnboarding';
import {
  finishOnboarding,
  getOnboarding,
  isOnboardingPending,
  ONBOARDING_KEY,
  queueOnboarding,
  restartOnboarding,
  setOnboardingStep,
} from '../lib/onboarding';
import { applyDensityFromStorage, getDensity, setDensity } from '../lib/density';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  localStorage.clear();
});

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const byText = (sel: string, text: string) =>
  Array.from(document.body.querySelectorAll(sel)).find((b) => (b.textContent || '').trim().includes(text));

describe('Déconnexion asks « are you sure » (v0.9.4)', () => {
  it('opens a confirmation instead of logging out, cancel keeps the session, confirm logs out', async () => {
    const onLogout = vi.fn();
    await act(async () =>
      root.render(
        createElement(MemoryRouter, null, createElement(TopbarUserMenu, { displayName: 'MY Marbre', roleLabel: 'Propriétaire', initials: 'MY', onLogout })),
      ),
    );
    await click(document.body.querySelector('.ac-topbar-user-btn'));
    await click(byText('button', 'Déconnexion'));
    expect(onLogout).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Se déconnecter ?');

    await click(byText('[role="alertdialog"] button', 'Annuler'));
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onLogout).not.toHaveBeenCalled();

    await click(document.body.querySelector('.ac-topbar-user-btn'));
    await click(byText('button', 'Déconnexion'));
    await click(byText('[role="alertdialog"] button', 'Se déconnecter'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('every logged-in menu (app topbar + public pages) goes through TopbarUserMenu', () => {
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('<TopbarUserMenu');
    expect(readFileSync('src/components/PublicChrome.tsx', 'utf8')).toContain('<TopbarUserMenu');
    expect(readFileSync('src/mobile/PhoneProfile.tsx', 'utf8')).toMatch(/Se déconnecter/);
  });
});

describe('public language button for visitors', () => {
  it('sits before the theme toggle in the public nav, mobile actions and settings topbar', () => {
    const src = readFileSync('src/components/PublicChrome.tsx', 'utf8');
    expect(src).toContain('function PublicLanguageButton');
    expect(src).toContain('if (isLoggedIn()) return null;');
    expect(src.match(/<PublicLanguageButton \/><PublicThemeToggle \/>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src).toContain('<LanguageSoonDialog');
  });
});

describe('buttons never look like links', () => {
  it('cookie consent « Retour » and « Personnaliser » are real secondary buttons', () => {
    const src = readFileSync('src/components/CookieConsent.tsx', 'utf8');
    expect(src).toContain('className="cookie-btn secondary cookie-consent-customize"');
    expect(src).toMatch(/className="cookie-btn secondary" onClick=\{\(\) => setPanel\('banner'\)\}/);
    expect(src).not.toContain('linkish');
  });
});

describe('welcome', () => {
  it('programmatically focused headings (Bonjour) never show a focus ring', () => {
    const css = readFileSync('src/styles/dark-force.css', 'utf8');
    expect(css).toContain('html body h1[tabindex="-1"]:focus:not(#ac-h)');
    expect(css).toMatch(/h1\[tabindex="-1"\]:focus:not\(#ac-h\)[\s\S]{0,200}outline: none !important/);
  });

  it('keeps the step 11 comparison and réflexes content', () => {
    const src = readFileSync('src/pages/Welcome.tsx', 'utf8');
    expect(src).toContain('WELCOME_COMPARE_STEP');
    expect(src).toContain("setCompareTab");
  });

  it('« Visite rapide des modules » is informative only, and finishing queues the guided tour', () => {
    const src = readFileSync('src/pages/Welcome.tsx', 'utf8');
    const note = src.slice(src.indexOf('welcome-tour-note'), src.indexOf('Visite rapide des modules') + 40);
    expect(note).toContain('role="note"');
    expect(note).not.toContain('<button');
    expect(note).not.toContain('onClick');
    expect(src).not.toContain('FeatureTour');
    expect(src).toMatch(/markWelcomeCompleted\(\);\s*queueOnboarding\(\);/);
  });
});

describe('compact density really applies', () => {
  it('stores the choice and flags <html data-ui-density>, without reviving legacy data-density rules', () => {
    setDensity('compact');
    expect(getDensity()).toBe('compact');
    expect(document.documentElement.getAttribute('data-ui-density')).toBe('compact');
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
    document.documentElement.removeAttribute('data-ui-density');
    applyDensityFromStorage();
    expect(document.documentElement.getAttribute('data-ui-density')).toBe('compact');
    setDensity('comfortable');
    expect(getDensity()).toBe('comfortable');
    expect(document.documentElement.getAttribute('data-ui-density')).toBe('comfortable');
  });

  it('the compact layer shrinks buttons, inputs, cards, tables and the floating dock, and is loaded before dark-force', () => {
    const css = readFileSync('src/styles/density-compact.css', 'utf8');
    for (const sel of ['.content button', '.content input', '.content .ac-panel', '.content .ac-metric', '.content th', '.content td', '.ac-desktop-dock', '.ac-sidebar']) {
      expect(css).toContain(`html[data-ui-density="compact"] body ${sel}`);
    }
    expect(css).not.toMatch(/\b(background|color)\s*:/);
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main.indexOf("./styles/density-compact.css")).toBeGreaterThan(0);
    expect(main.indexOf("./styles/density-compact.css")).toBeLessThan(main.indexOf("./styles/dark-force.css"));
  });

  it('mobile stays comfortable without overwriting the saved desktop choice', () => {
    const src = readFileSync('src/mobile/PhoneApp.tsx', 'utf8');
    expect(src).not.toContain("setDensity('comfortable')");
    expect(src).toContain("dataset.uiDensity = 'comfortable'");
  });

  it('Settings → Mon profil can switch density and replay the tour', () => {
    const src = readFileSync('src/pages/Settings.tsx', 'utf8');
    expect(src).toContain('ac-settings-density-row');
    expect(src).toContain('Revoir la visite guidée');
    expect(src).toContain('restartOnboarding()');
  });
});

describe('guided onboarding', () => {
  it('persists pending → step → done, and never re-queues after completion', () => {
    expect(getOnboarding()).toBeNull();
    queueOnboarding();
    expect(getOnboarding()).toEqual({ status: 'pending', step: 0 });
    setOnboardingStep(3);
    expect(getOnboarding()).toEqual({ status: 'pending', step: 3 });
    finishOnboarding();
    expect(isOnboardingPending()).toBe(false);
    queueOnboarding();
    expect(isOnboardingPending()).toBe(false);
    restartOnboarding();
    expect(getOnboarding()).toEqual({ status: 'pending', step: 0 });
    localStorage.setItem(ONBOARDING_KEY, '{oops');
    expect(getOnboarding()).toBeNull();
  });

  it('walks Produits → Ajouter un produit → client → facture → vente rapide → caisse → agent → compte', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'dashboard', 'sidebar-products', 'product-create', 'client-create', 'invoice-create', 'quick-sale', 'balance', 'agent', 'account',
    ]);
    expect(ONBOARDING_STEPS.find((s) => s.id === 'product-create')?.target).toBe('button[title="Ajouter un produit"]');
    for (const [file, title] of [
      ['src/pages/Products.tsx', 'Ajouter un produit'],
      ['src/pages/Clients.tsx', 'Ajouter un client'],
      ['src/pages/Invoices.tsx', 'Créer une facture'],
      ['src/pages/QuickSale.tsx', 'Nouvelle vente'],
    ]) {
      expect(readFileSync(file, 'utf8')).toContain(`title="${title}"`);
    }
  });

  it('renders the step card, advances with Suivant, hides behind modals, and Passer la visite completes it', async () => {
    queueOnboarding();
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, createElement(GuidedOnboarding))));
    let card = document.body.querySelector('.ac-onboard-card');
    expect(card?.textContent).toContain('Votre tableau de bord');
    expect(card?.textContent).toContain(`1 / ${ONBOARDING_STEPS.length}`);

    await click(byText('.ac-onboard-card button', 'Suivant'));
    expect(getOnboarding()).toEqual({ status: 'pending', step: 1 });
    card = document.body.querySelector('.ac-onboard-card');
    expect(card?.textContent).toContain('Allez dans Produits');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(document.body.querySelector('.ac-onboard-card')).toBeNull();
    overlay.remove();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(document.body.querySelector('.ac-onboard-card')).toBeTruthy();

    await click(byText('.ac-onboard-card button', 'Passer'));
    expect(getOnboarding()?.status).toBe('done');
    expect(document.body.querySelector('.ac-onboard-card')).toBeNull();
  });

  it('is mounted in the app shell, outside login and welcome', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("lazyRetry(() => import('./components/GuidedOnboarding'))");
    expect(app).toMatch(/!location\.pathname\.startsWith\('\/welcome'\) && \(\s*<Suspense fallback=\{null\}><GuidedOnboarding \/><\/Suspense>/);
  });
});
