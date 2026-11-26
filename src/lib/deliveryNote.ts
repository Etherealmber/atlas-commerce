/**
 * Bon de livraison (BL): creates the BL for an invoice or a quick-sale ticket
 * (or re-opens the existing one — one BL per document) and opens the A4
 * printable page, where « Imprimer / Enregistrer en PDF » produces the PDF.
 *
 * The tab is opened synchronously on the click, then pointed at the BL once
 * the API answers, so popup blockers (Safari / iOS) don't swallow it.
 */
import { api, BASE } from '../api';
import { getToken } from '../auth';

export function deliveryNotePrintUrl(id: number | string): string {
  return `${BASE}/api/delivery-notes/${id}/print?token=${encodeURIComponent(getToken() || '')}`;
}

/** Reopen a previously created note without issuing a create request. */
export function openExistingDeliveryNote(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Bon de livraison invalide.');
  const tab = window.open(deliveryNotePrintUrl(id), '_blank');
  if (!tab) throw new Error('Autorisez les fenêtres contextuelles pour ouvrir le bon de livraison, puis réessayez.');
  try { tab.opener = null; } catch { /* ignore */ }
}

/** Opens an empty tab right now (inside the click) for a BL created later. */
export function reserveDeliveryNoteTab(): Window | null {
  try { return window.open('', '_blank'); } catch { return null; }
}

export async function openDeliveryNote(invoiceId: number, reserved?: Window | null): Promise<{ number: string; existing: boolean; message: string }> {
  const tab: Window | null = reserved === undefined ? reserveDeliveryNoteTab() : reserved;
  try {
    if (tab) {
      tab.document.title = 'Bon de livraison…';
      tab.document.body.style.font = '14px system-ui, sans-serif';
      tab.document.body.textContent = 'Préparation du bon de livraison…';
    }
  } catch { /* cross-origin about:blank on some browsers */ }
  try {
    const r: any = await api.createDeliveryNote({ invoice_id: invoiceId });
    const dn = r?.data || {};
    if (!dn.id) throw new Error('Bon de livraison créé sans identifiant. Réessayez depuis la facture.');
    const url = deliveryNotePrintUrl(dn.id);
    if (tab && !tab.closed) {
      try { tab.opener = null; } catch { /* ignore */ }
      tab.location.href = url;
    } else {
      const opened = window.open(url, '_blank');
      if (!opened) throw new Error('Autorisez les fenêtres contextuelles pour ouvrir le bon de livraison, puis réessayez.');
      try { opened.opener = null; } catch { /* ignore */ }
    }
    return { number: String(dn.number || ''), existing: Boolean(r?.existing), message: String(r?.message || `Bon de livraison ${dn.number || ''} prêt.`) };
  } catch (e) {
    try { tab?.close(); } catch { /* ignore */ }
    throw e;
  }
}
