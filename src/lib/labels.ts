/** Libellés français partagés pour statuts, modes de paiement, types de documents. */

const STATUS_MAP: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyée',
  paid: 'Payée',
  partial: 'Partiellement payée',
  cancelled: 'Annulée',
  overdue: 'En retard',
  quote: 'Devis',
  devis: 'Devis',
  remboursement: 'Remboursement (WR)',
  credit_note: 'Avoir (WR)',
  matched: 'Rapprochement OK',
  pending: 'En attente',
  confirmed: 'Confirmé',
  processing: 'En cours',
};

export function statusFr(s: string): string {
  return STATUS_MAP[s] || s;
}

/** Type de document — une facture payée reste une facture (le reçu est un document distinct). */
export function documentTypeFr(status?: string, kind?: 'invoice' | 'quote' | 'bill' | 'receipt' | 'remboursement'): string {
  if (kind === 'receipt') return 'Reçu';
  if (kind === 'bill') return 'Facture d\'achat';
  if (kind === 'quote' || status === 'quote' || status === 'devis') return 'Devis';
  if (kind === 'remboursement' || status === 'remboursement' || status === 'credit_note') return 'Remboursement (WR)';
  return 'Facture';
}

const PAYMENT_MAP: Record<string, string> = {
  cash: 'Espèces (caisse)',
  bank: 'Virement bancaire',
  bank_company: 'Virement — compte société',
  bank_owner: 'Virement — compte propriétaire',
  check: 'Chèque',
  check_company: 'Chèque — société',
  check_owner: 'Chèque — propriétaire',
  card: 'Carte bancaire',
  other: 'Autre',
  espèces: 'Espèces',
  virement: 'Virement',
  'virement bancaire': 'Virement bancaire',
  chèque: 'Chèque',
  carte: 'Carte',
  'carte bancaire': 'Carte bancaire',
};

export function paymentMethodFr(m: string): string {
  return PAYMENT_MAP[m] || m;
}

export function statusBadgeClass(s: string): string {
  if (s === 'paid' || s === 'matched' || s === 'confirmed') return 'success';
  if (s === 'cancelled') return 'danger';
  if (s === 'partial' || s === 'pending') return 'warning';
  if (s === 'quote' || s === 'devis') return 'info';
  if (s === 'overdue') return 'danger';
  if (s === 'remboursement' || s === 'credit_note') return 'warning';
  return 'info';
}

/** Traduction statut pour modèle facture / reçu imprimable */
export function statusPrintFr(s: string): string {
  const printMap: Record<string, string> = {
    draft: 'Brouillon',
    sent: 'Envoyée — en attente de règlement',
    paid: 'Soldée (payée intégralement)',
    partial: 'Partiellement payée',
    cancelled: 'Annulée',
    overdue: 'En retard de paiement',
    quote: 'Devis — non facturé',
    devis: 'Devis — non facturé',
    remboursement: 'Remboursement / avoir (WR) — stock rétabli',
    credit_note: 'Avoir (WR)',
  };
  return printMap[s] || statusFr(s);
}

/** Motifs de remboursement acceptés (affichage UI + API). */
export const REFUND_REASON_OPTIONS: { code: string; label: string }[] = [
  { code: 'our_error', label: 'Erreur de notre part (commande / facturation)' },
  { code: 'defective_shipped', label: 'Article cassé ou défectueux à l’envoi (pas de votre fait)' },
  { code: 'wrong_item', label: 'Mauvais article / non conforme envoyé' },
  { code: 'missing_qty', label: 'Quantité manquante à la livraison' },
  { code: 'damaged_transit', label: 'Dommage constaté à la réception (transport)' },
];

/** Disposition stock par ligne WR : restock off → motif obligatoire. */
export const STOCK_DISPOSITION_OPTIONS: { code: string; label: string }[] = [
  { code: 'broken_unusable', label: 'Cassé / inutilisable (hors stock)' },
  { code: 'lost_not_received', label: 'Perdu / non reçu physiquement' },
  { code: 'customer_keeps', label: 'Client conserve l’article (sans retour physique)' },
  { code: 'destroyed', label: 'Détruit / mis au rebut' },
  { code: 'other', label: 'Autre (préciser dans l’explication)' },
];

export const VALUATION_METHOD_OPTIONS: { code: string; label: string; help: string }[] = [
  {
    code: 'average',
    label: 'Coût moyen pondéré (CMP)',
    help: 'Chaque achat recalcule le coût unitaire moyen. Méthode la plus courante au Maroc pour les PME.',
  },
  {
    code: 'fifo',
    label: 'PEPS / FIFO (premier entré, premier sorti)',
    help: 'Couches d’achat : les sorties consomment d’abord les lots les plus anciens.',
  },
  {
    code: 'standard',
    label: 'Coût standard',
    help: 'Le coût catalogue du produit reste fixe ; le dernier prix d’achat est seulement mémorisé.',
  },
];

export function movementTypeFr(t: string): string {
  const map: Record<string, string> = {
    sale: 'Vente',
    purchase: 'Achat',
    adjustment: 'Ajustement',
    initial: 'Stock initial',
    refund_restock: 'Retour WR (remise en stock)',
    refund_no_restock: 'Retour WR (hors stock)',
    out: 'Sortie',
    transfer: 'Transfert',
    'auto-transfer': 'Transfert automatique',
  };
  return map[t] || t;
}
