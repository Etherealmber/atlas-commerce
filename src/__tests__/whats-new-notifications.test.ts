// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsNew from '../pages/WhatsNew';
import WhatsNewModal from '../components/WhatsNewModal';
import {
  getSeenWhatsNewVersion, hasUnreadWhatsNew, markWhatsNewModalSeen,
  markWhatsNewSeen, shouldShowWhatsNewModal,
} from '../lib/whatsNew';

// DOM assertions only: bypass animation scheduling unsupported by happy-dom.
vi.mock('motion/react', async () => {
  const { createElement: element } = await import('react');
  const plain = (tag: string) => (props: Record<string, unknown>) => element(tag,
    Object.fromEntries(Object.entries(props).filter(([key]) => !['initial', 'animate', 'transition'].includes(key))));
  return { motion: { h1: plain('h1'), section: plain('section') } };
});
vi.mock('../auth', () => ({ isLoggedIn: () => false, getToken: () => null }));
// A build-only change must not affect the published notes or their seen markers.
vi.mock('../version', async (importOriginal) => ({
  ...await importOriginal<typeof import('../version')>(),
  APP_VERSION: '0.9.0-build.2', DISPLAY_VERSION: 'build-only-test',
}));

const SEEN = 'atlas-whats-new-seen';
const MODAL = 'atlas-whats-new-modal-seen';
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(node: ReactNode, path = '/dashboard') {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  await act(async () => vi.advanceTimersByTime(950));
}

describe('published release notification state', () => {
  it('announces the new 0.9.4 notes to someone who has seen 0.9.3', () => {
    localStorage.setItem(SEEN, '0.9.3-beta');
    localStorage.setItem(MODAL, '0.9.3-beta');
    expect(hasUnreadWhatsNew()).toBe(true);
    expect(shouldShowWhatsNewModal()).toBe(true);
  });
  it.each(['0.9.4', '0.9.4-beta'])('preserves an existing %s marker across build changes', (version) => {
    localStorage.setItem(SEEN, version);
    localStorage.setItem(MODAL, version);
    expect(hasUnreadWhatsNew()).toBe(false);
    expect(shouldShowWhatsNewModal()).toBe(false);
    markWhatsNewSeen();
    markWhatsNewModalSeen();
    expect(getSeenWhatsNewVersion()).toBe(version);
    expect(localStorage.getItem(MODAL)).toBe(version);
  });
  it('does not reopen a modal when the page-seen marker already covers the release', () => {
    localStorage.setItem(SEEN, '0.9.4-beta');
    expect(shouldShowWhatsNewModal()).toBe(false);
  });
  it('dismissing only the modal leaves the page unread badge intact', () => {
    markWhatsNewModalSeen();
    expect(shouldShowWhatsNewModal()).toBe(false);
    expect(hasUnreadWhatsNew()).toBe(true);
    expect(localStorage.getItem(MODAL)).toBe('0.9.4');
  });
  it('visiting the notes records the published version, not the build version', () => {
    markWhatsNewSeen();
    expect(localStorage.getItem(SEEN)).toBe('0.9.4');
    expect(localStorage.getItem(MODAL)).toBe('0.9.4');
    expect(hasUnreadWhatsNew()).toBe(false);
  });
  it('preserves newer seen markers when running an older build', () => {
    localStorage.setItem(SEEN, '0.10.0-beta');
    localStorage.setItem(MODAL, '0.10.0-beta');
    markWhatsNewSeen();
    expect(getSeenWhatsNewVersion()).toBe('0.10.0-beta');
    expect(shouldShowWhatsNewModal()).toBe(false);
  });
  it('does not let an unparseable marker silently hide the notes', () => {
    localStorage.setItem(SEEN, 'not-a-version');
    expect(hasUnreadWhatsNew()).toBe(true);
  });
  it('handles unavailable storage without crashing or opening a repeating modal', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(shouldShowWhatsNewModal()).toBe(false);
    expect(() => markWhatsNewSeen()).not.toThrow();
    expect(() => markWhatsNewModalSeen()).not.toThrow();
  });
});

describe('release page and popup content', () => {
  it('shows 0.9.4 first while retaining prior releases', async () => {
    await render(createElement(WhatsNew), '/whats-new');
    const releases = host.querySelectorAll('.wn-release');
    expect(releases[0].textContent).toContain('0.9.4');
    expect(releases[0].textContent).toContain('Visite guidée');
    expect(releases[1].textContent).toContain('0.9.3');
    expect(releases[1].textContent).toContain('Navigation entre les pages réécrite');
    expect(releases[2].textContent).toContain('0.9.2');
    expect(releases[2].textContent).toContain('Interfaces de chargement harmonisées');
    expect(releases[3].textContent).toContain('0.9.1');
    expect(releases[3].textContent).toContain('Connexion desktop expérimentale');
    expect(releases[4].textContent).toContain('0.9.0');
    expect(releases[4].textContent).toContain('Cookies et données locales');
    expect(releases[5].textContent).toContain('0.8.9');
    expect(releases[5].textContent).toContain('API de suivi');
    expect(localStorage.getItem(SEEN)).toBe('0.9.4');
  });
  it('pairs popup title, date and bullets with the published release', async () => {
    await render(createElement(WhatsNewModal));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Atlas Commerce 0.9.4');
    expect(dialog?.textContent).toContain('25 novembre 2026');
    expect(dialog?.textContent).toContain('Visite guidée');
    expect(dialog?.textContent).toContain('Densité « Compacte »');
    expect(dialog?.textContent).toContain('Se déconnecter ?');
    expect(dialog?.textContent).not.toContain('bouton « Langue »');
    expect(dialog?.textContent).not.toContain('build-only-test');
    expect(dialog?.textContent).not.toContain('API de suivi');
    expect(dialog?.querySelectorAll('li')).toHaveLength(3);
    const dismissButton = dialog?.querySelector('button');
    if (!dismissButton) throw new Error('Missing release popup dismiss button');
    await act(async () => dismissButton.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(localStorage.getItem(MODAL)).toBe('0.9.4');
  });
  it('does not display the modal on the notes page itself', async () => {
    await render(createElement(WhatsNewModal), '/whats-new');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
