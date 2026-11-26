// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installI18n, retranslateAll, setLang } from '../i18n';
import { LanguageSoonDialog } from '../components/LanguageSoonDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installI18n();
afterEach(() => { setLang('fr'); document.body.innerHTML = ''; });

describe('localized language chooser', () => {
  it('localizes Done and supports keyboard selection without losing focus', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const close = vi.fn();
    await act(async () => root.render(createElement(LanguageSoonDialog, { open: true, onClose: close })));
    const radios = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios).toHaveLength(3);
    expect(document.querySelector('.ac-lang-preview-note')?.textContent).toContain('arabe et anglaise');
    await act(async () => { radios[0].focus(); radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    retranslateAll(); await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.documentElement.lang).toBe('ar');
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.activeElement).toBe(radios[1]);
    expect(document.querySelector('.ac-lang-ok')?.textContent?.trim()).toBe('تم');
    await act(async () => root.unmount());
  });
});
