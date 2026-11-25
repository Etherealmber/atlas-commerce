// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { LanguageSoonDialog, LANGUAGE_SOON_MESSAGE } from '../components/LanguageSoonDialog';

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

describe('Language « bientôt » (v0.9.3)', () => {
  it('announces Arabic and English as coming soon, keeps French selected, closes on Escape and « Compris »', async () => {
    const onClose = vi.fn();
    await act(async () => root.render(createElement(LanguageSoonDialog, { open: true, onClose })));
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(LANGUAGE_SOON_MESSAGE);
    expect(LANGUAGE_SOON_MESSAGE).toMatch(/arabe/);
    expect(LANGUAGE_SOON_MESSAGE).toMatch(/anglais/);
    expect(dialog?.querySelector('.ac-lang-row.is-current')?.textContent).toContain('Français');
    expect(dialog?.querySelectorAll('.ac-lang-row.is-soon')).toHaveLength(2);
    expect(dialog?.querySelector('[lang="ar"]')?.getAttribute('dir')).toBe('rtl');

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    const ok = [...(dialog?.querySelectorAll('button') || [])].find((b) => b.textContent?.includes('Compris'));
    await act(async () => ok?.click());
    expect(onClose).toHaveBeenCalledTimes(2);
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
