// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Employees from '../pages/Employees';
import { api } from '../api';

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.spyOn(api, 'getEmployees').mockResolvedValue({ data: [{ id: 12, first_name: 'Samira', last_name: 'Test', active: 1, role_title: 'Gestion', emp_number: 'EMP-12', pay_amount: 4800, pay_cycle_type: 'monthly', pay_overdue: true, next_due: '2026-11-30', phone: '0600000000' }] } as any);
  vi.spyOn(api, 'getEmployee').mockResolvedValue({ data: { id: 12, first_name: 'Samira', last_name: 'Test', active: 1 } } as any);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('uses the existing employee data and actions in a phone-friendly directory', async () => {
  await act(async () => root.render(createElement(Employees, { phone: true })));
  expect(api.getEmployees).toHaveBeenCalled();
  const card = host.querySelector('.ph-employee-card')!;
  expect(card.textContent).toContain('Samira Test');
  expect(card.textContent).toContain('4 800 MAD');
  expect(card.textContent).toContain('2026-11-30 · à payer');
  expect(card.textContent).toContain('Marquer payé');
  expect(card.textContent).toContain('Acompte');
  await act(async () => [...card.querySelectorAll('button')].find(b => b.textContent === 'Détails & historique')!.click());
  expect(api.getEmployee).toHaveBeenCalledWith(12);
  expect(host.textContent).toContain('Samira Test');
});
it('keeps the original desktop table', async () => {
  await act(async () => root.render(createElement(Employees)));
  expect(host.querySelector('table tbody')?.textContent).toContain('Samira Test');
  expect(host.querySelector('.ph-employee-card')).toBeNull();
});

it('opens the existing payment confirmation without submitting a payment', async () => {
  const pay = vi.spyOn(api, 'payEmployee');
  await act(async () => root.render(createElement(Employees, { phone: true })));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.ph-employee-more button')].find(button => button.textContent?.trim() === 'Marquer payé')!.click());
  expect(document.body.querySelector('.modal-overlay')?.textContent).toContain('Marquer payé');
  expect(pay).not.toHaveBeenCalled();
});
