// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDialogsProvider } from '../components/AppDialogs';

vi.mock('motion/react', async () => {
  const { createElement: element } = await import('react');
  const plain = (tag: string) => (props: Record<string, unknown>) =>
    element(
      tag,
      Object.fromEntries(
        Object.entries(props).filter(([key]) => !['initial', 'animate', 'exit', 'custom', 'transition'].includes(key)),
      ),
    );
  return {
    motion: { h1: plain('h1'), section: plain('section'), span: plain('span') },
    AnimatePresence: ({ children }: { children: unknown }) => children,
  };
});
import Products from '../pages/Products';
import QuickSale from '../pages/QuickSale';
import Quotes from '../pages/Quotes';
import Balance from '../pages/Balance';
import WhatsNew from '../pages/WhatsNew';
import About from '../pages/About';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('stock_role', 'owner');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('List UX, danger/dock/slot CSS fixes, pagination (20/page), and release contributors', () => {
  it('enforces danger hover contrast, single-line desktop row-actions, unclipped compact dock, and non-jumping actions slot CSS', () => {
    const darkForce = readFileSync(path.resolve(process.cwd(), 'src/styles/dark-force.css'), 'utf8');
    const shellCss = readFileSync(path.resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');
    const overridesFinal = readFileSync(path.resolve(process.cwd(), 'src/styles/overrides-final.css'), 'utf8');
    const appCss = readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
    const crmCss = readFileSync(path.resolve(process.cwd(), 'src/components/erp/crm-parties.css'), 'utf8');
    const productsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Products.tsx'), 'utf8');
    const quickSaleSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/QuickSale.tsx'), 'utf8');

    expect(darkForce).toMatch(/button\.danger:not\(\.ac-timed-delete-btn\):not\(\.ac-timed-undo-btn\):hover:not\(:disabled\)[\s\S]*background:\s*#b91c1c\s*!important;[\s\S]*color:\s*#ffffff\s*!important;[\s\S]*-webkit-text-fill-color:\s*#ffffff\s*!important;/);
    expect(darkForce).toMatch(/@media\s*\(min-width:\s*901px\)[\s\S]*td\.row-actions-cell\s*>\s*\.row-actions[\s\S]*table\.ac-products-table\s*\.row-actions[\s\S]*flex-wrap:\s*nowrap\s*!important/);
    expect(darkForce).toMatch(/html\s+body\s+a\.btn[\s\S]*text-decoration:\s*none\s*!important/);
    expect(darkForce).toMatch(/\.ac-desktop-dock\s+\.ac-topbar-icon\s*\{[^}]*width:\s*40px\s*!important[^}]*border-radius:\s*999px\s*!important/s);
    expect(crmCss).toMatch(/\.atlas-crm\s+\.row-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
    expect(quickSaleSrc).not.toMatch(/<a[^>]*className="btn secondary"/);
    expect(overridesFinal).toMatch(/html\s+\.modal\s+button:[^}]*:not\(\.step-wizard__step-btn\)/);
    expect(appCss).toMatch(/\.modal\s+button:not\(\.secondary\):not\(\.app-toast-close\):not\(\.step-wizard__step-btn\)/);
    expect(darkForce).toMatch(/html\[data-theme\]\s+body\s+\.modal\s+button:[^}]*:not\(\.step-wizard__step-btn\)/);
    expect(darkForce).toMatch(/button\.step-wizard__step-btn\s*\{[^}]*background:\s*#f8fafc\s*!important;/s);
    expect(productsSrc).toMatch(/<SlidersHorizontal size=\{14\}[\s\S]*<span>Ajuster<\/span>/);
    expect(productsSrc).toMatch(/<Pencil size=\{14\}[\s\S]*<span>Modifier<\/span>/);
    expect(productsSrc).toMatch(/<Tags size=\{14\}[\s\S]*<span>Étiquette<\/span>/);
    expect(shellCss).toMatch(/button\.ac-dock-expand\s*\{[^}]*padding:\s*0\s+20px\s*!important;[^}]*overflow:\s*visible\s*!important;/s);
    expect(shellCss).toMatch(/\.ac-desktop-dock\.ac-topbar--compact:not\(:focus-within\)\s+\.ac-topbar-title\s*\{\s*max-width:\s*min\(72vw,\s*480px\)/);
    expect(shellCss).not.toMatch(/\.desktop-catalog-actions-slot\s+\.top-page-actions\s*>\s*button:hover:not\(:disabled\)[^}]*translateY\(-1px\)/);
    expect(shellCss).toMatch(/\.ac-desktop-top-row\s*>\s*\.desktop-catalog-actions-slot:not\(:empty\)\s*\{[^}]*width:\s*max-content;/s);
  });

  it('QuickSale removes Ouvrir button, keeps tappable VR number link, and paginates at 20 items per page', async () => {
    const tickets = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      number: `VR-2026-${String(i + 1).padStart(4, '0')}`,
      doc_kind: 'quick_sale',
      client_name: `Client ${i + 1}`,
      issue_date: '2026-10-20',
      status: 'sent',
      total: 100 + i,
      amount_paid: 0,
    }));
    vi.spyOn(api, 'getInvoices').mockResolvedValue({ data: tickets } as any);
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getClients').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(AppDialogsProvider, null, createElement(QuickSale))));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(host.querySelectorAll('table tbody tr')).toHaveLength(20);
    const rowActionText = Array.from(host.querySelectorAll('table tbody .row-actions')).map((el) => el.textContent || '').join(' ');
    expect(rowActionText).not.toContain('Ouvrir');
    const firstNumberLink = host.querySelector<HTMLAnchorElement>('table tbody tr a.ac-number-link');
    expect(firstNumberLink?.getAttribute('href')).toBe('/quick-sale/1');
    expect(firstNumberLink?.textContent).toBe('VR-2026-0001');

    const nextBtn = host.querySelector<HTMLButtonElement>('[aria-label="Page suivante"]')!;
    expect(nextBtn).toBeTruthy();
    await act(async () => { nextBtn.click(); });
    expect(host.querySelectorAll('table tbody tr')).toHaveLength(5);
    expect(host.querySelector('table tbody tr a.ac-number-link')?.textContent).toBe('VR-2026-0021');
  });

  it('Quotes removes Ouvrir button, keeps .quote-number-link, and paginates at 20 items per page', async () => {
    const quotes = Array.from({ length: 23 }, (_, i) => ({
      id: i + 1,
      number: `DV-2026-${String(i + 1).padStart(4, '0')}`,
      client_name: `Client ${i + 1}`,
      issue_date: '2026-10-20',
      status: 'quote',
      total: 500 + i,
    }));
    vi.spyOn(api, 'getInvoices').mockResolvedValue({ data: quotes } as any);
    vi.spyOn(api, 'getClients').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(AppDialogsProvider, null, createElement(Quotes))));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(host.querySelectorAll('table tbody tr')).toHaveLength(20);
    const rowActionText = Array.from(host.querySelectorAll('table tbody .row-actions')).map((el) => el.textContent || '').join(' ');
    expect(rowActionText).not.toContain('Ouvrir');
    expect(host.querySelector('.quote-number-link')?.textContent).toBe('DV-2026-0001');

    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Page suivante"]')!.click(); });
    expect(host.querySelectorAll('table tbody tr')).toHaveLength(3);
  });

  it('Products places result count in the search bar (not in the table card) and paginates at 20 per page while Balance stays at 50', async () => {
    const products = Array.from({ length: 24 }, (_, i) => ({
      id: i + 1,
      name: `Produit ${i + 1}`,
      sku: `SKU-${i + 1}`,
      price: 10 + i,
      cost: 5,
      stock_quantity: 10,
      low_stock_threshold: 2,
      track_inventory: 1,
    }));
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: products } as any);
    vi.spyOn(api, 'getStockLocations').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getCategories').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(AppDialogsProvider, null, createElement(Products))));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(host.querySelector('.ac-products-filters .ac-search-field .desktop-product-result-count')?.textContent).toBe('24 résultats');
    expect(host.querySelector('.ac-products-table-panel .desktop-product-result-count')).toBeNull();
    expect(host.querySelectorAll('table tbody tr')).toHaveLength(20);

    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Page suivante"]')!.click(); });
    expect(host.querySelectorAll('table tbody tr')).toHaveLength(4);

    // Balance keeps 50 items per page
    const expenses = Array.from({ length: 55 }, (_, i) => ({
      id: i + 1,
      type: 'income',
      amount: 100,
      description: `Tx ${i + 1}`,
      occurred_at: '2026-10-20',
    }));
    vi.spyOn(api, 'getExpenses').mockResolvedValue({ data: expenses } as any);
    vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: {} } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(AppDialogsProvider, null, createElement(Balance))));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelectorAll('.bal-tx-row')).toHaveLength(50);
  });

  it('WhatsNew and About display thanks-to and tag committers as contributors to releases', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(WhatsNew)));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const thanksCard = host.querySelector('.wn-thanks-card');
    expect(thanksCard?.textContent).toContain('Remerciements');
    expect(thanksCard?.textContent).toContain('@loxdpsy');
    expect(thanksCard?.textContent).toContain('@arena-agent');
    const firstRelease = host.querySelector('.wn-release');
    expect(firstRelease?.querySelector('.wn-release-contributors')?.textContent).toContain('Merci à');
    expect(firstRelease?.querySelector('.wn-release-contributors')?.textContent).toContain('@loxdpsy');

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(About)));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('Remerciements & contributeurs');
    expect(host.textContent).toContain('@loxdpsy');
    expect(host.textContent).toContain('@arena-agent');
  });
});
