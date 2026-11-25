// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { LanguageSoonDialog, LANGUAGE_SOON_MESSAGE } from '../components/LanguageSoonDialog';
import { setLang } from '../i18n/core';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('Language picker (fr / ar RTL / en)', () => {
  it('lists the three languages, switches language + dir, informs Android, closes on Escape and « Terminé »', async () => {
    const onClose = vi.fn();
    const native = { setLanguage: vi.fn() };
    (window as unknown as { AtlasAndroid?: unknown }).AtlasAndroid = native;
    setLang('fr');
    await act(async () => root.render(createElement(LanguageSoonDialog, { open: true, onClose })));
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(LANGUAGE_SOON_MESSAGE);
    expect(dialog?.querySelector('.ac-lang-row.is-current')?.textContent).toContain('Français');
    expect(dialog?.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(dialog?.querySelector('[lang="ar"]')?.getAttribute('dir')).toBe('rtl');

    const ar = [...(dialog?.querySelectorAll<HTMLButtonElement>('[role="radio"]') || [])].find((b) => b.textContent?.includes('العربية'));
    await act(async () => ar?.click());
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('atlas_lang')).toBe('ar');
    expect(native.setLanguage).toHaveBeenCalledWith('ar');
    expect(dialog?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('العربية');

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    const ok = [...(dialog?.querySelectorAll('button') || [])].find((b) => b.textContent?.includes('Terminé'));
    await act(async () => ok?.click());
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => setLang('fr'));
    expect(document.documentElement.dir).toBe('ltr');
    delete (window as unknown as { AtlasAndroid?: unknown }).AtlasAndroid;
  });

  it('renders nothing when closed', async () => {
    await act(async () => root.render(createElement(LanguageSoonDialog, { open: false, onClose: () => {} })));
    expect(document.body.querySelector('.ac-lang-layer')).toBeNull();
  });

  it('is reachable from the Settings profile section and the top user menu — not the Settings sidebar', () => {
    const sidebar = readFileSync('src/components/FocusSidebar.tsx', 'utf8');
    const menu = readFileSync('src/components/shell/TopbarUserMenu.tsx', 'utf8');
    const settings = readFileSync('src/pages/Settings.tsx', 'utf8');
    for (const src of [menu, settings]) expect(src).toContain('<LanguageSoonDialog');
    expect(sidebar).not.toContain("label: 'Langue'");
    expect(sidebar).not.toContain('LanguageSoonDialog');
    expect(menu).toContain('<b>Langue</b>');
    expect(settings).toContain('id="settings-language"');
  });

  it('floats the settings save popup on <body> so a transformed ancestor cannot push it off-screen', () => {
    const settings = readFileSync('src/pages/Settings.tsx', 'utf8');
    expect(settings).toMatch(/\(settingsDirty \|\| \(justSaved [^)]*\) \|\| blockedNotice\) && createPortal\(/);
    expect(settings).toContain('ac-settings-float');
  });
});
