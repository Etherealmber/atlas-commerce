// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn() }));
vi.mock('../api', () => ({ api: { getDeliveryNotes: mocks.list } }));
vi.mock('../lib/deliveryNote', () => ({ openExistingDeliveryNote: mocks.open }));
import DeliveryNotesPanel from '../components/DeliveryNotesPanel';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); mocks.list.mockReset(); mocks.open.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('discovers existing delivery notes and reopens one without creating it', async () => {
  mocks.list.mockResolvedValue({ data: [{ id: 4, number: 'BL-2026-0004', client_name: 'Client', issue_date: '2026-10-20' }] });
  await act(async () => root.render(createElement(DeliveryNotesPanel)));
  expect(mocks.list).not.toHaveBeenCalled();
  await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
  expect(document.body.textContent).toContain('BL-2026-0004');
  expect(document.body.textContent).toContain('100 derniers');
  await act(async () => { [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('Imprimer'))!.click(); });
  expect(mocks.open).toHaveBeenCalledWith(4);
});

it('shows an error and permits retry after list loading fails', async () => {
  mocks.list.mockRejectedValueOnce(new Error('Service indisponible')).mockResolvedValueOnce({ data: [] });
  await act(async () => root.render(createElement(DeliveryNotesPanel)));
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(document.body.querySelector('[role=alert]')?.textContent).toContain('Service indisponible');
  await act(async () => [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Réessayer')!.click());
  expect(document.body.textContent).toContain('Aucun bon de livraison créé');
});

it('opens a dialog and closes it with Escape', async () => {
  mocks.list.mockResolvedValue({ data: [] });
  await act(async () => root.render(createElement(DeliveryNotesPanel)));
  const trigger = host.querySelector<HTMLButtonElement>('button')!;
  await act(async () => trigger.click());
  expect(document.body.querySelector('[role=dialog]')?.getAttribute('aria-modal')).toBe('true');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
