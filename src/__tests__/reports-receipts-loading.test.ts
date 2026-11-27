// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Reports from '../pages/Reports';
import Receipts from '../pages/Receipts';
import { AppDialogsProvider } from '../components/AppDialogs';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;
const deferred = () => { let resolve!: (v: any) => void; let reject!: (e: Error) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const render = (component: any) => root.render(createElement(MemoryRouter, null, createElement(AppDialogsProvider, null, createElement(component))));
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders completed and empty report sections without waiting for a slow report, and shows failures instead of false zeros', async () => {
  const slow = deferred();
  vi.spyOn(api, 'getAgingReport').mockResolvedValue({ data: { buckets: {}, rows: [] } } as any);
  vi.spyOn(api, 'getTvaReport').mockReturnValue(slow.promise);
  vi.spyOn(api, 'getReorderList').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getCogsReport').mockResolvedValue({ data: { lines: [] } } as any);
  vi.spyOn(api, 'getPeriodLock').mockResolvedValue({ data: {} } as any);
  await act(async () => { render(Reports); });
  expect(host.textContent).toContain('Aucune créance ouverte.');
  expect(host.textContent).toContain('Aucun produit sous le seuil.');
  expect(host.querySelector('[aria-label="Chargement du rapport"]')).toBeTruthy();
  await act(async () => { slow.reject(new Error('offline')); });
  expect(host.textContent).toContain('Impossible de charger cette section');
  expect(host.textContent).not.toContain('Aucune vente.');
});

it('shows an empty receipts list while invoice choices are still loading', async () => {
  const slow = deferred();
  vi.spyOn(api, 'getReceipts').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getInvoices').mockReturnValue(slow.promise);
  await act(async () => { render(Receipts); });
  expect(host.textContent).toContain('0 reçu');
  expect(host.querySelector('.receipts-page .ac-products-table')).toBeTruthy();
  await act(async () => { slow.resolve({ data: [] }); });
});

it('does not report an empty receipts list when the list request fails', async () => {
  vi.spyOn(api, 'getReceipts').mockRejectedValue(new Error('offline'));
  vi.spyOn(api, 'getInvoices').mockResolvedValue({ data: [] } as any);
  await act(async () => { render(Receipts); });
  expect(host.textContent).toContain('Impossible de charger les reçus');
  expect(host.textContent).not.toContain('Créer mon premier reçu');
});

it('keeps the newest report range when an older request finishes later', async () => {
  const old = deferred();
  vi.spyOn(api, 'getAgingReport').mockResolvedValue({ data: { buckets: {}, rows: [] } } as any);
  vi.spyOn(api, 'getTvaReport').mockReturnValueOnce(old.promise).mockResolvedValue({ data: { net_tva: 222, sales: [], credits: [] } } as any);
  vi.spyOn(api, 'getCogsReport').mockResolvedValue({ data: { lines: [] } } as any);
  vi.spyOn(api, 'getReorderList').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getPeriodLock').mockResolvedValue({ data: {} } as any);
  await act(async () => { render(Reports); });
  const range = host.querySelector<HTMLButtonElement>('button[title="7 jours"]')!;
  await act(async () => { range.click(); });
  expect(host.textContent).toContain('222 MAD');
  await act(async () => { old.resolve({ data: { net_tva: 111, sales: [], credits: [] } }); });
  expect(host.textContent).toContain('222 MAD');
  expect(host.textContent).not.toContain('111 MAD');
});

it('shows the receipt QR state accessibly and omits the redundant PDF button', async () => {
  vi.spyOn(api, 'getReceipts').mockResolvedValue({ data: [{ id: 1, number: 'REC-1', client_name: 'Test', amount: 12, issue_date: '2026-01-01', include_client_situation: 0 }] } as any);
  vi.spyOn(api, 'getInvoices').mockResolvedValue({ data: [] } as any);
  await act(async () => { render(Receipts); });
  const toggle = host.querySelector<HTMLButtonElement>('.receipt-situation-toggle');
  expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  expect(toggle?.classList.contains('is-off')).toBe(true);
  expect(toggle?.textContent).toContain('désactivée');
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.trim() === 'PDF')).toBe(false);
});
