/**
 * Local “AI helpers” for Atlas Commerce — no external API keys required.
 * Heuristics + French templates suitable for a small marble / stock shop.
 */
import { remainingBalance } from '../../shared/financeCore';



function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}


/** 2. Draft supplier reorder message (French) */
export function draftReorderMessage(
  items: { name?: string; sku?: string; stock_quantity?: number; low_stock_threshold?: number; reorder_qty?: number }[],
  companyName = 'notre société',
): string {
  const lines = (items || []).slice(0, 40).map((it, i) => {
    const need =
      it.reorder_qty != null
        ? Number(it.reorder_qty)
        : Math.max(1, Number(it.low_stock_threshold || 5) * 2 - Number(it.stock_quantity || 0));
    return `${i + 1}. ${it.name || 'Article'}${it.sku ? ` (${it.sku})` : ''} — qté souhaitée ≈ ${Math.round(need)} (stock actuel ${Math.round(Number(it.stock_quantity || 0))})`;
  });
  return [
    `Bonjour,`,
    ``,
    `Nous souhaiterions passer une commande de réassort pour ${companyName} :`,
    ``,
    ...lines,
    ``,
    `Merci de nous confirmer disponibilités, délais et prix.`,
    `Cordialement,`,
  ].join('\n');
}



/** 4. Refund reason assistant — expand a rough phrase */
export function polishRefundReason(raw: string, code?: string): string {
  const t = String(raw || '').trim();
  const codeHints: Record<string, string> = {
    our_error: 'Erreur de notre part lors de la préparation ou de la facturation',
    defective: 'Article reçu défectueux ou endommagé (non causé par le client)',
    wrong_item: 'Mauvais article / mauvaise référence livrée',
    missing_qty: 'Quantité manquante par rapport à la commande',
    transport: 'Dommage survenu pendant le transport',
  };
  const base = code && codeHints[code] ? codeHints[code] : '';
  if (!t && base) {
    return `${base}. Merci de procéder au remboursement / avoir correspondant.`;
  }
  if (!t) return '';
  let out = t;
  if (out.length < 12) {
    out = base ? `${base} : ${out}` : `Problème signalé par le client : ${out}`;
  }
  if (!/[.!?]$/.test(out)) out += '.';
  if (out.length < 40 && base && !out.includes(base.slice(0, 20))) {
    out = `${base}. Détail : ${t}${/[.!?]$/.test(t) ? '' : '.'}`;
  }
  if (out.length < 12) {
    out += ' Demande d’avoir formalisée après vérification.';
  }
  return out.slice(0, 500);
}


/** 6. Price anomaly vs list / cost */
export function priceAnomaly(
  unitPrice: number,
  ref: { list?: number; cost?: number },
): { warn: boolean; level: 'ok' | 'low' | 'below_cost'; message: string } {
  const u = Number(unitPrice || 0);
  const list = Number(ref.list || 0);
  const cost = Number(ref.cost || 0);
  if (u <= 0) return { warn: false, level: 'ok', message: '' };
  if (cost > 0 && u < cost - 0.001) {
    return {
      warn: true,
      level: 'below_cost',
      message: `Prix (${u}) sous le coût (${cost}) — marge négative.`,
    };
  }
  if (list > 0 && u < list * 0.7) {
    return {
      warn: true,
      level: 'low',
      message: `Prix nettement sous le tarif catalogue (${list}) — vérifiez la remise.`,
    };
  }
  return { warn: false, level: 'ok', message: '' };
}

/** 7. Client risk from open invoices */
export function clientRisk(invoices: { status?: string; due_date?: string; issue_date?: string; total?: number; amount_paid?: number; client_id?: number; client_name?: string; doc_kind?: string; number?: string }[], clientId?: number | string, clientName?: string): {
  level: 'ok' | 'watch' | 'high';
  message: string;
  unpaid: number;
  overdue: number;
} {
  // Only evaluate after a real client is chosen (id or non-empty name)
  const hasId = clientId !== undefined && clientId !== null && clientId !== '';
  const hasName = !!(clientName && String(clientName).trim());
  if (!hasId && !hasName) {
    return { level: 'ok', message: '', unpaid: 0, overdue: 0 };
  }
  const now = Date.now();
  let unpaid = 0;
  let overdue = 0;
  for (const inv of invoices || []) {
    if (['quote', 'devis', 'cancelled', 'remboursement'].includes(String(inv.status))) continue;
    const dk = String(inv.doc_kind || '');
    if (dk === 'quick_sale' || dk === 'ticket') continue;
    if (String(inv.number || '').startsWith('VR')) continue;
    if (hasId && Number(inv.client_id) !== Number(clientId)) continue;
    if (!hasId && hasName && norm(inv.client_name || '') !== norm(clientName || '')) continue;
    if (!hasId && !hasName) continue;
    const due = remainingBalance(Number(inv.total || 0), Number(inv.amount_paid || 0));
    if (due < 0.01) continue;
    unpaid += due;
    const d = inv.due_date || inv.issue_date;
    if (d && new Date(d).getTime() < now - 86400000) overdue += due;
  }
  if (overdue > 0) {
    return {
      level: 'high',
      message: `Client à risque : ${Math.round(overdue).toLocaleString('fr-FR')} MAD en retard (total ouvert ${Math.round(unpaid).toLocaleString('fr-FR')} MAD).`,
      unpaid,
      overdue,
    };
  }
  if (unpaid > 5000) {
    return {
      level: 'watch',
      message: `Encours client élevé : ${Math.round(unpaid).toLocaleString('fr-FR')} MAD non réglés.`,
      unpaid,
      overdue,
    };
  }
  return { level: 'ok', message: '', unpaid, overdue };
}


/** 9. WhatsApp-style reply drafts */
export function whatsAppDraft(
  kind: 'quote' | 'invoice' | 'paid' | 'reminder',
  ctx: { number?: string; client?: string; total?: number; currency?: string },
): string {
  const cur = ctx.currency || 'MAD';
  const total = Math.round(Number(ctx.total || 0)).toLocaleString('fr-FR');
  const who = ctx.client ? `Bonjour ${ctx.client},` : 'Bonjour,';
  switch (kind) {
    case 'quote':
      return `${who}\nVoici notre devis ${ctx.number || ''} d’un montant de ${total} ${cur}.\nDites-nous si vous validez pour lancer la préparation.\nMerci.`;
    case 'invoice':
      return `${who}\nVeuillez trouver la facture ${ctx.number || ''} — total ${total} ${cur}.\nMerci de votre règlement.\nCordialement.`;
    case 'paid':
      return `${who}\nNous confirmons la bonne réception de votre règlement pour ${ctx.number || ''}.\nMerci pour votre confiance.`;
    case 'reminder':
      return `${who}\nPetit rappel concernant la facture ${ctx.number || ''} (reste ${total} ${cur}).\nMerci de nous indiquer la date de règlement prévue.\nCordialement.`;
    default:
      return who;
  }
}


/** 12. Simple demand hint from qty series (newest last) */
export function demandHint(qtyByPeriod: number[]): string {
  const a = (qtyByPeriod || []).map((n) => Number(n || 0));
  if (a.length < 2) return 'Pas assez d’historique pour une tendance.';
  const recent = a.slice(-3);
  const older = a.slice(0, -3);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const r = avg(recent);
  const o = avg(older.length ? older : a.slice(0, -1));
  if (o <= 0 && r > 0) return 'Demande émergente — surveiller le stock.';
  if (r > o * 1.25) return `Tendance haussière (~${Math.round(((r - o) / (o || 1)) * 100)} %). Anticiper un réassort.`;
  if (r < o * 0.75) return `Tendance baissière — éviter le surstock.`;
  return 'Demande stable.';
}

