/**
 * Local “AI helpers” for Atlas Commerce — no external API keys required.
 * Heuristics + French templates suitable for a small marble / stock shop.
 */

export type ProductLike = {
  id?: number;
  name?: string;
  sku?: string;
  barcode?: string;
  price?: number;
  unit_price?: number;
  cost?: number;
  cost_price?: number;
  category?: string;
  stock_quantity?: number;
  low_stock_threshold?: number;
};

export type MatchResult = {
  product: ProductLike;
  score: number;
  reason: string;
};

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 1. Smart product match from messy name / SKU / barcode */
export function matchProducts(query: string, products: ProductLike[], limit = 6): MatchResult[] {
  const q = norm(query);
  if (!q || q.length < 1) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const out: MatchResult[] = [];

  for (const p of products) {
    const name = norm(p.name || '');
    const sku = norm(p.sku || '');
    const bar = String(p.barcode || '').trim().toLowerCase();
    let score = 0;
    let reason = '';

    if (bar && (bar === query.trim().toLowerCase() || bar.includes(query.trim().toLowerCase()))) {
      score = 100;
      reason = 'code-barres';
    } else if (sku && (sku === q || sku.includes(q) || q.includes(sku))) {
      score = 92;
      reason = 'SKU';
    } else if (name === q) {
      score = 90;
      reason = 'nom exact';
    } else if (name.startsWith(q) || q.startsWith(name.slice(0, Math.min(12, name.length)))) {
      score = 80;
      reason = 'début de nom';
    } else {
      let hit = 0;
      for (const t of tokens) {
        if (t.length < 2) continue;
        if (name.includes(t)) hit += 1;
        if (sku.includes(t)) hit += 0.5;
      }
      if (hit > 0) {
        score = 50 + hit * 12;
        reason = 'mots-clés';
      }
      // typo: shared prefix length
      if (score < 50 && name && q) {
        let pref = 0;
        while (pref < name.length && pref < q.length && name[pref] === q[pref]) pref++;
        if (pref >= 4) {
          score = Math.max(score, 40 + pref);
          reason = 'ressemblance';
        }
      }
    }
    if (score >= 40) out.push({ product: p, score, reason });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
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

/** 3. Invoice note chips */
export const NOTE_CHIPS: { id: string; label: string; text: string }[] = [
  { id: 'retard', label: 'Retard', text: 'Livraison en retard — merci de prioriser.' },
  { id: 'remise', label: 'Remise', text: 'Remise commerciale accordée sur cette pièce.' },
  { id: 'livraison', label: 'Livraison', text: 'Livraison à l’adresse indiquée — contacter avant passage.' },
  { id: 'acompte', label: 'Acompte', text: 'Acompte reçu ; solde à régler à la livraison.' },
  { id: 'chantier', label: 'Chantier', text: 'Matériel destiné au chantier — vérifier quantités à réception.' },
  { id: 'sav', label: 'SAV', text: 'Suite à échange / SAV — voir ticket précédent.' },
];

export function applyNoteChip(current: string, chipText: string): string {
  const cur = (current || '').trim();
  if (!cur) return chipText;
  if (cur.includes(chipText)) return cur;
  return `${cur}${cur.endsWith('.') ? '' : '.'} ${chipText}`;
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

/** 5. Daily closing summary (5 lines) */
export function dailyClosingSummary(input: {
  dateLabel: string;
  salesTotal?: number;
  salesCount?: number;
  unpaidTotal?: number;
  unpaidCount?: number;
  lowStockCount?: number;
  openQuotes?: number;
  currency?: string;
}): string {
  const cur = input.currency || 'MAD';
  const f = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  return [
    `Clôture du ${input.dateLabel}`,
    `• Ventes du jour : ${f(input.salesTotal || 0)} ${cur} (${input.salesCount || 0} pièce${(input.salesCount || 0) > 1 ? 's' : ''})`,
    `• Impayés ouverts : ${f(input.unpaidTotal || 0)} ${cur} (${input.unpaidCount || 0} dossier${(input.unpaidCount || 0) > 1 ? 's' : ''})`,
    `• Stock bas : ${input.lowStockCount || 0} article${(input.lowStockCount || 0) > 1 ? 's' : ''}`,
    `• Devis ouverts : ${input.openQuotes || 0}`,
  ].join('\n');
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
export function clientRisk(invoices: { status?: string; due_date?: string; issue_date?: string; total?: number; amount_paid?: number; client_id?: number; client_name?: string }[], clientId?: number | string, clientName?: string): {
  level: 'ok' | 'watch' | 'high';
  message: string;
  unpaid: number;
  overdue: number;
} {
  const now = Date.now();
  let unpaid = 0;
  let overdue = 0;
  for (const inv of invoices || []) {
    if (['quote', 'devis', 'cancelled', 'remboursement'].includes(String(inv.status))) continue;
    if (clientId && Number(inv.client_id) !== Number(clientId)) continue;
    if (!clientId && clientName && norm(inv.client_name || '') !== norm(clientName)) continue;
    const due = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
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

/** 8. Photo → product draft (manual confirm; uses file name) */
export function draftProductFromFile(file: File | null): { name: string; category: string; note: string } {
  if (!file) return { name: '', category: '', note: '' };
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const name = base
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 80);
  let category = 'Divers';
  const n = norm(name);
  if (/marbre|carrel|granit|sanitaire/.test(n)) category = 'Marbre / carrelage';
  else if (/colle|joint|mortier/.test(n)) category = 'Consommables';
  else if (/outil|disque|meule/.test(n)) category = 'Outillage';
  return {
    name: name || 'Nouveau produit',
    category,
    note: 'Brouillon depuis photo — vérifiez le nom et le prix avant enregistrement.',
  };
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

/** 11. Expense category from description */
export function suggestExpenseCategory(description: string): string {
  const d = norm(description);
  if (/loyer|bail|location local/.test(d)) return 'Loyer';
  if (/essence|gasoil|carburant|transport|taxi/.test(d)) return 'Transport';
  if (/salaire|paie|cnss/.test(d)) return 'Personnel';
  if (/electric|eau|onée|onee|iam|telecom|internet/.test(d)) return 'Charges';
  if (/publicit|facebook|insta|pub /.test(d)) return 'Marketing';
  if (/achat|fournisseur|marchandise|stock/.test(d)) return 'Achats stock';
  if (/repar|maintenance|sav/.test(d)) return 'Entretien';
  if (/rembours/.test(d)) return 'Remboursement client';
  return 'Divers';
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

/** Mini FAQ / “chat” without LLM */
export function localAssistAnswer(question: string, ctx: Record<string, string | number>): string {
  const q = norm(question);
  if (/impay|creance|retard/.test(q)) {
    return `Impayés estimés : ${ctx.unpaid ?? '—'} MAD. Consultez Rapports → Balance âgée.`;
  }
  if (/stock|rupture|bas/.test(q)) {
    return `Articles en stock bas : ${ctx.lowStock ?? '—'}. Utilisez Rapports → Réassort pour un message fournisseur.`;
  }
  if (/vente|ca |chiffre/.test(q)) {
    return `Ventes (période affichée) : ${ctx.sales ?? '—'} MAD. Détail sur le tableau de bord.`;
  }
  if (/tva/.test(q)) {
    return 'Rapports → TVA pour le récapitulatif. Les tickets VR sont hors TVA.';
  }
  if (/wr|rembours|avoir/.test(q)) {
    return 'Les avoirs utilisent la série WR-. Un ticket VR peut être remboursé (0 % TVA). Pièce déjà payée → sortie dans Solde.';
  }
  return 'Je peux aider sur : impayés, stock bas, ventes, TVA, remboursements WR. Reformulez en une phrase courte.';
}
