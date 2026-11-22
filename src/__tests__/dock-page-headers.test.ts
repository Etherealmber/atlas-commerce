// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { titleForPath } from '../lib/pageTitle';
import Quotes from '../pages/Quotes';
import QuickSale from '../pages/QuickSale';
import Invoices from '../pages/Invoices';
import Reimbursements from '../pages/Reimbursements';
import Receipts from '../pages/Receipts';
import Vendors from '../pages/Vendors';
import Clients from '../pages/Clients';
import Bills from '../pages/Bills';
import Balance from '../pages/Balance';
import Reports from '../pages/Reports';
import InventoryOps from '../pages/InventoryOps';

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })));
  for (const method of ['getInvoices','getClients','getProducts','getReceipts','getVendors','getBills','getExpenses','getStockLocations','getAutoTransferRules'] as const) {
    vi.spyOn(api, method).mockResolvedValue({data: []} as any);
  }
  vi.spyOn(api,'getDashboard').mockResolvedValue({data: {}} as any);
  vi.spyOn(api,'getAgingReport').mockResolvedValue({data: null} as any);
  vi.spyOn(api,'getStockValuation').mockResolvedValue({data: null} as any);
  vi.spyOn(api,'getStockReport').mockResolvedValue({data: null} as any);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  [Quotes,'/quotes','Devis'], [QuickSale,'/quick-sale','Vente rapide'],
  [Invoices,'/invoices','Factures de vente'], [Reimbursements,'/reimbursements','Remboursements'],
  [Receipts,'/receipts','Reçus'], [Vendors,'/vendors','Fournisseurs'],
  [Clients,'/clients','Clients'],
  [Bills,'/bills',"Factures d'achat"], [Balance,'/balance','Solde & mouvements'],
  [Reports,'/reports','Rapports & clôture'], [InventoryOps,'/inventory-ops','Opérations stock'],
])('retains the accessible heading and dock title for %s', async (Page,path,title) => {
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:[path]},createElement(Page))));
  const heading = host.querySelector('h1');
  expect(heading?.textContent).toBe(title);
  expect(heading?.classList.contains('sr-only')).toBe(true);
  expect(titleForPath(path)).toBe(`${title} · Atlas`);
  const header = host.querySelector('.dock-page-header');
  if (header) expect(header.querySelector('.dock-page-actions')).not.toBeNull();
});

it('removes the supplier reference panel without requesting or changing its data', async () => {
  const getParts = vi.spyOn(api,'getVendorParts');
  const addPart = vi.spyOn(api,'addVendorPart');
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:['/vendors']},createElement(Vendors))));
  expect(host.textContent).not.toContain('Références fournisseur & tarifs dégressifs');
  expect(getParts).not.toHaveBeenCalled(); expect(addPart).not.toHaveBeenCalled();
  expect(api.getVendors).toHaveBeenCalled();
});

it.each([
  [Quotes,'/quotes'], [QuickSale,'/quick-sale'], [Invoices,'/invoices'],
  [Reimbursements,'/reimbursements'], [Receipts,'/receipts'], [Vendors,'/vendors'],
  [Clients,'/clients'], [Bills,'/bills'], [Balance,'/balance'],
])('puts the page actions in the top slot for %s when there is room', async (Page,path) => {
  const column=document.createElement('div'); column.className='ac-main-column';
  const slot=document.createElement('div'); slot.id='desktop-catalog-actions';
  const dock=document.createElement('header'); dock.className='ac-desktop-dock';
  document.body.appendChild(column); column.appendChild(slot); column.appendChild(dock); column.appendChild(host);
  vi.stubGlobal('innerWidth',2000);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width=this===column ? 1600 : this===dock ? 320 : 80;
    return {width,height:40,top:0,left:0,right:width,bottom:40,x:0,y:0,toJSON:()=>({})};
  });
  await act(async () => root.render(createElement(MemoryRouter,{initialEntries:[path]},createElement(Page))));
  expect(slot.querySelector('[aria-label="Actualiser"]')).not.toBeNull();
  for (const el of slot.querySelectorAll('.top-page-actions > button, .top-page-actions > a')) {
    expect(el.querySelector('svg')).not.toBeNull();
  }
  expect(host.querySelector('.dock-page-header [data-docked="true"]')).not.toBeNull();
  expect(host.querySelector('.dock-page-header .dock-page-actions')).toBeNull();
  await act(async () => slot.querySelector<HTMLButtonElement>('[aria-label="Actualiser"]')!.click());
  expect(slot.querySelector('[aria-label="Actualiser"]')).not.toBeNull();
  column.remove();
});

it('opens quote details from its number', async () => {
  const q = { id: 17, number: 'DV-17', client_name: 'Client', issue_date: '2026-10-20', status: 'quote', total: 120, items: [] };
  vi.mocked(api.getInvoices).mockResolvedValue({ data: [q] } as any);
  const detail = vi.spyOn(api, 'getInvoice').mockResolvedValue({ data: q } as any);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/quotes'] }, createElement(Quotes))));
  const number = host.querySelector<HTMLButtonElement>('.quote-number-link');
  expect(number?.textContent).toBe('DV-17');
  await act(async () => number!.click());
  expect(detail).toHaveBeenCalledWith(17);
  expect(document.body.textContent).toContain('Modifier le devis DV-17');
});
