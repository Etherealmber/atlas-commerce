// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { GuidedOnboarding } from '../components/GuidedOnboarding';
import { LanguageSoonDialog } from '../components/LanguageSoonDialog';
import { queueOnboarding } from '../lib/onboarding';
import { isInFloatingLayer } from '../lib/floatingLayer';
import { setProfileCache, clearToken } from '../auth';

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
  clearToken();
});

describe('guided tour is a demonstration only', () => {
  it('says so on every step, and a shield blocks clicks on the page so nothing can be created', async () => {
    queueOnboarding();
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, createElement(GuidedOnboarding))));
    const card = document.body.querySelector('.ac-onboard-card');
    expect(card?.textContent).toContain('Démonstration uniquement');
    expect(card?.textContent).toContain('rien n’est ajouté à votre base de données');
    expect(card?.textContent).toContain('passer la visite à tout moment');
    expect(document.body.querySelector('.ac-onboard-shield')).toBeTruthy();
    const css = readFileSync('src/App.css', 'utf8');
    expect(css).toMatch(/\.ac-onboard-shield \{[^}]*pointer-events: auto;/);
  });

  it('never calls the API and never invites the user to create real data', () => {
    const src = readFileSync('src/components/GuidedOnboarding.tsx', 'utf8');
    expect(src).not.toMatch(/from '\.\.\/api'/);
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toContain('Essayez maintenant');
    expect(src).not.toMatch(/Cliquez sur « (Ajouter|Créer|Nouvelle)/);
  });

  it('Welcome and Settings explain the tour adds nothing', () => {
    expect(readFileSync('src/pages/Welcome.tsx', 'utf8')).toContain('elle n’ajoute rien à votre base de données et vous pouvez la passer à tout moment');
    expect(readFileSync('src/pages/Settings.tsx', 'utf8')).toContain('Démonstration uniquement : rien n’est ajouté à vos données.');
  });
});

describe('popups never open or close on their own', () => {
  it('the dock keeps the user menu mounted when it compacts (hidden, not unmounted)', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toContain('{!settingsBarCompact && <div className="ac-topbar-right">');
    expect(app).toContain('<div className="ac-topbar-right" hidden={settingsBarCompact && !shellNotifOpen && !shellUserOpen}>');
    expect(readFileSync('src/styles/dark-force.css', 'utf8')).toContain('html body .ac-topbar-right[hidden]:not(#ac-dock-hidden) { display: none !important; }');
  });

  it('public mobile menu ignores taps inside dialogs and menus it opened', () => {
    const src = readFileSync('src/components/PublicChrome.tsx', 'utf8');
    expect(src).toContain('isInFloatingLayer(e.target)');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.appendChild(inner);
    document.body.appendChild(dialog);
    expect(isInFloatingLayer(inner)).toBe(true);
    expect(isInFloatingLayer(document.body)).toBe(false);
    expect(isInFloatingLayer(null)).toBe(false);
  });

  it('a parent re-render with a new inline onClose does not re-run the dialog effect', async () => {
    vi.useFakeTimers();
    try {
      let rerender: () => void = () => {};
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      function Parent() {
        const [n, setN] = useState(0);
        rerender = () => setN((v) => v + 1);
        return createElement('div', { 'data-n': n }, createElement(LanguageSoonDialog, { open: true, onClose: () => {} }));
      }
      await act(async () => root.render(createElement(Parent)));
      await act(async () => { vi.advanceTimersByTime(50); });
      const calls = focusSpy.mock.calls.length;
      for (let i = 0; i < 3; i += 1) {
        await act(async () => rerender());
        await act(async () => { vi.advanceTimersByTime(50); });
      }
      expect(focusSpy.mock.calls.length).toBe(calls);
      expect(document.body.querySelector('.ac-lang-layer')).toBeTruthy();
      focusSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('« Nouveautés » waits for the guided tour and other popups', () => {
    const src = readFileSync('src/components/WhatsNewModal.tsx', 'utf8');
    expect(src).toContain('isOnboardingPending() || isPhoneOnboardingPending() || document.querySelector(OTHER_POPUP)');
  });
});

describe('profile picture', () => {
  it('a profile refresh with the same avatar does not fire atlas-avatar-changed', () => {
    const onChange = vi.fn();
    window.addEventListener('atlas-avatar-changed', onChange);
    try {
      const url = 'data:image/png;base64,iVBORw0KGgo=';
      setProfileCache({ avatar_url: url });
      expect(onChange).toHaveBeenCalledTimes(1);
      setProfileCache({ avatar_url: url, display_name: 'MY' });
      setProfileCache({ avatar_url: url });
      expect(onChange).toHaveBeenCalledTimes(1);
      setProfileCache({ avatar_url: 'data:image/png;base64,AAAA' });
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('atlas-avatar-changed', onChange);
    }
  });

  it('keeps the blob on screen, retries once, and loads eagerly in the topbar', () => {
    const cache = readFileSync('src/lib/avatarCache.ts', 'utf8');
    expect(cache).toContain('pruneStaleAvatars(current)');
    expect(cache).not.toMatch(/'atlas-avatar-changed', \(\) => \{\n\s*invalidateAvatarCache\(\)/);
    const img = readFileSync('src/components/ui/AvatarImage.tsx', 'utf8');
    expect(img).toContain('dropAvatar(url)');
    expect(img).toContain("loading = 'eager'");
    expect(readFileSync('src/components/shell/TopbarUserMenu.tsx', 'utf8')).not.toContain('loading="lazy"');
  });
});
