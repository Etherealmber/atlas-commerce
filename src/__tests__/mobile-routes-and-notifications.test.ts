// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhoneApp from '../mobile/PhoneApp';
import PhoneHome from '../mobile/PhoneHome';
import Actions from '../pages/Actions';
import { AppDialogsProvider } from '../components/AppDialogs';
import { api } from '../api';

vi.mock('../components/PageTransition', () => ({ default: ({ children }: { children: unknown }) => children }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('atlas_phone_animations', 'off');
  localStorage.setItem('stock_role', 'owner');
  localStorage.setItem('stock_auth_user', 'admin');
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

describe('Mobile route restrictions, unified dark palette, and notifications polish', () => {
  it.each([
    '/more',
    '/warehouse',
    '/bills',
    '/invoice',
    '/balance/classic',
    '/anything-else',
  ])('restricts non-bar mobile route %s to the unavailable page', async (route) => {
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'listMobileActions').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [route] },
          createElement(PhoneApp),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('.ph-restricted')?.textContent).toContain('Page non disponible sur mobile');
  });

  it('exposes /clients on mobile web for authorized roles and uses .ph-catalog-search on directory views', async () => {
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'listMobileActions').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getClients').mockResolvedValue({ data: [{ id: 1, name: 'Client Atlas', phone: '0600000000', credit_limit: 5000, unpaid_total: 0 }] } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/clients'] },
          createElement(PhoneApp),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('.ph-restricted')).toBeNull();
    expect(host.querySelector('.ph-catalog-search')).toBeTruthy();
    expect(host.textContent).toContain('Client Atlas');
  });

  it('removes the /m/more shortcut from PhoneHome', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: { productCount: 3, lowStockCount: 0 } } as any);
    vi.spyOn(api, 'getFinanceMonthly').mockResolvedValue({ data: { period: '2026-10', currency: 'MAD' } } as any);

    await act(async () => {
      root.render(
        createElement(MemoryRouter, { initialEntries: ['/m'] }, createElement(PhoneHome)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain('Ouvrir les outils');
    expect(host.textContent).not.toContain('Outils terrain');
  });

  it('renders semantic .ac-action-ico tiles in Actions.tsx without var(--zellij-soft)', async () => {
    vi.spyOn(api, 'listMobileActions').mockResolvedValue({
      data: [
        { id: 1, type: 'new_product', title: 'Nouveau marbre', detail: 'Demande mobile', status: 'pending', created_at: '2026-10-20T10:00:00Z' },
        { id: 2, type: 'stock_check', title: 'Inventaire', detail: 'Écart +2', status: 'pending', created_at: '2026-10-20T10:05:00Z' },
      ],
    } as any);
    vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(AppDialogsProvider, null, createElement(Actions)),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('.ac-action-ico.is-product')).toBeTruthy();
    expect(host.querySelector('.ac-action-ico.is-stock')).toBeTruthy();
    const actionsSrc = readFileSync(path.resolve(process.cwd(), 'src/pages/Actions.tsx'), 'utf8');
    expect(actionsSrc).not.toContain('var(--zellij-soft)');
  });

  it('unifies dark-mode surfaces onto neutral obsidian/zinc without legacy blue-slate hexes', () => {
    for (const rel of ['src/styles/dark-force.css', 'src/styles/overrides-final.css', 'src/main.tsx']) {
      const css = readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      expect(css).not.toMatch(/#(?:0b0c10|121317|13151d|15171c|181a20|1a1c23|1d2027|21242c|282c36)\b/i);
    }
    const phoneCss = readFileSync(path.resolve(process.cwd(), 'src/mobile/phone.css'), 'utf8');
    expect(phoneCss).not.toMatch(/#(?:172642|263d68|345b9a|374151|805038|754a32|694331)\b/i);
  });
});
