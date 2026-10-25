/** Messages d’erreur utilisateur (FR) — codes API + textes génériques. */

const CODE_MAP: Record<string, string> = {
  BAD_PASSWORD: 'Mot de passe incorrect. Vérifiez et réessayez.',
  PASSWORD_REQUIRED: 'Le mot de passe de confirmation est obligatoire.',
  UNAUTHORIZED: 'Session expirée ou non autorisée. Reconnectez-vous.',
  FORBIDDEN_ROLE: 'Votre rôle ne permet pas cette action. Contactez un administrateur.',
  OWNER_ONLY: 'Réservé au propriétaire / administrateur principal.',
  REASON_REQUIRED:
    'Un motif de remboursement valable et une explication détaillée sont obligatoires. Sans cela, le remboursement est refusé.',
  SOURCE_REQUIRED: 'Sélectionnez la facture d’origine à rembourser.',
  ITEMS_REQUIRED: 'Indiquez au moins une ligne et une quantité à retourner.',
  QTY_EXCEEDED: 'La quantité à rembourser dépasse le reste remboursable sur cette ligne.',
  DISPOSITION_REQUIRED: 'Sans remise en stock, une disposition est obligatoire (cassé, perdu, client conserve…).',
  INSUFFICIENT_STOCK: 'Stock insuffisant pour cette opération. Réduisez la quantité ou réapprovisionnez.',
  WR_NO_PAYMENT: 'Impossible d’enregistrer un paiement sur un avoir WR.',
  VOID_REASON_REQUIRED: 'Motif d’annulation obligatoire (le numéro de document est conservé).',
  PERIOD_LOCKED: 'Période fiscale clôturée — document refusé pour cette date.',
  REFUND_FAILED: 'Impossible de créer le remboursement. Réessayez ou contactez le support.',
  INVOICE_CREATE_FAILED: 'Impossible de créer la facture. Vérifiez les lignes et le client.',
  ALREADY_PAID: 'Cette facture est déjà soldée (reste dû = 0).',
  CREDIT_LIMIT: 'Limite de crédit client dépassée.',
  DUPLICATE_PRODUCT: 'Produit en doublon (SKU, code-barres ou nom).',
  ROLE_LOCKED: 'Vous ne pouvez pas modifier votre rôle ici. Contactez un administrateur.',
  WR_PREFIX_INVALID: 'Préfixe WR invalide. Utilisez 1 à 12 caractères (lettres, chiffres, - ou /).',
  WR_NUMBER_INVALID: 'Numéro de remboursement (WR) invalide.',
  WR_NUMBER_TAKEN: 'Ce numéro WR est déjà utilisé. Augmentez le compteur dans Paramètres → Facturation.',
  DELETE_FAILED: 'Suppression impossible. Vérifiez le mot de passe et réessayez.',
  RATE_LIMIT: 'Trop de requêtes. Patientez une minute puis réessayez.',
  TRANSFER_FAILED: 'Transfert de stock impossible. Vérifiez les quantités et emplacements.',
  UBL_VALIDATION_FAILED: 'Export UBL refusé : champs obligatoires manquants (ICE, client, lignes…).',
  NO_FIELDS: 'Aucun champ à modifier.',
  SETTINGS_SAVE_FAILED: 'Impossible d’enregistrer les paramètres. Réessayez après déploiement.',
  FORM_INCOMPLETE: 'Complétez les champs obligatoires (surlignés en rouge).',
  INVALID_PERIOD: 'Format de période invalide. Utilisez AAAA-MM (ex. 2026-06).',
};

export function friendlyError(err: any, fallback = 'Une erreur est survenue. Réessayez ou contactez le support.'): string {
  if (!err) return fallback;
  const code = String(err.code || err.body?.code || '').trim();
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  const msg = String(err.message || err.error || err.body?.error || '').trim();
  if (!msg) return fallback;
  // Soft-map common English / raw strings
  const low = msg.toLowerCase();
  if (low.includes('password') || low.includes('mot de passe')) {
    if (low.includes('required') || low.includes('obligatoire') || low.includes('saisir')) {
      return CODE_MAP.PASSWORD_REQUIRED;
    }
    return CODE_MAP.BAD_PASSWORD;
  }
  if (low.includes('network') || low.includes('failed to fetch')) {
    return 'Connexion impossible. Vérifiez le réseau et l’URL de l’API.';
  }
  return msg;
}

/** Validate credit / WR prefix client-side (mirror of server). */
export function validateWrPrefix(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw || '').trim();
  if (!v) return { ok: false, error: 'Le préfixe WR ne peut pas être vide (ex. WR-).' };
  if (v.length > 12) return { ok: false, error: CODE_MAP.WR_PREFIX_INVALID };
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/]{0,11}$/.test(v)) {
    return { ok: false, error: CODE_MAP.WR_PREFIX_INVALID };
  }
  return { ok: true, value: v };
}
