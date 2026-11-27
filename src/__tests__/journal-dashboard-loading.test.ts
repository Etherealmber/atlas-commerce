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
  const archive = vi.spyOn(api, 'listJournalArchiveEntries').mockResolvedValue({ data: [{ key: 'audit-1', row: { action: 'product.create', entity: 'products', entity_id: '42', detail: 'Marbre ajouté', username: 'alice' }, unreadable: false }], meta: { mode: 'buffered', next_cursor: null } });
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/settings?tab=audit'] }, createElement(Settings))));
  expect(host.textContent).toContain('Journal des appels API et audit');
  expect(host.querySelector('.ac-journal-archive')?.tagName).toBe('DIV');
  expect(archive).toHaveBeenCalledOnce(); expect(archive).toHaveBeenCalledWith(expect.any(String), undefined, 'audit'); expect(settings).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Entrées audit R2"]')?.textContent).toContain('products #42');
  expect(host.textContent).toContain('Marbre ajouté');
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

it('displays searchable R2 entry summaries and opens their real details', async () => {
  const archive = vi.spyOn(api, 'listJournalArchiveEntries').mockResolvedValue({ data: [
    { key: 'one', row: { created_at: '2026-10-20T12:00:00Z', method: 'GET', path: '/api/products', status: 200, ms: 14, username: 'alice' }, unreadable: false },
    { key: 'bad', row: null, unreadable: true },
  ], meta: { mode: 'buffered', next_cursor: null } });
  const ApiLogPanel = (await import('../components/audit/ApiLogPanel')).default;
  await act(async () => root.render(createElement(ApiLogPanel, { range: '24h', forceR2: true })));
  expect(archive).toHaveBeenCalledOnce();
  const kind = host.querySelector('[aria-label="Journal"]') as any;
  await act(async () => { kind.value = 'api'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('ne peuvent pas être déchiffrées');
  const select = host.querySelector('[aria-label="Entrée archivée"]') as any;
  expect(select.textContent).toContain('/api/products');
  await act(async () => { select.value = 'one'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Voir les détails')!;
  await act(async () => button.click());
  expect(document.body.textContent).toContain('GET /api/products');
  expect(document.body.textContent).toContain('200');
});

it('shows API and audit rows directly from R2, with search and pending transfer status', async () => {
  vi.spyOn(api, 'getJournalBufferStatus').mockResolvedValue({ data: { pending_at_least: 2, has_more: false, alarm_scheduled: true } });
  const archive = vi.spyOn(api, 'listJournalArchiveEntries').mockImplementation(async (_day, _cursor, kind) => ({ data: kind === 'audit' ? [
    { key: 'audit-1', row: { created_at: '2026-10-20T12:00:00Z', action: 'product.create', entity: 'products', entity_id: '42', detail: 'Marbre ajouté', username: 'alice', ip: '203.0.113.1' }, unreadable: false },
  ] : [
    { key: 'api-1', row: { created_at: '2026-10-20T12:00:00Z', method: 'POST', path: '/api/products', status: 201, username: 'alice', ms: 7 }, unreadable: false },
  ], meta: { mode: 'buffered', next_cursor: null } }));
  const legacyAudit = vi.spyOn(api, 'getAuditLog'); const legacyApi = vi.spyOn(api, 'getApiLog');
  const ApiLogPanel = (await import('../components/audit/ApiLogPanel')).default;
  await act(async () => root.render(createElement(ApiLogPanel, { range: '24h', forceR2: true })));
  expect(archive).toHaveBeenLastCalledWith(expect.any(String), undefined, 'audit');
  const table = host.querySelector('[aria-label="Entrées audit R2"]');
  expect(table?.textContent).toContain('product.create');
  expect(table?.textContent).toContain('products #42');
  expect(table?.textContent).toContain('Marbre ajouté');
  expect(host.textContent).toContain('2 entrée(s) en attente');
  const kind = host.querySelector('[aria-label="Journal"]') as any;
  const search = host.querySelector('input[type="search"]') as any;
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(search, '203.0.113.1'); search.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.textContent).toContain('product.create');
  const details = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Détails')!;
  await act(async () => details.click());
  expect(document.body.querySelector('[aria-label="Détails de l’événement audit"]')?.textContent).toContain('product.create');
  await act(async () => { kind.value = 'api'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('[aria-label="Entrées API R2"]')?.textContent).toContain('POST /api/products');
  expect(legacyAudit).not.toHaveBeenCalled(); expect(legacyApi).not.toHaveBeenCalled();
});

it('builds R2 charts from loaded entries only and refreshes without losing later pages', async () => {
  vi.useFakeTimers();
  try {
    const first = { key: 'a', row: { created_at: '2026-10-20T10:00:00Z', action: 'product.create', entity: 'products', entity_id: '42', username: 'alice' }, unreadable: false };
    const second = { key: 'b', row: { created_at: '2026-10-20T11:00:00Z', action: 'product.update', entity: 'products', entity_id: '43', username: 'bob' }, unreadable: false };
    vi.spyOn(api, 'getJournalBufferStatus').mockResolvedValue({ data: { pending_at_least: 0, has_more: false, alarm_scheduled: false } });
    const archive = vi.spyOn(api, 'listJournalArchiveEntries').mockImplementation(async (_day, cursor) => ({ data: cursor ? [second] : [first], meta: { mode: 'buffered', next_cursor: cursor ? null : 'page-2' } }));
    const legacyAudit = vi.spyOn(api, 'getAuditLog'); const legacyApi = vi.spyOn(api, 'getApiLog');
    const ApiLogPanel = (await import('../components/audit/ApiLogPanel')).default;
    await act(async () => root.render(createElement(ApiLogPanel, { range: '24h', forceR2: true })));
    expect(host.textContent).toContain('données partielles');
    expect(host.querySelector('[aria-label="Types d’action"]')?.textContent).toContain('product.create');
    expect(host.querySelector('[aria-label="Activité dans le temps"]')?.textContent).toContain('10h');
    const more = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Afficher plus')!;
    await act(async () => more.click());
    expect(host.querySelector('[aria-label="Entrées audit R2"]')?.textContent).toContain('products #43');
    expect(host.querySelector('[aria-label="Types d’action"]')?.textContent).toContain('product.update');
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(archive).toHaveBeenCalledTimes(3);
    expect(host.querySelector('[aria-label="Entrées audit R2"]')?.textContent).toContain('products #43');
    expect(host.querySelectorAll('[aria-label="Entrées audit R2"] tbody tr')).toHaveLength(2);
    expect(host.textContent).toContain('peut dépasser 2 minutes');
    expect(legacyAudit).not.toHaveBeenCalled(); expect(legacyApi).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
