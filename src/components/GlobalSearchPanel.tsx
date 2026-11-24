/**
 * GlobalSearchPanel — recherche globale unifiée :
 * - instance unique montée au niveau racine (fermeture en un clic, Échap, ou clic hors panneau) ;
 * - raccourci clavier Cmd/Ctrl + K pour ouvrir / fermer ;
 * - recherche multi-mots insensible aux accents sur toutes les pages, sections Paramètres,
 *   produits, clients, factures / tickets VR / devis / achats, fournisseurs et employés.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Search, X } from 'lucide-react';
import { api } from '../api';
import { canManageStock, canOfficeWork, canSell, isLoggedIn } from '../auth';
import { SETTINGS_SEARCH_INDEX } from '../lib/settingsSearch';

type SearchCat = 'all' | 'page' | 'product' | 'party' | 'doc' | 'settings';

type SearchRow = {
  id: string;
  href: string;
  label: string;
  sub?: string;
  meta?: string;
  ava?: string;
  cat: Exclude<SearchCat, 'all'>;
  keywords?: string;
};

/** Monte la couche z du panneau ouvert en dernier (agent ou recherche). */
export function bumpAtlasLayer(varName: string): void {
  try {
    const seq = Number(document.documentElement.dataset.atlasLayerSeq || '0') + 1;
    document.documentElement.dataset.atlasLayerSeq = String(seq);
    document.documentElement.style.setProperty(varName, String(100 + seq * 10));
  } catch { /* SSR / tests */ }
}

const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const PUBLIC_ROWS: SearchRow[] = [
  { id: 'g-home', href: '/', label: 'Accueil', sub: 'Vitrine publique', meta: 'Page', ava: 'AC', cat: 'page' },
  { id: 'g-desktop', href: '/desktop', label: 'Bureau', sub: 'Windows · macOS · Linux', meta: 'Page', ava: 'BU', cat: 'page' },
  { id: 'g-android', href: '/android', label: 'Android', sub: 'Téléchargement APK', meta: 'Page', ava: 'AN', cat: 'page' },
  { id: 'g-wn', href: '/whats-new', label: 'Nouveautés', sub: 'Journal du produit', meta: 'Page', ava: 'NV', cat: 'page' },
  { id: 'g-about', href: '/about', label: 'À propos', sub: 'Produit & hébergement', meta: 'Page', ava: 'AP', cat: 'page' },
  { id: 'g-login', href: '/login', label: 'Connexion', sub: 'Se connecter à son espace', meta: 'Page', ava: 'CX', cat: 'page' },
];

function buildAppRows(): SearchRow[] {
  const rows: SearchRow[] = [];
  if (canOfficeWork()) {
    rows.push({ id: 'a-dash', href: '/dashboard', label: 'Tableau de bord', sub: 'Vue d’ensemble & indicateurs', meta: 'App', ava: 'TB', cat: 'page', keywords: 'accueil kpi stats' });
  }
  if (canSell()) {
    rows.push({ id: 'a-qs', href: '/quick-sale', label: 'Vente rapide', sub: 'Caisse & tickets VR', meta: 'App', ava: 'VR', cat: 'page', keywords: 'caisse ticket vr pos' });
  }
  if (canManageStock()) {
    rows.push(
      { id: 'a-prod', href: '/products', label: 'Produits & stock', sub: 'Catalogue & inventaire', meta: 'App', ava: 'PR', cat: 'page', keywords: 'catalogue article stock' },
      { id: 'a-scan', href: '/scan', label: 'Scanner code-barres', sub: 'Recherche & ajustement rapide', meta: 'App', ava: 'SC', cat: 'page', keywords: 'code barre camera' },
    );
  }
  if (canOfficeWork()) {
    rows.push(
      { id: 'a-cli', href: '/clients', label: 'Clients', sub: 'Carnet & encours', meta: 'App', ava: 'CL', cat: 'page', keywords: 'client carnet' },
      { id: 'a-quo', href: '/quotes', label: 'Devis', sub: 'Estimations clients', meta: 'App', ava: 'DV', cat: 'page', keywords: 'devis estimation' },
      { id: 'a-inv', href: '/invoices', label: 'Factures', sub: 'Facturation & ventes (FA)', meta: 'App', ava: 'FA', cat: 'page', keywords: 'facture fa vente' },
      { id: 'a-rec', href: '/receipts', label: 'Reçus', sub: 'Encaissements', meta: 'App', ava: 'RC', cat: 'page', keywords: 'recu paiement' },
      { id: 'a-rem', href: '/reimbursements', label: 'Remboursements', sub: 'Avoirs & retours (WR)', meta: 'App', ava: 'WR', cat: 'page', keywords: 'avoir retour wr' },
      { id: 'a-bil', href: '/bills', label: 'Factures d’achat', sub: 'Achats fournisseurs', meta: 'App', ava: 'AC', cat: 'page', keywords: 'achat fournisseur' },
      { id: 'a-ven', href: '/vendors', label: 'Fournisseurs', sub: 'Carnet fournisseurs', meta: 'App', ava: 'FN', cat: 'page', keywords: 'fournisseur' },
      { id: 'a-bal', href: '/balance', label: 'Trésorerie & solde', sub: 'Recettes, dépenses & caisse', meta: 'App', ava: 'TR', cat: 'page', keywords: 'solde depense recette caisse' },
      { id: 'a-emp', href: '/employees', label: 'Employés', sub: 'Équipe & paie', meta: 'App', ava: 'EM', cat: 'page', keywords: 'employe salaire rh' },
      { id: 'a-att', href: '/attendance', label: 'Présence', sub: 'Pointage & retards', meta: 'App', ava: 'PT', cat: 'page', keywords: 'presence pointage' },
      { id: 'a-rep', href: '/reports', label: 'Rapports', sub: 'Statistiques & exports', meta: 'App', ava: 'RA', cat: 'page', keywords: 'rapport export pdf' },
    );
  }
  rows.push(
    { id: 'a-act', href: '/actions', label: 'Actions rapides', sub: 'Créations & raccourcis', meta: 'App', ava: 'AX', cat: 'page', keywords: 'raccourci action' },
    { id: 'a-set', href: '/settings', label: 'Paramètres', sub: 'Espace de travail & société', meta: 'App', ava: 'PA', cat: 'page', keywords: 'reglages configuration' },
  );
  return rows;
}

const SETTINGS_ROWS: SearchRow[] = SETTINGS_SEARCH_INDEX.map((s) => ({
  id: `set-${s.id}`,
  href: `/settings?tab=${encodeURIComponent(s.tab)}`,
  label: s.label,
  sub: `Paramètres · ${s.tab}`,
  meta: 'Réglage',
  ava: '⚙',
  cat: 'settings',
  keywords: s.keywords,
}));

const CAT_LABELS: { id: SearchCat; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'product', label: 'Produits' },
  { id: 'doc', label: 'Documents' },
  { id: 'party', label: 'Tiers' },
  { id: 'page', label: 'Pages' },
  { id: 'settings', label: 'Réglages' },
];

let dynCache: { at: number; rows: SearchRow[] } | null = null;

const HIST_KEY = 'atlas-search-history-v1';
const loadHist = (): string[] => {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  } catch { return []; }
};
const saveHist = (h: string[]) => {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 12))); } catch { /* privé */ }
};

function scoreRow(row: SearchRow, tokens: string[], fullQuery: string): number {
  const label = norm(row.label);
  const sub = norm(row.sub || '');
  const hay = norm(`${row.label} ${row.sub || ''} ${row.meta || ''} ${row.keywords || ''}`);
  for (const tk of tokens) {
    if (!hay.includes(tk)) return -1;
  }
  let score = 10;
  if (label === fullQuery) score += 100;
  else if (label.startsWith(fullQuery)) score += 60;
  else if (label.includes(fullQuery)) score += 35;
  else if (sub.startsWith(fullQuery)) score += 25;
  for (const tk of tokens) {
    if (label.split(/\s+/).some((w) => w.startsWith(tk))) score += 12;
  }
  if (row.cat === 'page') score += 6;
  if (row.cat === 'product' || row.cat === 'doc') score += 4;
  return score;
}

export default function GlobalSearchPanel() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SearchCat>('all');
  const [hi, setHi] = useState(0);
  const [loadingDyn, setLoadingDyn] = useState(false);
  const [dyn, setDyn] = useState<SearchRow[]>(() => dynCache?.rows || []);
  const [hist, setHist] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : false;

  useEffect(() => {
    const onOpen = () => {
      bumpAtlasLayer('--z-search');
      setQ('');
      setCat('all');
      setHi(0);
      setHist(loadHist());
      setOpen(true);
    };
    const onClose = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) return false;
          bumpAtlasLayer('--z-search');
          setHist(loadHist());
          return true;
        });
      }
    };
    window.addEventListener('atlas-search-open', onOpen);
    window.addEventListener('atlas-search-close', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('atlas-search-open', onOpen);
      window.removeEventListener('atlas-search-close', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !loggedIn) return;
    if (dynCache && Date.now() - dynCache.at < 60_000) {
      setDyn(dynCache.rows);
      return;
    }
    let dead = false;
    setLoadingDyn(true);
    void (async () => {
      try {
        const office = canOfficeWork();
        const stock = canManageStock();
        const [prRes, clRes, invRes, bilRes, venRes, empRes] = await Promise.allSettled([
          stock ? api.getProducts({ limit: 300 }) : Promise.resolve({ data: [] }),
          office ? api.getClients() : Promise.resolve({ data: [] }),
          office || canSell() ? api.getInvoices(undefined, { kind: 'all' }) : Promise.resolve({ data: [] }),
          office ? api.getBills() : Promise.resolve({ data: [] }),
          office ? api.getVendors() : Promise.resolve({ data: [] }),
          office ? api.getEmployees() : Promise.resolve({ data: [] }),
        ]);
        if (dead) return;
        const val = <T,>(r: PromiseSettledResult<T>): any[] =>
          r.status === 'fulfilled' && Array.isArray((r.value as any)?.data) ? (r.value as any).data : [];
        const rows: SearchRow[] = [
          ...val(prRes).slice(0, 300).map((p: any, i: number) => {
            const parts = [
              p.sku ? `SKU ${p.sku}` : '',
              p.price != null ? `${Math.round(Number(p.price)).toLocaleString('fr-FR')} MAD` : '',
              p.track_inventory ? `Stock ${Number(p.stock_quantity ?? 0)}` : '',
            ].filter(Boolean);
            return {
              id: `d-p-${p.id ?? i}`,
              href: p.id ? `/products/${p.id}/historique` : '/products',
              label: String(p.name || p.label || `Produit ${p.id ?? i}`),
              sub: parts.join(' · ') || 'Produit',
              meta: 'Produit',
              ava: 'PR',
              cat: 'product' as const,
              keywords: `${p.barcode || ''} ${p.category || ''}`,
            };
          }),
          ...val(clRes).slice(0, 200).map((c: any, i: number) => ({
            id: `d-c-${c.id ?? i}`,
            href: `/clients?q=${encodeURIComponent(String(c.name || ''))}`,
            label: String(c.name || c.full_name || `Client ${c.id ?? i}`),
            sub: [c.phone, c.city].filter(Boolean).join(' · ') || 'Client',
            meta: 'Client',
            ava: 'CL',
            cat: 'party' as const,
            keywords: `${c.ice || ''} ${c.email || ''}`,
          })),
          ...val(venRes).slice(0, 150).map((v: any, i: number) => ({
            id: `d-v-${v.id ?? i}`,
            href: '/vendors',
            label: String(v.name || `Fournisseur ${v.id ?? i}`),
            sub: [v.phone, v.city].filter(Boolean).join(' · ') || 'Fournisseur',
            meta: 'Fournisseur',
            ava: 'FN',
            cat: 'party' as const,
            keywords: `${v.ice || ''} ${v.email || ''}`,
          })),
          ...val(empRes).slice(0, 150).map((e: any, i: number) => ({
            id: `d-e-${e.id ?? i}`,
            href: '/employees',
            label: String(e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || `Employé ${e.id ?? i}`),
            sub: e.role_title || e.department || 'Employé',
            meta: 'Employé',
            ava: 'EM',
            cat: 'party' as const,
            keywords: `${e.phone || ''} ${e.emp_number || ''}`,
          })),
          ...val(invRes).slice(0, 250).map((v: any, i: number) => {
            const num = String(v.number || v.id || i);
            const isVr = v.doc_kind === 'quick_sale' || num.startsWith('VR');
            const isQuote = v.status === 'quote' || num.startsWith('DV');
            const isWr = v.doc_kind === 'remboursement' || num.startsWith('WR');
            const href = isVr && v.id
              ? `/quick-sale/${v.id}`
              : isQuote
                ? '/quotes'
                : isWr
                  ? '/reimbursements'
                  : v.id
                    ? `/invoices/${v.id}`
                    : '/invoices';
            const kindLabel = isVr ? 'Ticket VR' : isQuote ? 'Devis' : isWr ? 'Avoir WR' : 'Facture';
            const totalTxt = v.total != null ? `${Math.round(Number(v.total)).toLocaleString('fr-FR')} MAD` : '';
            return {
              id: `d-i-${v.id ?? i}`,
              href,
              label: `${kindLabel} ${num}`,
              sub: [v.party_name || v.client_name, totalTxt].filter(Boolean).join(' · '),
              meta: kindLabel,
              ava: isVr ? 'VR' : isQuote ? 'DV' : isWr ? 'WR' : 'FA',
              cat: 'doc' as const,
              keywords: `${v.issue_date || ''} ${v.status || ''}`,
            };
          }),
          ...val(bilRes).slice(0, 150).map((b: any, i: number) => ({
            id: `d-b-${b.id ?? i}`,
            href: '/bills',
            label: `Achat ${b.number ?? b.id ?? i}`,
            sub: [b.vendor_name, b.total != null ? `${Math.round(Number(b.total)).toLocaleString('fr-FR')} MAD` : ''].filter(Boolean).join(' · '),
            meta: 'Achat',
            ava: 'AC',
            cat: 'doc' as const,
            keywords: `${b.issue_date || ''} ${b.status || ''}`,
          })),
        ];
        dynCache = { at: Date.now(), rows };
        setDyn(rows);
      } catch { /* hors-ligne : pages & routes suffisent */ } finally {
        if (!dead) setLoadingDyn(false);
      }
    })();
    return () => { dead = true; };
  }, [open, loggedIn]);

  const appRows = useMemo(() => (loggedIn ? buildAppRows() : []), [loggedIn]);

  const allPool = useMemo<SearchRow[]>(
    () => [
      ...(loggedIn ? appRows : []),
      ...(loggedIn ? dyn : []),
      ...(loggedIn ? SETTINGS_ROWS : []),
      ...PUBLIC_ROWS,
    ],
    [appRows, dyn, loggedIn],
  );

  const scoredAll = useMemo(() => {
    const nq = norm(q);
    if (!nq) return allPool;
    const tokens = nq.split(/\s+/).filter(Boolean);
    const ranked: { row: SearchRow; score: number }[] = [];
    for (const row of allPool) {
      const s = scoreRow(row, tokens, nq);
      if (s >= 0) ranked.push({ row, score: s });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((x) => x.row);
  }, [q, allPool]);

  const catCounts = useMemo(() => {
    const counts: Record<SearchCat, number> = {
      all: scoredAll.length,
      page: 0,
      product: 0,
      party: 0,
      doc: 0,
      settings: 0,
    };
    for (const r of scoredAll) counts[r.cat]++;
    return counts;
  }, [scoredAll]);

  const results = useMemo<SearchRow[]>(() => {
    const filtered = cat === 'all' ? scoredAll : scoredAll.filter((r) => r.cat === cat);
    if (!norm(q)) return filtered.slice(0, 12);
    return filtered.slice(0, 45);
  }, [scoredAll, cat, q]);

  useEffect(() => { setHi(0); }, [q, cat]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('.atlas-typeahead-item.is-active');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [hi, open]);

  if (!open) return null;

  const pushHist = (term: string) => {
    const t = term.trim();
    if (!t) return;
    const next = [t, ...loadHist().filter((x) => x !== t)].slice(0, 12);
    saveHist(next);
    setHist(next);
  };
  const dropHist = (term: string) => {
    const next = loadHist().filter((x) => x !== term);
    saveHist(next);
    setHist(next);
  };
  const go = (r: SearchRow) => {
    if (q.trim()) pushHist(q);
    setOpen(false);
    navigate(r.href);
  };

  const hasQuery = Boolean(q.trim());

  return (
    <>
      <div className="gsp-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside
        className="gsp"
        role="dialog"
        aria-modal="true"
        aria-label="Recherche globale"
        style={{ zIndex: 'var(--z-search, 115)' } as React.CSSProperties}
      >
        <div className="gsp-head">
          <Search size={17} className="gsp-search-ico" aria-hidden="true" />
          <input
            ref={inputRef}
            className="gsp-input"
            type="text"
            placeholder="Rechercher : page, produit, client, facture…"
            value={q}
            autoComplete="off"
            aria-label="Recherche globale"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, Math.max(0, results.length - 1))); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter' && results[hi]) { e.preventDefault(); go(results[hi]); }
            }}
          />
          {hasQuery && (
            <button
              type="button"
              className="gsp-clear secondary"
              aria-label="Effacer le texte"
              title="Effacer"
              onClick={() => { setQ(''); inputRef.current?.focus(); }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="gsp-close secondary"
            aria-label="Fermer la recherche"
            title="Fermer (Échap)"
            onClick={() => setOpen(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="gsp-tabs" role="tablist" aria-label="Filtrer les résultats">
          {CAT_LABELS.filter((c) => c.id === 'all' || catCounts[c.id] > 0 || (loggedIn && c.id !== 'settings')).map((c) => {
            const active = cat === c.id;
            const n = catCounts[c.id];
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`gsp-tab secondary${active ? ' is-active' : ''}`}
                onClick={() => setCat(c.id)}
              >
                <span>{c.label}</span>
                {hasQuery && n > 0 && <span className="gsp-tab-n">{n}</span>}
              </button>
            );
          })}
        </div>

        <div ref={listRef} className="atlas-typeahead-menu gsp-list" role="listbox" aria-label="Résultats">
          {!hasQuery && hist.length > 0 && (
            <div className="gsp-hist">
              <div className="gsp-hist-head">
                <span>Recherches récentes</span>
                <button type="button" className="gsp-hist-clear secondary" onClick={() => { saveHist([]); setHist([]); }}>
                  Tout effacer
                </button>
              </div>
              {hist.map((h) => (
                <div key={h} className="gsp-hist-row">
                  <button type="button" className="gsp-hist-item secondary" onClick={() => setQ(h)}>
                    <Clock size={14} aria-hidden="true" />
                    <span>{h}</span>
                  </button>
                  <button type="button" className="gsp-hist-x secondary" aria-label={`Retirer ${h} de l'historique`} onClick={() => dropHist(h)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!hasQuery && (
            <div className="gsp-section-label">
              {cat === 'all' ? 'Accès rapides' : CAT_LABELS.find((c) => c.id === cat)?.label}
              {loadingDyn ? ' · synchronisation…' : ''}
            </div>
          )}

          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === hi}
              className={`secondary atlas-typeahead-item${i === hi ? ' is-active' : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => go(r)}
            >
              <span className="atlas-typeahead-ava" aria-hidden>{r.ava}</span>
              <span className="atlas-typeahead-main">
                <strong>{r.label}</strong>
                {r.sub ? <span className="atlas-typeahead-sub">{r.sub}</span> : null}
              </span>
              {r.meta ? <span className="atlas-typeahead-meta">{r.meta}</span> : null}
            </button>
          ))}

          {hasQuery && !results.length && (
            <div className="atlas-typeahead-empty">
              {loadingDyn ? 'Recherche en cours…' : `Aucun résultat pour « ${q} »`}
            </div>
          )}
        </div>

        <p className="gsp-hint">↑↓ naviguer · Entrée ouvrir · Échap fermer · Ctrl+K</p>
      </aside>
    </>
  );
}
