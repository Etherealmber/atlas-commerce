// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Settings from '../pages/Settings';
import Dashboard from '../pages/Dashboard';
import { api } from '../api';

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); localStorage.setItem('stock_role', 'owner');
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: {} })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('opens the R2 archive without fetching either legacy D1 journal or waiting for company settings', async () => {
  const settings = vi.spyOn(api, 'getSettings').mockImplementation(() => new Promise(() => {}));
  vi.spyOn(api, 'getMe').mockResolvedValue({ data: { is_owner: true, role: 'owner' } } as any);
  vi.spyOn(api, 'getJournalMode').mockResolvedValue({ data: { mode: 'r2' } });
  const audit = vi.spyOn(api, 'getAuditLog'); const legacyApi = vi.spyOn(api, 'getApiLog');
  const archive = vi.spyOn(api, 'listJournalArchive').mockResolvedValue({ data: [], meta: { mode: 'buffered', next_cursor: null } });
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/settings?tab=audit'] }, createElement(Settings))));
  expect(host.textContent).toContain('Journal des appels API et audit');
  expect(archive).toHaveBeenCalledOnce(); expect(settings).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled(); expect(legacyApi).not.toHaveBeenCalled();
});

it('renders the dashboard before its secondary product and action requests finish', async () => {
  vi.spyOn(api, 'getSettings').mockResolvedValue({ data: { attendance_enabled: 0 } } as any);
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: { productCount: 7, lowStockCount: 0, monthlySeries: [] } } as any);
  vi.spyOn(api, 'getProducts').mockImplementation(() => new Promise(() => {}));
  vi.spyOn(api, 'listMobileActions').mockImplementation(() => new Promise(() => {}));
  vi.spyOn(api, 'getMobileActionStats').mockImplementation(() => new Promise(() => {}));
  vi.spyOn(api, 'assistNextActions').mockResolvedValue({ data: { items: [] } } as any);
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(Dashboard))));
  expect(host.querySelector('[aria-label="Chargement du tableau de bord"]')).toBeNull();
  expect(host.querySelector('.ac-dash-page')).not.toBeNull();
  expect(host.textContent).not.toContain('Tout est à jour');
  expect(host.textContent).not.toContain('Stock OK');
  expect(api.getProducts).toHaveBeenCalledOnce();
});
