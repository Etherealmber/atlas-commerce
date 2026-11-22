// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import SettingsUserDialog from '../components/SettingsUserDialog';

it('opens on demand, traps keyboard focus and restores focus on Escape', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement('div', null,
      createElement('button', { onClick: () => setOpen(true) }, 'Open'),
      open && createElement(SettingsUserDialog, { onClose: () => setOpen(false) },
        createElement('h2', { id: 'create-team-user-title' }, 'Create'),
        createElement('input', { name: 'team-new-identifier' }),
        createElement('button', null, 'Cancel')));
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    const open = host.querySelector('button')!;
    expect(document.querySelector('[role=dialog]')).toBeNull();
    open.focus(); await act(async () => open.click());
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.getAttribute('name')).toBe('team-new-identifier');
    const input = dialog.querySelector('input')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe('Cancel');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(open);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('keeps the creation fields conditional and marks the password as a new password', () => {
  const settings = readFileSync('src/pages/Settings.tsx', 'utf8');
  expect(settings).toContain('{userCreateOpen && <SettingsUserDialog');
  expect(settings).toContain('name="team-new-secret" autoComplete="new-password"');
  expect(settings).toContain('closeUserCreate();');
});
