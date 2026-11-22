// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import QuickSale from '../pages/QuickSale';
import Invoices from '../pages/Invoices';
import Bills from '../pages/Bills';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host=document.createElement('div'); document.body.appendChild(host); root=createRoot(host);
  vi.spyOn(api,'getInvoices').mockResolvedValue({data:[]} as any);
  vi.spyOn(api,'getBills').mockResolvedValue({data:[]} as any);
  vi.spyOn(api,'getProducts').mockResolvedValue({data:[]} as any);
  vi.spyOn(api,'getClients').mockResolvedValue({data:[]} as any);
  vi.spyOn(api,'getVendors').mockResolvedValue({data:[]} as any);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it.each([
  ['ventes rapides',QuickSale,'/quick-sale','getInvoices'],
  ['factures de vente',Invoices,'/invoices','getInvoices'],
  ['factures d’achat',Bills,'/bills','getBills'],
] as const)('places the %s status filter next to search and keeps it functional', async (_label, Page, path, method) => {
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:[path]},createElement(Page))));
  const panel=host.querySelector('.ac-products-filters')!;
  expect(panel.querySelector('input')).not.toBeNull();
  const select=panel.querySelector('select[aria-label="Filtrer par statut"]') as unknown as HTMLSelectElement;
  expect(select).not.toBeNull(); expect(host.querySelector('.page-header select')).toBeNull();
  await act(async () => { select.value='paid'; select.dispatchEvent(new Event('change',{bubbles:true})); });
  expect(api[method]).toHaveBeenCalledWith('paid', ...(method === 'getInvoices' && Page === QuickSale ? [{kind:'quick_sale'}] : []));
  expect((host.querySelector('.ac-products-filters select') as unknown as HTMLSelectElement)?.value).toBe('paid');
});

it('keeps the invoice refresh and creation actions in the requested order, including client-filter context', async () => {
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:['/invoices?client=7']},createElement(Invoices))));
  expect(host.textContent).toContain('Filtré par client #7');
  const header=host.querySelector('.page-header')!;
  expect(header.querySelector('h1')?.classList.contains('sr-only')).toBe(true);
  expect(header.querySelector('.dock-page-actions')).not.toBeNull();
  const buttons=[...header.querySelectorAll('button')];
  expect(buttons.map(b=>b.getAttribute('aria-label') || b.textContent?.trim())).toEqual(['Actualiser','Remboursement (WR)','Créer une facture']);
  expect(header.textContent).not.toContain('Exporter les créances');
  expect(header.textContent).not.toContain('Télécharger le CSV');
  await act(async () => buttons[2].click());
  expect(document.body.textContent).toContain('Nouvelle facture de vente');
});

it('opens refund independently after its position is swapped', async () => {
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:['/invoices']},createElement(Invoices))));
  const refund=[...host.querySelectorAll<HTMLButtonElement>('.page-header button')].find(b=>b.textContent?.includes('Remboursement'))!;
  await act(async () => refund.click());
  expect(document.body.textContent).toContain('Remboursement / avoir (code WR)');
});
