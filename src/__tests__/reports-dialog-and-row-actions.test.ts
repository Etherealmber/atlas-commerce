// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Balance from '../pages/Balance';
import QuickSale from '../pages/QuickSale';
import { AppDialogsProvider } from '../components/AppDialogs';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
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

describe('Balance reports dialog & QuickSale modern row actions', () => {
  it('opens Rapports PDF dialog on trigger click instead of rendering an inline report bar', async () => {
    vi.spyOn(api, 'getExpenses').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: { balance: {} } } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(AppDialogsProvider, null, createElement(Balance)),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No inline report dialog before clicking trigger
    expect(document.body.querySelector('.bal-reports-modal')).toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>('.bal-reports-trigger');
    expect(trigger).toBeTruthy();
    expect(trigger?.classList.contains('secondary')).toBe(true);

    await act(async () => {
      trigger!.click();
    });

    const dialog = document.body.querySelector<HTMLElement>('.bal-reports-modal');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    const txt = dialog?.textContent || '';
    for (const label of [
      'Solde & mouvements',
      'Stock',
      'Créances',
      'Dettes',
      'Employés & paie',
      'Tous les rapports',
      'Situation client',
      'Excel CSV',
      'Paiements CSV',
    ]) {
      expect(txt).toContain(label);
    }

    const closeBtn = dialog!.querySelector<HTMLButtonElement>('button[aria-label="Fermer"]');
    expect(closeBtn).toBeTruthy();
    await act(async () => {
      closeBtn!.click();
    });
    expect(document.body.querySelector('.bal-reports-modal')).toBeNull();
  });

  it('uses secondary Tout payer and TimedUndoDelete in QuickSale rows instead of black buttons', async () => {
    vi.spyOn(api, 'getInvoices').mockResolvedValue({
      data: [
        {
          id: 42,
          number: 'VR-2026-0042',
          doc_kind: 'quick_sale',
          client_name: 'Client Test',
          issue_date: '2026-10-20',
          status: 'sent',
          total: 1200,
          amount_paid: 0,
        },
      ],
    } as any);
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getClients').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(AppDialogsProvider, null, createElement(QuickSale)),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const buttons = Array.from(host.querySelectorAll('table tbody button'));
    const toutPayer = buttons.find((b) => b.textContent?.includes('Tout payer'));
    expect(toutPayer).toBeTruthy();
    expect(toutPayer!.classList.contains('secondary')).toBe(true);
    expect(toutPayer!.classList.contains('success')).toBe(false);

    const legacySuppr = buttons.find((b) => b.textContent?.trim() === 'Suppr.');
    expect(legacySuppr).toBeUndefined();

    const timedDelete = host.querySelector('table tbody [data-atlas-delete="1"]');
    expect(timedDelete).toBeTruthy();
  });
});
