// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhoneDialog from '../mobile/PhoneDialog';

let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host);
  trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }] as unknown as DOMRectList);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); trigger.remove(); vi.restoreAllMocks();
});

describe('phone scan dialog', () => {
  it('moves and traps keyboard focus, closes on Escape, and restores focus', async () => {
    const close = vi.fn();
    await act(async () => root.render(createElement(PhoneDialog, {
      titleId: 'dialog-title', onClose: close,
      children: createElement('div', null,
        createElement('h3', { id: 'dialog-title' }, 'Scan'),
        createElement('input', { 'aria-label': 'Quantité' }),
        createElement('button', null, 'Annuler')),
    })));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = dialog.querySelector('input')!;
    const button = dialog.querySelector('button')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input);
    button.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
    input.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(button);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
  });
});
