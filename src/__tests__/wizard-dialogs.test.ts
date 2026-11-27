// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Clients from '../pages/Clients';
import Vendors from '../pages/Vendors';
import Receipts from '../pages/Receipts';
import Balance from '../pages/Balance';
import Products from '../pages/Products';
import Invoices from '../pages/Invoices';
import Bills from '../pages/Bills';
import { api } from '../api';

vi.mock('../lib/reports', () => ({ openReport: vi.fn(), openPrintDoc: vi.fn() }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  vi.spyOn(api, 'getClients').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getVendors').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getBills').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getReceipts').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getInvoices').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getExpenses').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getDashboard').mockResolvedValue({ data: {} } as any);
  vi.spyOn(api, 'getLedgerReconcile').mockResolvedValue({ data: null } as any);
  vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getCategories').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getStockLocations').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getSettings').mockResolvedValue({ data: { tax_rate: 20 } } as any);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const dlg = () => document.querySelector<HTMLElement>('.step-wizard')!;
const renderPage = async (el: React.ReactElement) => {
  await act(async () => root.render(createElement(MemoryRouter, null, el)));
  await act(async () => { await Promise.resolve(); });
};
const clickText = async (scope: HTMLElement | Document, text: string) => {
  const btn = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.includes(text) || b.getAttribute('title')?.includes(text),
  );
  expect(btn, `Button containing "${text}"`).toBeTruthy();
  await act(async () => btn!.click());
};

function assertUnifiedStepShell(expectedTotalSteps: number) {
  const d = dlg();
  expect(d).toBeTruthy();
  expect(d.querySelector('.step-wizard__header')).toBeTruthy();
  expect(d.querySelector('.step-wizard__progress')).toBeTruthy();
  expect(d.querySelector('.step-wizard__intro')).toBeTruthy();
  expect(d.querySelector('.wz-progress')).toBeTruthy();
  expect(d.querySelector('.step-wizard__count')?.textContent?.trim()).toBe(`1 / ${expectedTotalSteps}`);
}

it('Client wizard matches employee look and blocks advancing when name is empty', async () => {
  await renderPage(createElement(Clients));
  await clickText(host, 'Ajouter un client');
  assertUnifiedStepShell(3);
  await clickText(dlg(), 'Continuer');
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('1 / 3');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('nom du client');
});

it('Vendor wizard matches employee look and blocks advancing when name is empty', async () => {
  await renderPage(createElement(Vendors));
  await clickText(host, 'Nouveau fournisseur');
  assertUnifiedStepShell(2);
  await clickText(dlg(), 'Continuer');
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('1 / 2');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('nom du fournisseur');
});

it('Receipt wizard matches employee look and blocks advancing when required fields are empty', async () => {
  await renderPage(createElement(Receipts));
  await clickText(host, 'Nouveau reçu');
  assertUnifiedStepShell(2);
  await clickText(dlg(), 'Continuer');
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('1 / 2');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('client');
});

it('Balance wizard matches employee look and blocks advancing when description is empty', async () => {
  await renderPage(createElement(Balance));
  await clickText(host, 'Dépense');
  assertUnifiedStepShell(2);
  await clickText(dlg(), 'Continuer');
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('1 / 2');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('libellé');
});

it('Product wizard matches employee look and blocks advancing when name is empty', async () => {
  await renderPage(createElement(Products));
  await clickText(host, 'Ajouter un produit');
  assertUnifiedStepShell(5);
  await clickText(dlg(), 'Continuer');
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('1 / 5');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('nom du produit');
});

it('shows variant validation and API failures inside the product wizard', async () => {
  vi.mocked(api.getProducts).mockResolvedValue({ data: [{ id: 42, name: 'Marbre', price: 10, category: 'Général', unit: 'unité' }] } as any);
  vi.spyOn(api, 'getVariants').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'createVariant').mockRejectedValueOnce(new Error('SKU déjà utilisé'));
  await renderPage(createElement(Products));
  await clickText(host, 'Modifier Marbre');
  for (let i = 0; i < 4; i++) await clickText(dlg(), 'Continuer');
  await clickText(dlg(), 'Ajouter la variante');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('Libellé de variante obligatoire');
  const input = dlg().querySelector<HTMLInputElement>('input[placeholder="ex. M / Rouge"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Rouge'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(dlg().querySelector('[role="alert"]')).toBeNull();
  await clickText(dlg(), 'Ajouter la variante');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('SKU déjà utilisé');
});

it('Invoice wizard matches employee look and blocks advancing when client name is empty', async () => {
  await renderPage(createElement(Invoices));
  await clickText(host, 'Créer une facture');
  // Client details are split over short steps so no step needs scrolling.
  assertUnifiedStepShell(5);
  await clickText(dlg(), 'Continuer');
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('1 / 5');
  expect(dlg().querySelector('[role="alert"]')?.textContent).toContain('client');
});

it('Bill wizard blocks skipping steps via top step pills when required fields are empty and renders OCR failure inside the dialog', async () => {
  vi.spyOn(api, 'parseBillDocument').mockRejectedValueOnce(
    Object.assign(new Error('Échec de la lecture OCR (modèle indisponible).'), {
      body: {
        failing_step: 'analyse_vision',
        steps: [
          { id: 'validation_fichier', label: 'Validation du fichier', status: 'ok' },
          { id: 'moteur_ocr', label: 'Moteur OCR (Qwen)', status: 'ok' },
          { id: 'analyse_vision', label: 'Analyse visuelle Qwen', status: 'error', detail: 'Timeout' },
        ],
      },
    }),
  );

  await renderPage(createElement(Bills));
  await clickText(host, "Nouvelle facture d'achat");
  assertUnifiedStepShell(5);

  // Step 1 is the optional scan. An OCR failure shows the failing process inside the dialog.
  const fileInput = dlg().querySelector<HTMLInputElement>('input[type="file"]');
  expect(fileInput).toBeTruthy();
  const fakeFile = new File(['abc'], 'facture.png', { type: 'image/png' });
  await act(async () => {
    Object.defineProperty(fileInput!, 'files', { value: [fakeFile], configurable: true });
    fileInput!.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
  });
  const ocrPanel = dlg().querySelector('.wz-ocr-panel.is-error');
  expect(ocrPanel).toBeTruthy();
  expect(ocrPanel?.textContent).toContain('Analyse visuelle Qwen');
  expect(ocrPanel?.textContent).toContain('Échec de la lecture OCR');

  // The scan step can be skipped, but the vendor step blocks skipping ahead.
  const topPills = () => Array.from(dlg().querySelectorAll<HTMLButtonElement>('.step-wizard__step-btn'));
  expect(topPills()).toHaveLength(5);
  await act(async () => { topPills()[1].click(); });
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('2 / 5');
  await act(async () => { topPills()[2].click(); });
  expect(dlg().querySelector('.step-wizard__count')?.textContent?.trim()).toBe('2 / 5');
  const alerts = Array.from(dlg().querySelectorAll('[role="alert"]')).map((n) => n.textContent || '').join(' | ');
  expect(alerts).toContain('fournisseur');
});
