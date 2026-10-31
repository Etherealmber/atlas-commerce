/** Settings search — full index + fuzzy (Windows/Linear style). */
export type SettingsSearchHit = { id: string; tab: string; label: string; keywords: string };

export const SETTINGS_SEARCH_INDEX: SettingsSearchHit[] = [
  { id: 'profile_photo', tab: 'profile', label: 'Photo de profil', keywords: 'photo avatar image profil' },
  { id: 'display_name', tab: 'profile', label: 'Nom affiché', keywords: 'nom affiche display name profil' },
  { id: 'profile_email', tab: 'profile', label: 'E-mail du profil', keywords: 'email mail profil contact' },
  { id: 'profile_phone', tab: 'profile', label: 'Téléphone du profil', keywords: 'telephone tel profil' },
  { id: 'profile_notes', tab: 'profile', label: 'Note personnelle', keywords: 'note personnelle profil' },
  { id: 'passkeys', tab: 'profile', label: 'Clés d\'accès (passkeys)', keywords: 'passkey webauthn biometrie cle acces fido' },
  { id: 'webauthn', tab: 'profile', label: 'Sécurité WebAuthn / FIDO2', keywords: 'webauthn fido attestation pin biometrie' },
  { id: 'company_name', tab: 'company', label: 'Nom de la société', keywords: 'nom societe entreprise raison sociale' },
  { id: 'legal_form', tab: 'company', label: 'Forme juridique', keywords: 'forme juridique sarl sa auto entrepreneur' },
  { id: 'company_address', tab: 'company', label: 'Adresse', keywords: 'adresse rue' },
  { id: 'company_city', tab: 'company', label: 'Ville', keywords: 'ville city' },
  { id: 'company_postal', tab: 'company', label: 'Code postal', keywords: 'code postal cp' },
  { id: 'company_country', tab: 'company', label: 'Pays', keywords: 'pays country maroc' },
  { id: 'company_contact', tab: 'company', label: 'Téléphone société', keywords: 'telephone tel societe' },
  { id: 'company_email', tab: 'company', label: 'E-mail société', keywords: 'email mail societe' },
  { id: 'company_website', tab: 'company', label: 'Site web', keywords: 'site web website url' },
  { id: 'company_logo', tab: 'company', label: 'Logo', keywords: 'logo image marque url logo_url' },
  { id: 'attendance_enabled', tab: 'attendance', label: 'Activer la présence', keywords: 'activer presence attendance enable pointage' },
  { id: 'attendance_rules', tab: 'attendance', label: 'Règles de présence et paie', keywords: 'regles retard paie acompte cycle presence' },
  { id: 'ice', tab: 'legal', label: 'ICE', keywords: 'ice identifiant commun entreprise' },
  { id: 'rc', tab: 'legal', label: 'Registre de commerce (RC)', keywords: 'rc registre commerce' },
  { id: 'patente', tab: 'legal', label: 'Patente', keywords: 'patente taxe professionnelle' },
  { id: 'if_fiscal', tab: 'legal', label: 'Identifiant fiscal (IF)', keywords: 'if identifiant fiscal' },
  { id: 'cnss', tab: 'legal', label: 'CNSS', keywords: 'cnss social' },
  { id: 'legal_footer', tab: 'legal', label: 'Mentions légales documents', keywords: 'mentions legales pied page' },
  { id: 'numbering', tab: 'invoicing', label: 'Style de numérotation', keywords: 'numerotation style sequence maroc' },
  { id: 'number_pad', tab: 'invoicing', label: 'Nombre de chiffres (séquence)', keywords: 'chiffres pad sequence zeros' },
  { id: 'prefixes', tab: 'invoicing', label: 'Préfixe factures de vente', keywords: 'prefixe facture fa vente' },
  { id: 'employee_prefix', tab: 'invoicing', label: 'Préfixe employés', keywords: 'prefixe employe emp' },
  { id: 'prefix_quote', tab: 'invoicing', label: 'Préfixe devis', keywords: 'prefixe devis quote' },
  { id: 'prefix_bill', tab: 'invoicing', label: 'Préfixe factures d\'achat', keywords: 'prefixe achat bill' },
  { id: 'prefix_receipt', tab: 'invoicing', label: 'Préfixe reçus', keywords: 'prefixe recu receipt' },
  { id: 'prefix_wr', tab: 'invoicing', label: 'Préfixe remboursements (WR)', keywords: 'prefixe remboursement wr' },
  { id: 'prefix_qs', tab: 'invoicing', label: 'Préfixe ventes rapides', keywords: 'prefixe vente rapide caisse qs' },
  { id: 'next_invoice', tab: 'invoicing', label: 'Prochain n° facture', keywords: 'prochain numero facture' },
  { id: 'next_quote', tab: 'invoicing', label: 'Prochain n° devis', keywords: 'prochain numero devis' },
  { id: 'next_employee', tab: 'invoicing', label: 'Prochain n° employé', keywords: 'prochain numero employe' },
  { id: 'tax_rate', tab: 'invoicing', label: 'Taux de TVA', keywords: 'tva tax taux' },
  { id: 'currency', tab: 'invoicing', label: 'Devise', keywords: 'devise currency mad euro' },
  { id: 'doc-preview', tab: 'invoicing', label: 'Aperçus documents (démo)', keywords: 'apercu preview facture devis' },
  { id: 'pdf_accent', tab: 'documents', label: 'Couleur d\'accent PDF', keywords: 'couleur accent hex pdf' },
  { id: 'pdf_footer', tab: 'documents', label: 'Texte bas de page PDF', keywords: 'bas de page footer pdf' },
  { id: 'pdf_signature', tab: 'documents', label: 'Signature société', keywords: 'signature image pdf' },
  { id: 'pdf_stamp', tab: 'documents', label: 'Cachet / tampon', keywords: 'cachet tampon stamp' },
  { id: 'pdf_options', tab: 'documents', label: 'Options d\'impression PDF', keywords: 'options pdf logo qr banque' },
  { id: 'warehouse_main', tab: 'warehouse', label: 'Entrepôts et emplacements', keywords: 'entrepot stock magasin emplacement' },
  { id: 'sales_location', tab: 'warehouse', label: 'Emplacement ventes', keywords: 'sales_location vente' },
  { id: 'purchase_location', tab: 'warehouse', label: 'Emplacement achats', keywords: 'purchase_location achat' },
  { id: 'valuation', tab: 'warehouse', label: 'Méthode de valorisation stock', keywords: 'valorisation stock cmp fifo' },
  { id: 'categories_list', tab: 'categories', label: 'Catégories produits', keywords: 'categorie produit catalogue' },
  { id: 'integrations_api', tab: 'integrations', label: 'API / intégrations', keywords: 'api integration webhook' },
  { id: 'atlas_agent', tab: 'agent', label: 'Atlas Agent · Groq', keywords: 'atlas agent groq ia cle key modele' },
  { id: 'agent_knowledge', tab: 'agent', label: 'Mémoire & savoir de l’Agent (mémoire, contexte, garde-fous, outils, RAG)', keywords: 'memoire memory rag connaissances outils garde-fous contexte agent knowledge docs documents' },
  { id: 'agent_permissions', tab: 'agent', label: 'Permissions Atlas Agent', keywords: 'permissions outils agent modes acces complet lecture seule' },
  { id: 'agent_security', tab: 'agent', label: 'Atlas Agent & Sécurité (quotas, 2FA, accès utilisateurs, appareils)', keywords: 'securite quota jetons 2fa otp appareils acces suspendre retablir comptes agent' },
  { id: 'backup', tab: 'admin', label: 'Sauvegarde et restauration', keywords: 'sauvegarde restore backup' },
  { id: 'users', tab: 'admin', label: 'Utilisateurs et rôles', keywords: 'utilisateur role equipe admin' },
  { id: 'danger', tab: 'admin', label: 'Zone sensible', keywords: 'danger export reset parametres' },
  { id: 'period_lock', tab: 'admin', label: 'Clôture de période', keywords: 'cloture periode lock mois' },
  { id: 'sec-audit', tab: 'audit', label: 'Journal d\'audit', keywords: 'audit journal historique log' },
];


export const SETTINGS_TAB_LABELS: Record<string, string> = {
  profile: 'Mon profil',
  company: 'Société',
  attendance: 'Présence',
  legal: 'Légal',
  invoicing: 'Facturation',
  documents: 'PDF',
  warehouse: 'Entrepôts',
  categories: 'Catégories',
  integrations: 'API',
  admin: 'Admin',
  audit: "Journal d'audit",
};

export const SETTINGS_TAB_ICON: Record<string, string> = {
  profile: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  company: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  attendance: 'M12 8v4l3 3M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  legal: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
  invoicing: 'M8 2h8a2 2 0 0 1 2 2v16l-3-1.5L12 21l-3-1.5L6 20V4a2 2 0 0 1 2-2z',
  documents: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  warehouse: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z',
  categories: 'M4 6h16M4 12h16M4 18h10',
  integrations: 'M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93M14 11a5 5 0 0 0-7.07 0L5.52 12.4a5 5 0 0 0 7.07 7.07L14 18.07',
  admin: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.63.98 1.01 1.64 1.01H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
};

const HISTORY_KEY = 'atlas-settings-search-history';
const PENDING_KEY = 'atlas-settings-pending-anchor';

export function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(items: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 12)));
  } catch { /* */ }
}

export function pushSearchHistory(q: string) {
  const t = q.trim();
  if (!t) return;
  const prev = loadSearchHistory().filter((x) => x.toLowerCase() !== t.toLowerCase());
  saveSearchHistory([t, ...prev]);
}

export function removeSearchHistoryItem(q: string) {
  saveSearchHistory(loadSearchHistory().filter((x) => x !== q));
}

export function clearSearchHistory() {
  saveSearchHistory([]);
}

export function setPendingAnchor(id: string, tab: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id, tab, t: Date.now() }));
  } catch { /* */ }
}

export function getPendingAnchor(): { id: string; tab: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && (p.id || p.tab)) return { id: String(p.id || ''), tab: String(p.tab || '') };
  } catch { /* */ }
  return null;
}

export function clearPendingAnchor() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch { /* */ }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, () => 0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function scoreHit(q: string, hit: SettingsSearchHit): number {
  const nq = normalize(q);
  if (!nq) return 0;
  const label = normalize(hit.label);
  const kw = normalize(hit.keywords + ' ' + hit.id + ' ' + hit.tab);
  if (label === nq) return 100;
  if (label.startsWith(nq)) return 92;
  if (nq.length >= 2 && label.includes(nq)) return 85;
  const words = kw.split(' ').filter(Boolean);
  if (words.some((w) => w === nq)) return 88;
  if (words.some((w) => w.startsWith(nq))) return 75;
  if (kw.includes(nq)) return 65;
  // multi-word query: all tokens must appear somewhere
  const qTokens = nq.split(' ').filter((t) => t.length >= 2);
  if (qTokens.length > 1) {
    const blob = label + ' ' + kw;
    if (qTokens.every((t) => blob.includes(t))) return 70;
  }
  let best = 0;
  const tokens = [...label.split(' '), ...words].filter((t) => t.length >= 3);
  for (const t of tokens) {
    const d = lev(nq, t);
    const maxLen = Math.max(nq.length, t.length);
    const sim = 1 - d / maxLen;
    if (sim >= 0.6) best = Math.max(best, 42 + sim * 35);
  }
  const dLab = lev(nq, label);
  if (label.length && dLab <= Math.max(2, Math.floor(label.length * 0.4))) {
    best = Math.max(best, 48 - dLab * 4);
  }
  return best;
}

export type SearchResult = { hits: SettingsSearchHit[]; suggestions: SettingsSearchHit[] };

export function searchSettings(q: string, allowedTabs?: Set<string>): SearchResult {
  const s = q.trim();
  if (!s) return { hits: [], suggestions: [] };
  const scored = SETTINGS_SEARCH_INDEX
    .filter((x) => !allowedTabs || allowedTabs.has(x.tab))
    .map((x) => ({ x, score: scoreHit(s, x) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const hits = scored.filter((r) => r.score >= 58).map((r) => r.x).slice(0, 12);
  const hitIds = new Set(hits.map((h) => h.id));
  const suggestions = scored
    .filter((r) => r.score >= 38 && r.score < 58 && !hitIds.has(r.x.id))
    .map((r) => r.x)
    .slice(0, 5);

  if (hits.length === 0 && scored.length) {
    return { hits: [], suggestions: scored.slice(0, 6).map((r) => r.x) };
  }
  return { hits, suggestions };
}

export function filterSettingsHits(q: string, allowedTabs?: Set<string>): SettingsSearchHit[] {
  const { hits, suggestions } = searchSettings(q, allowedTabs);
  return hits.length ? hits : suggestions;
}

/** Resolve a history label back to a hit. */
export function resolveHitByLabel(label: string): SettingsSearchHit | undefined {
  const n = normalize(label);
  return (
    SETTINGS_SEARCH_INDEX.find((x) => normalize(x.label) === n) ||
    filterSettingsHits(label)[0]
  );
}
