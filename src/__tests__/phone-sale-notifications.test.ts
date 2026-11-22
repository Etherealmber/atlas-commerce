// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneVente, PhoneBoîte } from '../mobile/PhoneApp';
import { api } from '../api';

let host: HTMLDivElement; let root: Root;
const products = [{ id: 7, name: 'Marbre', unit_price: 12.5 }];
const click = async (text: string) => act(async () => { const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)); if (!button) throw new Error(`button not found: ${text}`); button.click(); });
const setField = async (label: string, value: string) => {
  const field = [...document.querySelectorAll('label')].find(l => l.textContent?.includes(label))!.querySelector('input, textarea')!;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
};
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; sessionStorage.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
const renderSale = async (props: any = {}) => act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneVente, { products, onDone: vi.fn(), onToast: vi.fn(), ...props }) })));
describe('Android-inspired sale', () => {
  it('edits the cart, confirms and sends the existing unpaid PC handoff with client details', async () => {
    const create = vi.spyOn(api, 'createMobileAction').mockResolvedValue({} as any); const onDone = vi.fn();
    await renderSale({ onDone }); expect(host.textContent).toContain('Panier vide');
    await click('Parcourir les produits'); await click('Marbre');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Augmenter Marbre"]')!.click());
    await setField('Nom du client', 'Client test'); await setField('Téléphone', '0600000000'); await setField('Note', 'Livraison');
    await click('Envoyer au PC'); expect(create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('aucun paiement');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent?.trim() === 'Envoyer')!.click());
    expect(create).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'invoice', source: 'mobile', meta: expect.objectContaining({ needs_approval: true, create_invoice_body: expect.objectContaining({ client_name: 'Client test', notes: expect.stringContaining('0600000000'), items: [expect.objectContaining({ quantity: 2, unit_price: 12.5 })] }) }) }));
    expect(onDone).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain('n’est pas encore payée'); expect(JSON.parse(sessionStorage.getItem('atlas-phone-cart')!)).toEqual({});
    await click('Nouveau panier'); expect((host.querySelector('input[type=tel]') as HTMLInputElement).value).toBe(''); expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(''); expect((host.querySelector('.ph-sale-fields input') as HTMLInputElement).value).toBe('Client de passage');
  });
  it('does not crash or submit a partial cart when products are missing', async () => {
    sessionStorage.setItem('atlas-phone-cart', JSON.stringify({ 7: 1, 88: 1 })); await renderSale();
    expect(host.textContent).toContain('produit(s) du panier ne sont pas');
    expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Envoyer au PC'))!.disabled).toBe(true);
    await click('Retirer #88'); expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Envoyer au PC'))!.disabled).toBe(false);
  });
  it('prevents duplicate handoffs and does not report an already-sent sale as failed if refresh fails', async () => {
    sessionStorage.setItem('atlas-phone-cart', JSON.stringify({ 7: 1 }));
    let finish!: (value: any) => void;
    const create = vi.spyOn(api, 'createMobileAction').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onToast = vi.fn(); await renderSale({ onDone: vi.fn().mockRejectedValue(new Error('refresh')), onToast });
    await click('Envoyer au PC');
    const submit = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent?.trim() === 'Envoyer')!;
    await act(async () => { submit.click(); submit.click(); }); expect(create).toHaveBeenCalledOnce();
    await act(async () => finish({}));
    expect(document.body.textContent).toContain('Demande envoyée'); expect(onToast).toHaveBeenCalledWith(expect.stringContaining('actualisation du catalogue impossible'));
    expect(JSON.parse(sessionStorage.getItem('atlas-phone-cart')!)).toEqual({});
  });
  it('blocks an entry with no recorded unit price', async () => {
    sessionStorage.setItem('atlas-phone-cart', JSON.stringify({ 7: 1 })); await renderSale({ products: [{ id: 7, name: 'Marbre' }] });
    expect(host.textContent).toContain('Prix indisponible');
    expect([...host.querySelectorAll('button')].find(b => b.textContent?.includes('Envoyer au PC'))!.disabled).toBe(true);
  });
  it('finds products by barcode and resets a closed search', async () => {
    await renderSale({ products: [{ id: 7, name: 'Marbre', barcode: '123456789', unit_price: 12.5 }, { id: 8, name: 'Granit', unit_price: 15 }] });
    await click('Parcourir les produits'); await setField('Rechercher un produit', '123456789');
    expect(document.querySelector('[role=dialog]')!.textContent).toContain('Marbre'); expect(document.querySelector('[role=dialog]')!.textContent).not.toContain('Granit');
    await click('Fermer'); await click('Parcourir les produits'); expect(document.querySelector('[role=dialog]')!.textContent).toContain('Granit');
  });
  it('explains that large search results are truncated', async () => {
    await renderSale({ products: Array.from({ length: 41 }, (_, i) => ({ id: i + 1, name: `Article ${i + 1}`, unit_price: 1 })) });
    await click('Parcourir les produits'); expect(document.querySelector('[role=dialog]')!.textContent).toContain('40 premiers résultats');
  });
  it('preserves the cart and shows an error when the server rejects the handoff', async () => {
    sessionStorage.setItem('atlas-phone-cart', JSON.stringify({ 7: 1 })); vi.spyOn(api, 'createMobileAction').mockRejectedValue(new Error('Hors ligne'));
    await renderSale(); await click('Envoyer au PC'); await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent?.trim() === 'Envoyer')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Hors ligne'); expect(JSON.parse(sessionStorage.getItem('atlas-phone-cart')!)).toEqual({ 7: 1 });
  });
});
describe('Android-inspired notifications', () => {
  it('shows alerts and status filters without inventing action counts', async () => {
    vi.spyOn(api, 'getAlerts').mockResolvedValue({ data: [{ kind: 'stock_low', label: 'Stock faible', href: '/products', count: 3 }] });
    const actions = [{ id: 1, type: 'scan', title: 'Premier', detail: 'Stock', status: 'pending', created_at: '2026-10-01' }, { id: 2, type: 'new_product', title: 'Deuxième', detail: '', status: 'done', created_at: '2026-10-01' }];
    await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneBoîte, { actions, onRefresh: vi.fn() }) })));
    expect(host.textContent).toContain('Stock faible'); expect(host.textContent).toContain('Toutes (2)'); expect(host.textContent).toContain('Deuxième');
    await click('En attente (1)'); expect(host.textContent).toContain('Premier'); expect(host.textContent).not.toContain('Deuxième');
  });
  it('shows native-style urgency and target badges without trusting malformed metadata', async () => {
    vi.spyOn(api, 'getAlerts').mockResolvedValue({ data: [] });
    const actions = [{ id: 1, type: 'scan', title: 'Alerte', detail: 'Ligne 1\nLigne 2', status: 'pending', created_at: '', meta_json: JSON.stringify({ priority: 'urgent', target_role: 'stock' }) }, { id: 2, type: 'scan', title: 'Ancienne', detail: '', status: 'done', created_at: '', meta_json: '{invalid' }, { id: 3, type: 'scan', title: 'Non reconnu', detail: '', status: 'pending', created_at: '', meta_json: JSON.stringify({ target_role: '__proto__' }) }];
    await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneBoîte, { actions, onRefresh: vi.fn() }) })));
    expect(host.textContent).toContain('Urgent'); expect(host.textContent).toContain('Magasiniers & stock'); expect(host.textContent).toContain('Ancienne'); expect(host.textContent).toContain('Non reconnu');
  });
  it('ignores older alert refresh responses', async () => {
    let finish!: (value: any) => void;
    vi.spyOn(api, 'getAlerts').mockResolvedValueOnce({ data: [] }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: [{ kind: 'new', label: 'Dernière alerte' }] });
    await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneBoîte, { actions: [], onRefresh: vi.fn() }) })));
    const refresh = host.querySelector<HTMLButtonElement>('[aria-label="Actualiser les notifications"]')!;
    await act(async () => refresh.click()); await act(async () => refresh.click());
    await act(async () => finish({ data: [{ kind: 'old', label: 'Ancienne alerte' }] }));
    expect(host.textContent).toContain('Dernière alerte'); expect(host.textContent).not.toContain('Ancienne alerte');
  });
  it('reports failures rather than showing an empty feed', async () => {
    vi.spyOn(api, 'getAlerts').mockRejectedValue(new Error('offline'));
    await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneBoîte, { actions: [], actionsReady: false, actionsError: true, onRefresh: vi.fn() }) })));
    expect(host.textContent).toContain('Impossible de charger les alertes'); expect(host.textContent).toContain('Impossible de charger les demandes'); expect(host.textContent).not.toContain('Votre flux est à jour');
  });
});
