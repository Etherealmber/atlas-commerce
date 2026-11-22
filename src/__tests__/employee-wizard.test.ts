// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Employees from '../pages/Employees';
import { api } from '../api';
vi.mock('../lib/reports', () => ({ openReport: vi.fn(), openPrintDoc: vi.fn() }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.spyOn(api, 'getEmployees').mockResolvedValue({ data: [] } as any);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const dialog = () => document.querySelector<HTMLElement>('.employee-wizard')!;
const button = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function input(id: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(id)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles:true })); });
}
async function open(phone = false) {
  await act(async () => root.render(createElement(Employees, {phone})));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Ajouter un employé'))!.click());
}
it('guides the employee form, validates name, preserves data and uploads the selected file', async () => {
  const create = vi.spyOn(api,'createEmployee').mockResolvedValue({data:{id: 42}} as any);
  const upload = vi.spyOn(api,'uploadEmployeeIdDoc').mockResolvedValue({} as any);
  await open(); expect(dialog().getAttribute('role')).toBe('dialog');
  expect(dialog().querySelector('[aria-current="step"]')?.textContent).toContain('Personnel');
  await click('Continuer'); expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('prénom ou le nom'); expect(create).not.toHaveBeenCalled();
  await input('#employee-first-name', 'Samira'); await click('Continuer');
  expect(dialog().querySelector('[aria-current="step"]')?.textContent).toContain('Identité');
  const picker = dialog().querySelector<HTMLInputElement>('input[type=file]')!;
  const data = new DataTransfer(); data.items.add(new File(['identity'], 'piece.pdf', { type:'application/pdf' })); picker.files = data.files;
  await act(async () => picker.dispatchEvent(new Event('change',{bubbles:true})));
  expect(dialog().textContent).toContain('piece.pdf');
  await click('Retour'); expect(dialog().querySelector<HTMLInputElement>('#employee-first-name')?.value).toBe('Samira'); await click('Continuer');
  expect(dialog().textContent).toContain('piece.pdf');
  for (const label of ['Social & fiscal','Poste','Contact','Salaire','Contrat','Détails']) { await click('Continuer'); expect(dialog().querySelector('[aria-current="step"]')?.textContent).toContain(label); }
  await click('Créer l’employé');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({first_name:'Samira',name:'Samira',pay_cycle_type:'monthly'}));
  expect(upload).toHaveBeenCalledWith(42, expect.objectContaining({file_name:'piece.pdf',mime:'application/pdf'}));
  expect(document.querySelector('.employee-wizard')).toBeNull();
});
it('supports cancel and restarts the wizard on phone without saving', async () => {
  const create = vi.spyOn(api,'createEmployee'); await open(true); await input('#employee-first-name','Leila'); await click('Continuer'); await click('Annuler');
  expect(document.querySelector('.employee-wizard')).toBeNull(); expect(create).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Ajouter un employé'))!.click());
  expect(dialog().querySelector<HTMLInputElement>('#employee-first-name')?.value).toBe('');
  expect(dialog().querySelector('[aria-current="step"]')?.textContent).toContain('Personnel');
});
it('uses 8 steps and omits Fiche and Situation buttons inside the edit modal', async () => {
  vi.spyOn(api, 'getEmployees').mockResolvedValue({
    data: [{ id: 7, name: 'Nadia Benali', first_name: 'Nadia', last_name: 'Benali', pay_amount: 5000, pay_cycle_type: 'monthly', active: 1 }],
  } as any);
  await act(async () => root.render(createElement(Employees)));
  await act(async () => { await Promise.resolve(); });
  const editTrigger = host.querySelector<HTMLElement>('tbody [role="button"]')!;
  expect(editTrigger).toBeTruthy();
  await act(async () => editTrigger.click());
  expect(dialog().querySelector('.employee-wizard__count')?.textContent?.trim()).toBe('1 / 8');
  expect(dialog().querySelector('.wizard-foot-extra')).toBeNull();
  const labels = [...dialog().querySelectorAll('button')].map(b => b.textContent?.trim());
  expect(labels).not.toContain('Fiche');
  expect(labels).not.toContain('Situation');
});
