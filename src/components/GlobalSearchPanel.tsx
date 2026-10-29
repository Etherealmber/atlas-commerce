/**
 * GlobalSearchPanel — v0.7.7 : recherche globale en PANNEAU LATÉRAL animé.
 * - s'ouvre par événement `atlas-search-open` (topbars Paramètres & publiques) ;
 * - se superpose à l'Atlas Agent (et réciproquement) selon l'ordre d'ouverture :
 *   chaque ouverture monte d'un cran la couche zIndex (compteur global, aucune
 *   boucle : les panneaux ne se ferment jamais l'un l'autre) ;
 * - résultats = pages publiques + routes applicatives + sections Paramètres +
 *   produits / clients / factures (API, mis en cache 60 s), filtrés côté client ;
 * - rendu des résultats = STRICTEMENT le sélecteur des popups
 *   (`.atlas-typeahead-*`, celui du sélecteur de produits).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { isLoggedIn } from '../auth';

export type SearchRow = {
  id: string;
  href: string;
  label: string;
  sub?: string;
  meta?: string;
  ava?: string;
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
  { id: 'g-home', href: '/', label: 'Accueil', sub: 'Vitrine publique', meta: 'Page', ava: 'AC' },
  { id: 'g-desktop', href: '/desktop', label: 'Bureau', sub: 'Windows · macOS · Linux', meta: 'Page', ava: 'BU' },
  { id: 'g-android', href: '/android', label: 'Android', sub: 'Téléchargement APK', meta: 'Page', ava: 'AN' },
  { id: 'g-wn', href: '/whats-new', label: 'Nouveautés', sub: 'Journal du produit', meta: 'Page', ava: 'NV' },
  { id: 'g-about', href: '/about', label: 'À propos', sub: 'Produit & hébergement', meta: 'Page', ava: 'AP' },
  { id: 'g-login', href: '/login', label: 'Connexion', sub: 'Se connecter à son espace', meta: 'Page', ava: 'CX' },
];

const APP_ROWS: SearchRow[] = [
  { id: 'a-dash', href: '/dashboard', label: 'Tableau de bord', sub: 'Vue d’ensemble', meta: 'App', ava: 'TB' },
  { id: 'a-qs', href: '/quick-sale', label: 'Vente rapide', sub: 'Caisse', meta: 'App', ava: 'VR' },
  { id: 'a-prod', href: '/products', label: 'Produits & stock', sub: 'Inventaire', meta: 'App', ava: 'PR' },
  { id: 'a-cli', href: '/clients', label: 'Clients', sub: 'Carnet & créances', meta: 'App', ava: 'CL' },
  { id: 'a-inv', href: '/invoices', label: 'Factures', sub: 'Facturation', meta: 'App', ava: 'FA' },
  { id: 'a-bal', href: '/balance', label: 'Créances', sub: 'Suivi des paiements', meta: 'App', ava: 'CR' },
  { id: 'a-rep', href: '/reports', label: 'Rapports', sub: 'Statistiques', meta: 'App', ava: 'RA' },
  { id: 'a-set', href: '/settings', label: 'Paramètres', sub: 'Espace de travail', meta: 'App', ava: 'PA' },
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

export default function GlobalSearchPanel() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [dyn, setDyn] = useState<SearchRow[]>(() => dynCache?.rows || []);
  const [hist, setHist] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : false;

  useEffect(() => {
    const onOpen = () => {
      bumpAtlasLayer('--z-search');
      setQ('');
      setHi(0);
      setHist(loadHist());
      setOpen(true);
    };
    const onClose = () => setOpen(false);
    window.addEventListener('atlas-search-open', onOpen);
    window.addEventListener('atlas-search-close', onClose);
    return () => {
      window.removeEventListener('atlas-search-open', onOpen);
      window.removeEventListener('atlas-search-close', onClose);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  //_collections métier : une seule fois par ouverture, cache 60 s_
  useEffect(() => {
    if (!open || !loggedIn) return;
    if (dynCache && Date.now() - dynCache.at < 60_000) {
      setDyn(dynCache.rows);
      return;
    }
    let dead = false;
    void (async () => {
      try {
        const [pr, cl, inv] = await Promise.all([
          api.getProducts({ limit: 200 }),
          api.getClients(),
          api.getInvoices(),
        ]);
        if (dead) return;
        const rows: SearchRow[] = [
          ...((pr as any)?.data || []).slice(0, 200).map((p: any, i: number) => ({
            id: `d-p-${p.id ?? i}`,
            href: '/products',
            label: String(p.name || p.label || `Produit ${p.id ?? i}`),
            sub: p.sku ? `SKU ${p.sku}` : 'Produit',
            meta: 'Produit',
            ava: 'PR',
          })),
          ...((cl as any)?.data || []).slice(0, 200).map((c: any, i: number) => ({
            id: `d-c-${c.id ?? i}`,
            href: '/clients',
            label: String(c.name || c.full_name || `Client ${c.id ?? i}`),
            sub: c.phone ? String(c.phone) : 'Client',
            meta: 'Client',
            ava: 'CL',
          })),
          ...((inv as any)?.data || []).slice(0, 200).map((v: any, i: number) => ({
            id: `d-i-${v.id ?? i}`,
            href: '/invoices',
            label: `Facture ${v.number ?? v.id ?? i}`,
            sub: v.party_name || v.client_name || '',
            meta: 'Facture',
            ava: 'FA',
          })),
        ];
        dynCache = { at: Date.now(), rows };
        setDyn(rows);
      } catch { /* hors-ligne : pages & routes suffisent */ }
    })();
    return () => { dead = true; };
  }, [open, loggedIn]);

  const results = useMemo<SearchRow[]>(() => {
    const base = [...PUBLIC_ROWS, ...(loggedIn ? APP_ROWS : []), ...(loggedIn ? dyn : [])];
    const nq = norm(q);
    if (!nq) return base.slice(0, 24);
    return base
      .filter((r) => norm(`${r.label} ${r.sub || ''} ${r.meta || ''}`).includes(nq))
      .slice(0, 40);
  }, [q, dyn, loggedIn]);

  useEffect(() => { setHi(0); }, [q]);

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

  return (
    <aside
      className="gsp"
      role="dialog"
      aria-label="Recherche globale"
      style={{ zIndex: 'var(--z-search, 115)' } as React.CSSProperties}
    >
      <div className="gsp-head">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ display: 'block', flex: '0 0 auto', opacity: .6 }}>
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
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
            if (e.key === 'Escape') { setOpen(false); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter' && results[hi]) { e.preventDefault(); go(results[hi]); }
          }}
        />
        <button type="button" className="gsp-close" aria-label="Fermer la recherche" onClick={() => setOpen(false)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="atlas-typeahead-menu gsp-list" role="listbox" aria-label="Résultats">
        {!q.trim() && hist.length > 0 && (
          <div className="gsp-hist">
            <div className="gsp-hist-head">
              <span>Historique (cet appareil)</span>
              <button type="button" className="gsp-hist-clear" onClick={() => { saveHist([]); setHist([]); }}>
                Tout effacer
              </button>
            </div>
            {hist.map((h) => (
              <div key={h} className="gsp-hist-row">
                <button type="button" className="gsp-hist-item" onClick={() => setQ(h)}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                  {h}
                </button>
                <button type="button" className="gsp-hist-x" aria-label={`Retirer ${h} de l'historique`} onClick={() => dropHist(h)}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {!q.trim() && hist.length === 0 && (
          <div className="atlas-typeahead-empty">Tapez un mot pour chercher partout…</div>
        )}
        {q.trim() && results.map((r, i) => (
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
        {q.trim() && !results.length && (
          <div className="atlas-typeahead-empty">Aucun résultat pour « {q} »</div>
        )}
      </div>
      <p className="gsp-hint">↑↓ naviguer · Entrée ouvrir · Échap fermer</p>
    </aside>
  );
}
