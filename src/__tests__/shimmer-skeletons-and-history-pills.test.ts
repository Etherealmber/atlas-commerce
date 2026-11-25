// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductHistory from '../pages/ProductHistory';
import { AtlasAgentShimmerBody } from '../components/PageSkeleton';
import PageSkeleton from '../components/PageSkeleton';
import { api } from '../api';

vi.mock('../auth', () => ({ canSell: () => true, getToken: () => 'token', clearToken: vi.fn() }));

const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function renderHistory() {
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/products/7/historique'] },
        createElement(Routes, null, createElement(Route, { path: '/products/:id/historique', element: createElement(ProductHistory) })),
      ),
    ),
  );
}

describe('product history header actions use the Products row pills', () => {
  const css = stripComments(read('src/pages/product-history.css'));

  it('drops the amber / blue pills for the neutral 32px row-pill tokens', () => {
    expect(css).not.toMatch(/#fef3c7|#dbeafe|#451a03|#1e3a5f/i);
    expect(css).toContain('--ph-pill-bg: #f4f4f5;');
    expect(css).toContain('--ph-pill-bg: #26262b;');
    const rule = css.slice(css.indexOf('.product-history-actions button.secondary:not(#ph-a):not(#ph-b):not(#ph-c) {'));
    expect(rule).toMatch(/height: 32px !important/);
    expect(rule).toMatch(/font-size: 12\.5px !important/);
    expect(rule).toMatch(/border-radius: 999px !important/);
    expect(css).toMatch(/data-ui-density="compact"\][^{]*product-history-actions[^{]*\{\s*height: 28px !important/);
  });
});

describe('product history shimmer', () => {
  it('mirrors the product card and movement rows while loading', async () => {
    vi.spyOn(api, 'getProduct').mockReturnValue(new Promise(() => {}) as any);
    vi.spyOn(api, 'getProductMovements').mockReturnValue(new Promise(() => {}) as any);
    await renderHistory();
    const hero = host.querySelector('.ph-sk[aria-label="Chargement du produit"]');
    expect(hero).not.toBeNull();
    expect(hero!.querySelector('.ph-sk-photo.skeleton')).not.toBeNull();
    expect(hero!.querySelectorAll('.ph-sk-actions .ph-sk-pill').length).toBe(3);
    const rows = host.querySelectorAll('.ph-sk-movements .ph-sk-movement');
    expect(rows.length).toBe(4);
    rows.forEach((row) => expect(row.classList.contains('product-history-movement')).toBe(true));
    // no generic form skeleton any more
    expect(host.querySelector('.page-skeleton')).toBeNull();
  });

  it('keeps rows visible (dimmed) on refresh instead of stacking skeleton bars on top', async () => {
    vi.spyOn(api, 'getProduct').mockResolvedValue({ data: { id: 7, name: 'Marbre', track_inventory: 1, price: 50 } });
    const movements = vi.spyOn(api, 'getProductMovements').mockResolvedValueOnce({ data: [{ id: 1, type: 'in', quantity: 3, previous_quantity: 5, new_quantity: 8 }] });
    await renderHistory();
    expect(host.querySelector('.product-history-movement')).not.toBeNull();
    movements.mockReturnValueOnce(new Promise(() => {}) as any);
    await act(async () => (host.querySelector('[aria-label="Actualiser l’historique"]') as HTMLButtonElement).click());
    expect(host.querySelector('.product-history-movements.is-refreshing')).not.toBeNull();
    expect(host.querySelector('.ph-sk-movements')).toBeNull();
    expect(host.querySelectorAll('.product-history-movement').length).toBe(1);
  });
});

describe('Atlas Agent shimmer', () => {
  const src = read('src/components/AtlasAgent.tsx');

  it('drives the conversation shimmer from real R2 hydration (not a constant)', () => {
    expect(src).not.toContain('const [loadingThread] = useState(false);');
    expect(src).toContain('const [loadingThread, setLoadingThread] = useState(false);');
    expect(src).toMatch(/setLoadingThread\(true\); \}, 160\)/);
    expect(src).toContain("loadingThread && !msgs.some((m) => m.role === 'user') && <AtlasAgentShimmerBody rows={2} />");
  });

  it('resumes the per-user active thread (scoped key is the one written)', () => {
    expect(src).toContain('localStorage.getItem(activeThreadKey()) || localStorage.getItem(ACTIVE_THREAD_KEY) || newThreadId()');
  });

  it('renders neutral, fixed-width placeholder bubbles that never overflow', async () => {
    await act(async () => root.render(createElement(AtlasAgentShimmerBody, { rows: 2 })));
    const users = host.querySelectorAll<HTMLElement>('.atlas-agent-shimmer-bubble--user');
    expect(users.length).toBe(2);
    users.forEach((b) => {
      expect(b.style.width).toMatch(/px$/);
      expect((b.querySelector('.skeleton') as HTMLElement).style.width).toBe('100%');
    });
    const css = stripComments(read('src/styles/focus-sidebar.css'));
    expect(css).toMatch(/\.atlas-agent-bubble\.atlas-agent-shimmer-bubble:not\(#shim-x\):not\(#shim-y\):not\(#shim-z\) \{[^}]*background: #f4f4f5 !important/);
  });
});

describe('page skeletons match their final layout', () => {
  it('settings skeleton is KPIs + stacked setting rows (no table, no loading-only title)', async () => {
    await act(async () => root.render(createElement(PageSkeleton, { variant: 'settings' })));
    expect(host.querySelectorAll('.page-skeleton-kpis > .ac-skeleton-bento-card').length).toBe(4);
    expect(host.querySelectorAll('.ac-skeleton-settings-row').length).toBe(4);
    expect(host.querySelector('.ac-skeleton-table-wrap')).toBeNull();
    const settings = read('src/pages/Settings.tsx');
    const loadingBlock = settings.slice(settings.indexOf('if (loading) return ('), settings.indexOf('<PageSkeleton variant="settings" />'));
    expect(loadingBlock).not.toContain('Espace de travail');
  });

  it('About: skeleton pills never mix with listed contributors and the avatar fallback is neutral', () => {
    const about = read('src/pages/About.tsx');
    expect(about).toContain('{contribLoading && contributors.length === 0 && (');
    expect(about).toContain('about-owner-avatar-ph" aria-hidden="true">{APP_CREATOR_NAME.slice(0, 1).toUpperCase()}');
    const app = stripComments(read('src/App.css'));
    expect(app).not.toContain('.about-owner-avatar-ph { background: #ebe6dc; }');
    expect(app).toMatch(/html\[data-theme="dark"\] \.about-owner-avatar-ph \{[^}]*background: #26262b/);
  });
});
