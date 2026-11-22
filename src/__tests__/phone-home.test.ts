// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhoneHome from '../mobile/PhoneHome';
import { api } from '../api';

vi.mock('../mobile/PhoneMonthlyReport', () => ({ default: ({ period }: { period: string }) => createElement('div', { role: 'dialog' }, `PDF ${period}`) }));

const identity = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('../auth', () => ({ getRole: () => identity.role, canSell: () => ['owner', 'admin', 'secretaire'].includes(identity.role), getToken: () => 'test', isLoggedIn: () => true }));
const dash = { productCount: 512, lowStockCount: 3, currentBalance: 1234, stockValue: 2450, currency: 'MAD', unpaidSales: { total: 300, count: 2, overdue: 0 }, monthlySeries: [{ key: '2026-10', label: 'Oct', sales: 200 }], recentInvoices: [{ id: 1, number: 'FAC-1', client_name: 'Test', total: 45 }] };
const finance = { period: '2026-10', currency: 'MAD', opening_balance: 100, closing_balance: 200, sales_received: 40 };
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; identity.role = 'owner';
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: dash });
  vi.spyOn(api, 'getFinanceMonthly').mockResolvedValue({ data: finance as any });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneHome) }))); }
describe('Android-style home', () => {
  it('shows authoritative server counts and protected financial values', async () => {
    await render();
    expect(host.textContent).toContain('SOLDE DE TRÉSORERIE'); expect(host.textContent).toContain('512');
    expect(host.textContent).toContain('1 234,00 MAD'); expect(host.textContent).toContain('FAC-1');
    expect(host.textContent).toContain('Tendance des ventes'); expect(host.textContent).toContain('Rapport mensuel PDF');
  });
  it('refreshes the finance card without reloading the dashboard', async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser les finances"]')!.click());
    expect(api.getDashboard).toHaveBeenCalledTimes(1); expect(api.getFinanceMonthly).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('FAC-1');
  });
  it('selects a finance month and ignores older responses', async () => {
    await render();
    let finish!: (value: any) => void;
    vi.mocked(api.getFinanceMonthly).mockImplementation(period => period === '2026-09' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: { ...finance, period } as any }));
    const select = host.querySelector('[aria-label="Choisir un mois financier"]') as unknown as { value: string; dispatchEvent: (event: Event) => boolean };
    await act(async () => { select.value = '2026-09'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { select.value = '2026-08'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => finish({ data: { ...finance, period: '2026-09', closing_balance: 99999 } }));
    expect(api.getFinanceMonthly).toHaveBeenLastCalledWith('2026-08');
    expect(select.value).toBe('2026-08'); expect(host.textContent).not.toContain('99 999');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser les finances"]')!.click());
    expect(api.getFinanceMonthly).toHaveBeenLastCalledWith('2026-08');
  });
  it('opens the selected month report and the report pack from home', async () => {
    await render();
    vi.mocked(api.getFinanceMonthly).mockImplementation(async period => ({ data: { ...finance, period } as any }));
    const select = host.querySelector('[aria-label="Choisir un mois financier"]') as unknown as { value: string; dispatchEvent: (event: Event) => boolean };
    await act(async () => { select.value = '2026-09'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const pdf = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Rapport mensuel PDF'))!;
    await act(async () => pdf.click()); expect(document.body.textContent).toContain('PDF 2026-09');
    const bundle = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Pack de rapports'))!;
    await act(async () => bundle.click()); expect(document.body.textContent).toContain('Personnaliser le rapport');
  });
  it('does not expose dashboard financial figures when the protected finance request fails', async () => {
    vi.mocked(api.getFinanceMonthly).mockRejectedValue(new Error('forbidden'));
    await render();
    expect(host.textContent).toContain('CATALOGUE & STOCK'); expect(host.textContent).toContain('Données financières indisponibles');
    expect(host.textContent).not.toContain('1 234,00 MAD'); expect(host.textContent).not.toContain('2 450,00 MAD');
  });
  it('does not request finance for stock roles and labels a capped low-stock list', async () => {
    identity.role = 'stock'; vi.mocked(api.getDashboard).mockResolvedValue({ data: { operational_only: true, products: 701, low_stock: Array.from({ length: 50 }, () => ({})) } });
    await render();
    expect(api.getFinanceMonthly).not.toHaveBeenCalled(); expect(host.textContent).toContain('701 articles actifs');
    expect(host.textContent).toContain('50+'); expect(host.textContent).not.toContain('Rapport mensuel PDF');
  });
  it('shows an error instead of inventing empty totals when dashboard fails', async () => {
    vi.mocked(api.getDashboard).mockRejectedValue(new Error('offline'));
    await render(); expect(host.textContent).toContain('Tableau de bord indisponible'); expect(host.textContent).not.toContain('articles actifs');
  });
});
