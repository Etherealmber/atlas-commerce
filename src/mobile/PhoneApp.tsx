/**
 * Phone-limited experience (APK + mobile browser).
 * Floor operator: scan, stock check, request product, see own sends.
 * Full ERP lives on PC shell only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import PhoneBills from './PhoneBills';
import PhoneWarehouse from './PhoneWarehouse';
import PhoneSettings from './PhoneSettings';
import { api } from '../api';
import { clearToken, getUsername, getDisplayInitials, getDisplayName, getAvatarUrl, getRole, setProfileCache, isStockRole, canSell, canAccessSettings, canAccessSettingsBeyondProfile } from '../auth';
import { getDensity, setDensity, isGlassEnabled, setGlassEnabled, isLiquidGlassActive, type Density } from '../lib/density';
import { APP_VERSION } from '../version';
import { useUi } from '../components/AppDialogs';
import './phone.css';
import {
  cacheProducts,
  cacheLocations,
  lookupOffline,
  enqueueOutbox,
  enqueueOutboxAndSync,
  countOutbox,
  listOutbox,
  flushOutbox,
  isOnline,
  cacheCount,
} from '../lib/offlineCatalog';
import { startBarcodeScan, isBarcodeLike, captureAndDecode, decodeImageFile, preloadBarcodeScanner, prepareZXing } from '../lib/barcodeScan';
import { IconPackage, IconInbox, IconDocument } from '../components/Icons';
import OfflineBanner from '../components/OfflineBanner';
const AtlasAgent = lazy(() => import('../components/AtlasAgent'));


type Product = {
  id: number;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  stock_quantity?: number;
  stock?: number;
  min_stock?: number;
  unit_price?: number;
  price?: number;
};

type Action = {
  id: number;
  type: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
  barcode?: string;
};

const PHONE_CART_KEY = 'atlas-phone-cart';

function addToPhoneCart(productId: number) {
  try {
    const raw = sessionStorage.getItem(PHONE_CART_KEY);
    const cart = raw ? JSON.parse(raw) as Record<string, number> : {};
    const key = String(productId);
    cart[key] = Number(cart[key] || 0) + 1;
    sessionStorage.setItem(PHONE_CART_KEY, JSON.stringify(cart));
  } catch { /* session storage may be unavailable in private WebViews */ }
}

function takePhoneCart(): Record<number, number> {
  try {
    const raw = sessionStorage.getItem(PHONE_CART_KEY);
    sessionStorage.removeItem(PHONE_CART_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, qty]) => [Number(id), Number(qty) || 0])
    );
  } catch {
    return {};
  }
}

function loadPhoneCart(): Record<number, number> {
  try {
    const raw = sessionStorage.getItem(PHONE_CART_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, qty]) => [Number(id), Number(qty) || 0])
    );
  } catch {
    return {};
  }
}

function savePhoneCart(cart: Record<number, number>) {
  try {
    sessionStorage.setItem(PHONE_CART_KEY, JSON.stringify(cart));
  } catch { /* */ }
}

function stockOf(p: Product) {
  return Number(p.stock_quantity ?? p.stock ?? 0);
}
function priceOf(p: Product) {
  return Number(p.unit_price ?? p.price ?? 0);
}
function minOf(p: Product) {
  return Number(p.min_stock ?? 5);
}

function formatDateFR() {
  return new Date()
    .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
}



function PhoneMore() {
  const stockOnly = isStockRole();
  return (
    <div className="phone-panel">
      <h1 style={{ fontSize: '1.25rem', margin: '8px 0 16px' }}>Plus</h1>
      <ul className="phone-more-list">
        <li><NavLink to="/m/scan">Scan code-barres</NavLink></li>
        {!stockOnly && <li><NavLink to="/m/vente">Vente rapide</NavLink></li>}
        {!stockOnly && <li><NavLink to="/m/bills">Achats &amp; réception</NavLink></li>}
        <li><NavLink to="/m/warehouse">Entrepôts · inventaire · transfert</NavLink></li>
        {!stockOnly && <li><NavLink to="/m/invoice">Nouveau devis</NavLink></li>}
        {!stockOnly && <li><a href="/?mode=pc">Rapports &amp; clôture (PC)</a></li>}
        {!stockOnly && <li><a href="/?mode=pc">Ouvrir version PC</a></li>}
      </ul>
      <p style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 4px' }}>
        {stockOnly
          ? 'Rôle magasinier : scan, stock et propositions produit. Caisse et argent sont gérés sur le PC.'
          : 'Réception des achats, UBL et clôture fiscale sont aussi sur PC (menu latéral).'}
      </p>
    </div>
  );
}

function PhoneEmbed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="phone-panel phone-embed-page">
      <h1 style={{ fontSize: '1.1rem', margin: '4px 0 12px' }}>{title}</h1>
      {children}
    </div>
  );
}
export default function PhoneApp() {
  const { confirm: uiConfirm } = useUi();
  const [products, setProducts] = useState<Product[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [pending, setPending] = useState(0);
  const [todaySales, setTodaySales] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const navigate = useNavigate();

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const refresh = useCallback(async (_soft?: boolean) => {
    const withTimeout = <T,>(p: Promise<T>, ms = 5000): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
      ]);
    // Always clear boot banner quickly even if network is slow
    const bootSafety = window.setTimeout(() => setBooting(false), 2500);
    try {
      // Avoid heavy /api/dashboard on phone — it aggregates many D1 queries and caused stuck "Synchronisation…"
      const [pr, ac, st] = await Promise.all([
        withTimeout(api.getProducts({ include_variants: true, fields: 'mobile', limit: 400 }).catch(() => ({ data: [] })) as Promise<any>),
        withTimeout(api.listMobileActions({ status: 'all', limit: 40 }).catch(() => ({ data: [] })) as Promise<any>),
        withTimeout(api.getMobileActionStats().catch(() => ({ data: { pending: 0, today: 0 } })) as Promise<any>),
      ]);
      setProducts((pr.data || []) as Product[]);
      try { try { const loc = await api.getStockLocations(); await cacheLocations((loc as any).data || []); } catch {}
      await cacheProducts(pr.data || []); } catch { /* offline cache optional */ }
      setActions((ac.data || []) as Action[]);
      setPending(Number(st.data?.pending || 0));
      setTodaySales(0);
    } catch {
      /* keep last — never block UI */
    } finally {
      window.clearTimeout(bootSafety);
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => setBooting(false), 6000);
    refresh();
    const t = setInterval(refresh, 15000);
    const flush = async () => {
      if (!isOnline()) return;
      try {
        const r = await flushOutbox(async (item) => {
          try {
            // Phase 3/4: offline stock adjustments → real stock API
            if (item.type === 'stock_adjust' && item.product_id) {
              const delta = Number(item.meta?.delta ?? 0);
              if (!Number.isFinite(delta) || delta === 0) return true; // drop noop
              const abs = Math.abs(delta);
              await api.adjustStock(Number(item.product_id), {
                quantity: abs,
                type: delta < 0 ? 'out' : 'in',
                reason: String(item.meta?.reason || item.detail || 'Ajustement hors ligne'),
                location_id: item.meta?.location_id ? Number(item.meta.location_id) : undefined,
              });
              return true;
            }
            await api.createMobileAction({
              type: item.type,
              title: item.title,
              detail: item.detail,
              barcode: item.barcode,
              product_id: item.product_id,
              meta: item.meta,
              created_by: 'mobile-offline',
            });
            return true;
          } catch { return false; }
        });
        if (r.sent > 0) {
          show(`${r.sent} action(s) synchronisée(s)`);
          await refresh();
        } else if (r.failed > 0) {
          show(`${r.failed} action(s) en échec — réessayez une fois en ligne`);
        }
      } catch { /* ignore */ }
    };
    (window as any).__atlasFlushOutbox = flush;
    flush();
    window.addEventListener('online', flush);
    // Background Sync (Chrome/Android) → SW posts FLUSH_OUTBOX
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === 'FLUSH_OUTBOX') void flush();
    };
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', onMsg);
    }
    return () => {
      clearInterval(t);
      window.removeEventListener('online', flush);
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', onMsg);
      }
    };
  }, [refresh]);

  const lowCount = useMemo(
    () => products.filter((p) => stockOf(p) < minOf(p)).length,
    [products]
  );
  const stockOnly = isStockRole();
  const allowSell = canSell();
  const [accountOpen, setAccountOpen] = useState(false);
  const [density, setDensityState] = useState<Density>(() => getDensity());
  const [glassOn, setGlassOn] = useState(() => isGlassEnabled());
  const [profileTick, setProfileTick] = useState(0);

  /** Prefer free-tier Durable Object profile when the account sheet opens. */
  useEffect(() => {
    if (!accountOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getMe();
        const m = (r as any)?.data || r || {};
        if (cancelled) return;
        setProfileCache({
          display_name: m.display_name,
          avatar_url: m.avatar_url,
          username: m.username,
          role: m.role,
        });
        setProfileTick((t) => t + 1);
      } catch {
        /* keep local cache */
      }
    })();
    return () => { cancelled = true; };
  }, [accountOpen]);
  const roleLabel = stockOnly ? 'Magasinier' : (getRole() || 'Terrain');

  return (
    <div className="phone-root">
      <OfflineBanner />
      <header className="phone-topbar">
        <div className="phone-brand">
          <img className="phone-logo" src="/logo-mark.svg" alt="Atlas Commerce" width={32} height={32} />
          <div className="phone-brand-text">
            <span className="phone-name">Atlas Commerce</span>
            <span className="phone-role-line">{getDisplayName()} · {stockOnly ? 'Magasinier' : 'Terrain'}</span>
          </div>
        </div>
        <div className="phone-top-actions">
          <div className="phone-user-chip">
            <strong>{getDisplayName()}</strong>
            <span>{stockOnly ? 'Magasinier' : 'Terrain'}</span>
          </div>
          <button
            type="button"
            className="phone-icon-btn"
            onClick={() => navigate('/m/inbox')}
            aria-label={pending > 0 ? `${pending} notification${pending > 1 ? 's' : ''}` : 'Notifications'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {pending > 0 && <span className="phone-notification-badge">{pending > 9 ? '9+' : pending}</span>}
          </button>
          <div className="phone-account-wrap">
            <button
              type="button"
              className="phone-icon-btn phone-profile-btn"
              title="Compte"
              aria-label={`Compte ${getDisplayName()}`}
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((v) => !v)}
            >
              {getAvatarUrl() ? (
                <img key={`pav-${profileTick}`} className="phone-avatar-img" src={getAvatarUrl()} alt="" width={28} height={28} loading="lazy" decoding="async" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21a8 8 0 0 0-16 0" />
                  <circle cx="12" cy="8" r="4" />
                </svg>
              )}
            </button>
            {accountOpen && (
              <>
                <div className="phone-account-backdrop" onClick={() => setAccountOpen(false)} aria-hidden />
                <div className="phone-account-menu" role="menu">
                  <div className="ph-menu-meta">
                    <strong key={`pnm-${profileTick}`}>{getDisplayName()}</strong>
                    <div>{roleLabel} · @{getUsername() || '—'}</div>
                    <div>v{APP_VERSION}</div>
                  </div>
                  {canAccessSettings() && (
                    <button
                      type="button"
                      role="menuitem"
                      className="ph-menu-item"
                      onClick={() => {
                        setAccountOpen(false);
                        navigate('/m/settings');
                      }}
                    >
                      {canAccessSettingsBeyondProfile() ? 'Paramètres' : 'Mon profil'}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="ph-menu-item ph-menu-item-row"
                    onClick={() => {
                      const next = density === 'compact' ? 'comfortable' : 'compact';
                      setDensity(next);
                      setDensityState(next);
                    }}
                  >
                    <span>Densité</span>
                    <span className="ph-menu-val">{density === 'compact' ? 'Compact' : 'Confort'}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="ph-menu-item ph-menu-item-row"
                    disabled={density === 'compact'}
                    onClick={() => {
                      if (density === 'compact') return;
                      const next = !glassOn;
                      setGlassEnabled(next);
                      setGlassOn(next);
                    }}
                  >
                    <span>Liquid glass</span>
                    <span className="ph-menu-val">
                      {density === 'compact'
                        ? 'Off (Compact)'
                        : isLiquidGlassActive()
                          ? 'Activé'
                          : 'Désactivé'}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="ph-menu-item ph-menu-danger"
                    onClick={async () => {
                      setAccountOpen(false);
                      const ok = await uiConfirm({
                        title: 'Déconnexion',
                        message: `Se déconnecter (${getDisplayName()}) ?`,
                        confirmLabel: 'Déconnecter',
                        cancelLabel: 'Rester',
                        danger: true,
                      });
                      if (ok) {
                        clearToken();
                        window.location.href = '/login';
                      }
                    }}
                  >
                    Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {booting && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: '#6b7c76', background: '#f5f2eb' }}>
          Synchronisation…
        </div>
      )}
      <main className="phone-main">
        <Routes>
          <Route
            path="/"
            element={
              <PhoneHome
                productCount={products.length}
                lowCount={lowCount}
                pending={pending}
                todaySales={todaySales}
                actions={actions.filter((a) => a.status === 'pending').slice(0, 4)}
                onScan={() => navigate('/m/scan')}
                onBoîte={() => navigate('/m/inbox')}
              />
            }
          />
          <Route
            path="/scan"
            element={
              <PhoneScan
                products={products}
                actions={actions}
                onSent={async () => {
                  show('Envoyé au PC');
                  await refresh();
                }}
                onToast={show}
              />
            }
          />
          <Route
            path="/products"
            element={<PhoneProduits products={products} actions={actions} onRefresh={() => refresh(true)} onToast={show} />}
          />
          <Route
            path="/inbox"
            element={<PhoneBoîte actions={actions} onRefresh={() => refresh(true)} />}
          />
          <Route
            path="/vente"
            element={
              allowSell ? (
                <PhoneVente
                  products={products}
                  onDone={async (msg) => {
                    show(msg || 'Vente encaissée');
                    await refresh();
                  }}
                  onToast={show}
                />
              ) : (
                <div className="phone-panel"><p className="ph-perm-banner">Rôle magasinier : pas de vente. Utilisez Scan ou Produits.</p></div>
              )
            }
          />
          <Route
            path="/invoice"
            element={
              allowSell ? (
                <PhoneInvoice
                  products={products}
                  onDone={async () => {
                    show('Devis créé — à confirmer sur le PC');
                    await refresh();
                  }}
                  onToast={show}
                />
              ) : (
                <div className="phone-panel"><p className="ph-perm-banner">Rôle magasinier : pas de devis / caisse.</p></div>
              )
            }
          />
          <Route path="/more" element={<PhoneMore />} />
          <Route path="/settings" element={<PhoneSettings />} />
          <Route path="/bills" element={allowSell ? <PhoneBills onToast={show} /> : <div className="phone-panel"><p className="ph-perm-banner">Rôle magasinier : pas d’achats.</p></div>} />
          <Route path="/warehouse" element={<PhoneWarehouse onToast={show} />} />
          <Route path="/agent" element={<PhoneAgentMobile />} />

          <Route path="*" element={<PhoneHome productCount={products.length} lowCount={lowCount} pending={pending} todaySales={stockOnly ? 0 : todaySales} actions={[]} onScan={() => navigate('/m/scan')} onBoîte={() => navigate('/m/inbox')} stockOnly={stockOnly} />} />
        </Routes>
      </main>

      <nav className="phone-tabbar" aria-label="Navigation principale">
        <NavLink to="/m" end className={({ isActive }) => (isActive ? 'ptab active' : 'ptab')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" /></svg>
          Accueil
        </NavLink>
        <NavLink to="/m/scan" className={({ isActive }) => (isActive ? 'ptab active' : 'ptab')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M7 12h10" /></svg>
          Scan
        </NavLink>
        <NavLink to="/m/warehouse" className={({ isActive }) => (isActive ? 'ptab active' : 'ptab')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 9l9-5 9 5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><path d="M9 22V12h6v10"/></svg>
          Entrepôt
        </NavLink>
        <NavLink to="/m/agent" className={({ isActive }) => (isActive ? 'ptab active' : 'ptab')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><circle cx="18" cy="6" r="1.2" fill="currentColor" stroke="none"/></svg>
          AI Agent
        </NavLink>
      </nav>
      {toast && <div className="phone-toast">{toast}</div>}
      <Suspense fallback={null}><AtlasAgent /></Suspense>
    </div>
  );
}

function PhoneHome({
  productCount, lowCount, pending, todaySales, actions, onScan, onBoîte, stockOnly = false,
}: {
  productCount: number; lowCount: number; pending: number; todaySales: number;
  actions: Action[]; onScan: () => void; onBoîte: () => void; stockOnly?: boolean;
}) {
  return (
    <div>
      <p className="ph-eyebrow">{formatDateFR()} · CASABLANCA</p>
      <h1 className="ph-title">Bonjour, {getDisplayName()}.</h1>
      <p className="ph-sub">
        {stockOnly
          ? 'Mode magasinier : scan, contrôle stock et propositions produit. Pas de caisse.'
          : 'Votre surface de vente est synchronisée. Voici ce qui mérite votre attention.'}
      </p>
      <button type="button" className="ph-cta" onClick={onScan}>
        <span className="ph-cta-ico">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M7 12h10"/></svg>
        </span>
        <span className="ph-cta-text">
          <strong>Scanner le stock</strong>
          <span>Votre prochaine action prend 10 secondes.</span>
        </span>
        <span>→</span>
      </button>
      <div className="ph-stats">
        <div className="ph-stat mint"><span className="lbl">Produits actifs</span><strong>{productCount}</strong><span className="hint">dans le catalogue</span></div>
        <div className="ph-stat peach"><span className="lbl">Stock bas</span><strong>{lowCount}</strong><span className="hint">à vérifier en rayon</span></div>
        <div className="ph-stat rose"><span className="lbl">À traiter</span><strong>{pending}</strong><span className="hint">envois mobile</span></div>
        {!stockOnly && (
          <div className="ph-stat white"><span className="lbl">Ventes du jour</span><strong>{todaySales} MAD</strong><span className="hint">toutes factures</span></div>
        )}
      </div>
      <div className="ph-panel">
        <div className="ph-panel-head">
          <div>
            <div className="ph-section">Prochaines actions</div>
            <p className="ph-sub" style={{ fontSize: 13 }}>Traitez les envois du terrain.</p>
          </div>
          <button type="button" className="ph-chip" onClick={onBoîte}>Voir la boîte →</button>
        </div>
        {actions.length === 0 && (
        <div className="ph-empty">
          <div className="ph-empty-ico" aria-hidden><IconInbox size={28} /></div>
          <h2>Aucun envoi</h2>
          <p>Aucun envoi en attente.</p>
        </div>
      )}
        {actions.map((a) => (
          <div className="ph-row ph-card" key={a.id}>
            <div className={`ph-ico ${a.type}`}>{a.type === 'stock_check' ? 'ST' : 'SC'}</div>
            <div>
              <div className="ph-meta">{a.type} · {a.created_at?.slice(0, 16)}</div>
              <div className="ph-row-title">{a.title}</div>
              <div className="ph-row-detail">{a.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhoneScan({
  products, actions, onSent, onToast,
}: {
  products: Product[]; actions: Action[]; onSent: () => void; onToast: (m: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hubSnap, setHubSnap] = useState<any>(null);
  const [outboxN, setOutboxN] = useState(0);
  const [camPermission, setCamPermission] = useState<'unknown' | 'granted' | 'denied' | 'unavailable'>('unknown');
  const readerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [decision, setDecision] = useState<null | {
    code: string;
    found: Product | null;
    offline: boolean;
  }>(null);
  const [addNow, setAddNow] = useState(false);
  const [countedStock, setCountedStock] = useState('');
  const [np, setNp] = useState({ name: '', sku: '', barcode: '', price: '', stock: '0', image_data_url: '' });
  const navigate = useNavigate();

  // Warm scanner script while the user is on this screen (faster first Caméra).
  useEffect(() => {
    preloadBarcodeScanner();
  }, []);

  const stopCamera = () => {
    try { (streamRef as any).stopScan?.(); } catch { /* */ }
    (streamRef as any).stopScan = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    // html5-qrcode owns the only camera/video element. Do not also call
    // getUserMedia here or Android will show two previews and decode neither.
    if (readerRef.current) readerRef.current.innerHTML = '';
    setScanning(false);
  };

  useEffect(() => () => stopCamera(), []);

  const closeDecision = () => {
    if (busy) return;
    setDecision(null);
    setAddNow(false);
    setCountedStock('');
  };


  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const n = await countOutbox();
        if (!stopped) setOutboxN(n);
      } catch { /* */ }
      try {
        if (isOnline()) {
          const res = await api.getHubSnapshot();
          if (!stopped) setHubSnap(res.data);
        }
      } catch { /* */ }
    };
    void tick();
    const id = window.setInterval(tick, 20000);
    // Preload WASM scanner engine (P3)
    try { void prepareZXing?.(); } catch { /* */ }
    return () => { stopped = true; window.clearInterval(id); };
  }, []);

  const startCamera = async () => {
    if (busy) return;
    try {
      stopCamera();
      setDecision(null);
      setAddNow(false);
      // Probe permission first for clear UX (especially iOS / low-end)
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamPermission('unavailable');
        onToast('Caméra non supportée sur cet appareil — utilisez Image ou saisie');
        return;
      }
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
        probe.getTracks().forEach((t) => t.stop());
        setCamPermission('granted');
      } catch (pe: any) {
        const name = String(pe?.name || '');
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCamPermission('denied');
          onToast('Permission caméra refusée — autorisez-la dans Réglages, ou utilisez Image');
          return;
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setCamPermission('unavailable');
          onToast('Aucune caméra détectée — utilisez Image ou saisie');
          return;
        }
        // Other errors: still try scanner (may recover)
        setCamPermission('unknown');
      }
      setScanning(true);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const reader = readerRef.current;
      if (!reader) {
        onToast('Caméra non prête — réessayez');
        setScanning(false);
        return;
      }
      const stop = await startBarcodeScan(
        reader,
        (scanned) => {
          if (!isBarcodeLike(scanned)) {
            onToast('Code non reconnu comme code-barres');
            return;
          }
          setCode(scanned);
          try { navigator.vibrate?.(40); } catch { /* */ }
          stopCamera();
          void resolveCode(scanned);
        },
        (msg) => {
          onToast(msg);
          stopCamera();
        }
      );
      (streamRef as any).stopScan = stop;
    } catch (e: any) {
      stopCamera();
      const name = String(e?.name || '');
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setCamPermission('denied');
      onToast(e?.message || 'Caméra indisponible — utilisez Image ou saisissez le code');
    }
  };

  const resolveCode = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    setBusy(true);
    // Always clear previous modal so only ONE popup shows
    setDecision(null);
    setAddNow(false);
    setCountedStock('');
    try {
      let found: Product | null = null;
      let offline = false;
      if (isOnline()) {
        try {
          const res = await api.scanBarcode(c);
          found = (res as any).data as Product;
        } catch (e: any) {
          if (e.status === 404 || e.code === 'NOT_FOUND') {
            found = (await lookupOffline(c)) as Product | null;
            offline = !!found;
          } else {
            found = (await lookupOffline(c)) as Product | null;
            offline = !!found;
            if (!found && !isOnline()) offline = true;
          }
        }
      } else {
        found = (await lookupOffline(c)) as Product | null;
        offline = true;
      }
      if (!found && isOnline()) {
        found = (await lookupOffline(c)) as Product | null;
      }
      if (found) {
        setCountedStock(String(stockOf(found)));
        setAddNow(false);
        setDecision({ code: c, found, offline: !isOnline() || offline });
      } else {
        setNp((s) => ({ ...s, barcode: c, sku: c.slice(-8) }));
        setAddNow(true);
        setDecision({ code: c, found: null, offline: !isOnline() || offline });
      }
    } catch (e: any) {
      onToast(e.message || 'Erreur scan');
    } finally {
      setBusy(false);
    }
  };

  const queueOrSend = async (payload: {
    type: 'scan' | 'stock_check' | 'new_product' | 'invoice';
    title: string;
    detail?: string;
    barcode?: string;
    product_id?: number;
    meta?: Record<string, unknown>;
  }) => {
    if (!isOnline()) {
      await enqueueOutboxAndSync(payload);
      onToast('Hors ligne — action mise en file d\'attente');
      setDecision(null);
      setAddNow(false);
      setCountedStock('');
      return;
    }
    await api.createMobileAction({ ...payload, created_by: 'mobile' });
    await onSent();
    setDecision(null);
    setAddNow(false);
    setCountedStock('');
  };

  const confirmFound = async () => {
    if (!decision?.found) return;
    const f = decision.found;
    setBusy(true);
    try {
      addToPhoneCart(f.id);
      onToast(`${f.name} ajouté au panier`);
      setDecision(null);
      setAddNow(false);
      navigate('/m/invoice');
      setCode('');
    } catch (e: any) {
      onToast(e.message || 'Erreur envoi');
    } finally {
      setBusy(false);
    }
  };

  /** Ajuster le stock: send counted qty to PC for approval (does not change stock until PC approves). */
  const adjustStock = async () => {
    if (!decision?.found) return;
    const proposed = Number(countedStock);
    if (!Number.isFinite(proposed) || proposed < 0) {
      onToast('Saisissez un stock valide (≥ 0)');
      return;
    }
    const current = stockOf(decision.found);
    setBusy(true);
    try {
      await queueOrSend({
        type: 'stock_check',
        title: `Ajuster le stock · ${decision.found.name}`,
        detail: `Scan ${decision.code} · système ${current} → compté ${proposed} · min ${minOf(decision.found)}`,
        barcode: decision.code,
        product_id: decision.found.id,
        meta: {
          offline: decision.offline,
          stock: current,
          proposed_stock: proposed,
          needs_approval: true,
          adjust_stock: true,
        },
      });
      setCode('');
      onToast('Ajustement envoyé au PC pour approbation');
    } catch (e: any) {
      onToast(e.message || 'Erreur ajustement stock');
    } finally {
      setBusy(false);
    }
  };

  const sendToPcLater = async () => {
    if (!decision) return;
    setBusy(true);
    try {
      await queueOrSend({
        type: 'new_product',
        title: `Produit à créer · ${decision.code}`,
        detail: `Code ${decision.code} · produit non reconnu — approbation PC requise`,
        barcode: decision.code,
        meta: { needs_approval: true, create_product: true },
      });
      setCode('');
      onToast('Envoyé au PC pour création');
    } catch (e: any) {
      onToast(e.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const createNow = async () => {
    if (!decision) return;
    if (!np.name.trim() || !np.sku.trim()) {
      onToast('Nom et SKU obligatoires');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: np.name.trim(),
        sku: np.sku.trim().toUpperCase(),
        barcode: np.barcode.trim() || decision.code,
        unit_price: Number(np.price) || 0,
        price: Number(np.price) || 0,
        stock_quantity: Number(np.stock) || 0,
        category: 'Épicerie',
      };
      if (np.image_data_url) body.image_data_url = np.image_data_url;
      if (!isOnline()) {
        await enqueueOutboxAndSync({
          type: 'new_product',
          title: `Nouveau produit (offline): ${body.name}`,
          detail: `${body.sku} · ${body.barcode}`,
          barcode: String(body.barcode || ''),
          meta: { create_product_body: body, needs_approval: true, image_data_url: np.image_data_url || undefined },
        });
        onToast('Hors ligne — produit en file pour le PC');
        setDecision(null);
        setAddNow(false);
        setCode('');
        return;
      }
      await queueOrSend({
        type: 'new_product',
        title: `Produit inconnu · ${body.name}`,
        detail: `${body.sku} · ${body.price} MAD · code ${body.barcode}`,
        barcode: String(body.barcode || ''),
        meta: { needs_approval: true, create_product_body: body, image_data_url: np.image_data_url || undefined },
      });
      setNp({ name: '', sku: '', barcode: '', price: '', stock: '0', image_data_url: '' });
      setCode('');
      onToast('Produit inconnu enregistré — le PC pourra le créer');
    } catch (e: any) {
      onToast(e.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const shelf = async () => {
    setBusy(true);
    try {
      await queueOrSend({
        type: 'stock_check',
        title: 'Contrôle rayon',
        detail: 'Demande depuis le téléphone',
      });
    } catch (e: any) {
      onToast(e.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const today = actions.filter((a) => (a.created_at || '').startsWith(new Date().toISOString().slice(0, 10)));

  return (
    <div>
      <div className="ph-phone-card">
         <p className="ph-eyebrow" style={{ color: 'rgba(255,255,255,0.7)' }}>Mode téléphone · {isOnline() ? 'En ligne' : 'Hors ligne'}</p>
        <h2>Que scannez-vous ?</h2>
        {(outboxN > 0 || (hubSnap && hubSnap.pending > 0)) && (
          <p className="ph-hub-badge" role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span>
              {outboxN > 0 && <span>{outboxN} action(s) hors ligne en attente de sync</span>}
              {outboxN > 0 && hubSnap?.pending > 0 && ' · '}
              {hubSnap?.pending > 0 && <span>{hubSnap.pending} en attente sur le PC</span>}
              {hubSnap?.lowStock > 0 && <span> · {hubSnap.lowStock} stock bas</span>}
            </span>
            {outboxN > 0 && isOnline() && (
              <button
                type="button"
                className="ph-chip on"
                style={{ margin: 0, padding: '4px 10px', fontSize: 12 }}
                onClick={() => void (window as any).__atlasFlushOutbox?.()}
              >
                Synchroniser maintenant
              </button>
            )}
          </p>
        )}
         <p className="ph-scan-help">
           1) Ouvrez <strong>Caméra</strong> · 2) Placez le code dans le cadre jaune · 3) Tenez stable 1 s.
           Le code peut être un peu décalé. Si ça échoue : <strong>Image</strong> ou saisie manuelle.
         </p>

        {camPermission === 'denied' && (
          <div className="ph-perm-banner" role="alert">
            <strong>Caméra bloquée</strong>
            <p>
              Autorisez la caméra pour ce site dans les réglages du navigateur (iPhone : Réglages → Safari → Caméra),
              puis appuyez à nouveau sur Caméra. Sinon utilisez <em>Image</em> ou la saisie manuelle.
            </p>
          </div>
        )}
        {camPermission === 'unavailable' && (
          <div className="ph-perm-banner warn" role="status">
            <strong>Caméra indisponible</strong>
            <p>Cet appareil n&apos;expose pas de caméra. Utilisez l&apos;import d&apos;image ou saisissez le code.</p>
          </div>
        )}

        <div className="ph-cam-wrap" style={{ display: scanning ? 'block' : 'none' }} aria-hidden={!scanning}>
          <div ref={readerRef} id="ph-h5-reader" data-h5-reader="1" className="ph-h5-reader" />
          {scanning && (
            <>
              <div className="ph-cam-outline" aria-hidden="true">
                <span className="ph-cam-outline-corner tl" />
                <span className="ph-cam-outline-corner tr" />
                <span className="ph-cam-outline-corner bl" />
                <span className="ph-cam-outline-corner br" />
                <div className="ph-cam-outline-bar" />
              </div>
              <p className="ph-cam-hint">Cadre jaune · bonne lumière · ne bougez pas</p>
              <button type="button" className="ph-cam-close" onClick={stopCamera}>Fermer</button>
            </>
          )}
        </div>
        <label>Code-barres ou SKU</label>
        <div className="ph-scan-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resolveCode(code)}
            placeholder="Scannez ou saisissez un code"
            inputMode="numeric"
          />
          <button type="button" disabled={busy} onClick={() => resolveCode(code)}>Envoyer</button>
        </div>
        <div className="ph-phone-actions">
          <button type="button" onClick={scanning ? stopCamera : startCamera}>{scanning ? 'Arrêter' : 'Caméra'}</button>
          {scanning && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                   const liveVideo = readerRef.current?.querySelector('video') as HTMLVideoElement | null;
                   const decoded = await captureAndDecode(liveVideo);
                  if (decoded) {
                    setCode(decoded);
                    try { navigator.vibrate?.(40); } catch { /* */ }
                    stopCamera();
                    await resolveCode(decoded);
                  } else {
                    onToast('Aucun code — rapprochez le code, lumière, ou Image / saisie');
                  }
                } catch (e: any) {
                  onToast(e?.message || 'Échec lecture');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Photo
            </button>
          )}
          <label className="ph-file-label" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setBusy(true);
                onToast('Lecture de l\'image…');
                try {
                  // Multi-pass: full image, crops, rotations — barcode need not be centered
                  const decoded = await decodeImageFile(f);
                  if (decoded) {
                    setCode(decoded);
                    try { navigator.vibrate?.(40); } catch { /* */ }
                    stopCamera();
                    await resolveCode(decoded);
                  } else {
                    onToast('Aucun code-barres dans l\'image — recadrez ou saisissez le code');
                  }
                } catch (err: any) {
                  onToast(err?.message || 'Erreur image — saisissez le code manuellement');
                } finally {
                  setBusy(false);
                }
              }}
            />
            <span className="ph-chip" style={{ cursor: 'pointer' }}>Image</span>
          </label>
          <button type="button" disabled={busy} onClick={shelf}>Contrôle rayon</button>
        </div>
      </div>

      <div className="ph-section" style={{ marginTop: 8 }}>Envoyés aujourd&apos;hui</div>
      {today.length === 0 && (
        <div className="ph-empty">
          <div className="ph-empty-ico" aria-hidden><IconInbox size={28} /></div>
          <h2>Rien aujourd&apos;hui</h2>
          <p>Rien d&apos;envoyé aujourd&apos;hui.</p>
        </div>
      )}
      {today.map((a) => (
        <div className="ph-row ph-card" key={a.id}>
          <div className={`ph-ico ${a.type}`}>{a.type.slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="ph-meta">{a.type} · {a.created_at?.slice(0, 16)}</div>
            <div className="ph-row-title">{a.title}</div>
            <div className="ph-row-detail">{a.detail}</div>
          </div>
        </div>
      ))}

      {/* Single modal only: found product → adjust stock (no second popup) */}
      {decision && decision.found && !addNow && (
        <div className="ph-modal-bg" onClick={closeDecision}>
          <div className="ph-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Ajuster le stock</h3>
            <p className="ph-sub" style={{ marginBottom: 12 }}>
              Code <strong>{decision.code}</strong>
              {decision.offline ? ' · mode hors ligne / cache' : ''}
            </p>
            <div className="ph-row-title">{decision.found.name}</div>
            <div className="ph-row-detail" style={{ marginBottom: 12 }}>
              Stock système : <strong>{stockOf(decision.found)}</strong> · min {minOf(decision.found)}
              {!isStockRole() && <> · {priceOf(decision.found)} MAD</>}
            </div>
            <label>Stock compté en rayon</label>
            <input
              value={countedStock}
              onChange={(e) => setCountedStock(e.target.value)}
              inputMode="numeric"
              placeholder="Quantité réelle"
              autoFocus
            />
            <p className="ph-sub" style={{ marginTop: 8, marginBottom: 12 }}>
              L&apos;ajustement est envoyé au PC pour approbation avant d&apos;être appliqué.
            </p>
            <div className="ph-modal-actions" style={{ flexDirection: 'column' }}>
              <button type="button" className="ph-cta" style={{ margin: 0 }} disabled={busy} onClick={adjustStock}>
                Ajuster le stock → PC
              </button>
              {!isStockRole() && (
              <button type="button" className="ph-chip" style={{ width: '100%' }} disabled={busy} onClick={confirmFound}>
                Ajouter au devis
              </button>
              )}
              <button type="button" className="ph-chip" style={{ width: '100%' }} onClick={closeDecision}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single modal only: unknown product */}
      {decision && !decision.found && addNow && (
        <div className="ph-modal-bg" onClick={closeDecision}>
          <div className="ph-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Produit inconnu</h3>
            <p className="ph-sub" style={{ marginBottom: 12 }}>
              Code <strong>{decision.code}</strong>
              {decision.offline ? ' · hors ligne' : ''}
            </p>
            <p className="ph-sub" style={{ marginBottom: 12 }}>
              Donnez-lui un nom. Il sera envoyé au PC pour création / approbation.
            </p>
            <label>Nom</label>
            <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="Nom du produit" />
            <label>Réf. (SKU)</label>
            <input value={np.sku} onChange={(e) => setNp({ ...np, sku: e.target.value })} />
            <label>Code-barres</label>
            <input value={np.barcode} onChange={(e) => setNp({ ...np, barcode: e.target.value })} />
            {!isStockRole() && (
              <>
                <label>Prix (MAD)</label>
                <input value={np.price} onChange={(e) => setNp({ ...np, price: e.target.value })} inputMode="decimal" />
              </>
            )}
            <label>Stock initial</label>
            <input value={np.stock} onChange={(e) => setNp({ ...np, stock: e.target.value })} inputMode="numeric" />
            <label>Photo (caméra seulement — le PC verra l’image)</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2_500_000) {
                  onToast('Photo trop lourde (max ~2,5 Mo)');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const data = String(reader.result || '');
                  if (data.length > 3_500_000) {
                    onToast('Image trop grande');
                    return;
                  }
                  setNp((s) => ({ ...s, image_data_url: data }));
                  onToast('Photo jointe — le bureau la verra');
                };
                reader.readAsDataURL(f);
              }}
            />
            {np.image_data_url ? (
              <p className="ph-sub" style={{ marginTop: 6 }}>Photo prise ✓ (non affichée ici)</p>
            ) : null}
            <div className="ph-modal-actions" style={{ flexDirection: 'column', gap: 8 }}>
              <button type="button" className="ph-cta" style={{ margin: 0 }} disabled={busy} onClick={createNow}>
                Envoyer au PC
              </button>
              <button type="button" className="ph-chip" style={{ width: '100%' }} disabled={busy} onClick={sendToPcLater}>
                Code seul → PC
              </button>
              <button type="button" className="ph-chip" style={{ width: '100%' }} onClick={closeDecision}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneProduits({
  products, actions, onRefresh, onToast,
}: {
  products: Product[];
  actions?: Action[];
  onRefresh: () => void;
  onToast: (m: string) => void;
}) {
  const hideMoney = isStockRole();
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'newest' | 'oldest' | 'name'>('newest');

  // Products that were approved from mobile (new_product done, or stock_check done with product_id)
  const approvedIds = useMemo(() => {
    const map = new Map<number, string>(); // product_id → completed_at / created_at
    for (const a of actions || []) {
      if (a.status !== 'done') continue;
      if (a.product_id) {
        const t = a.completed_at || a.created_at || '';
        const prev = map.get(a.product_id);
        if (!prev || t > prev) map.set(a.product_id, t);
      }
    }
    return map;
  }, [actions]);

  const list = products
    .filter((p) => {
      if (lowOnly && stockOf(p) >= minOf(p)) return false;
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return (
        (p.name || '').toLowerCase().includes(s) ||
        (p.sku || '').toLowerCase().includes(s) ||
        (p.barcode || '').includes(s)
      );
    })
    .slice()
    .sort((a, b) => {
      if (sortMode === 'name') return (a.name || '').localeCompare(b.name || '', 'fr');
      const ta = approvedIds.get(a.id) || (a as any).updated_at || (a as any).created_at || '';
      const tb = approvedIds.get(b.id) || (b as any).updated_at || (b as any).created_at || '';
      if (sortMode === 'newest') return tb.localeCompare(ta) || b.id - a.id;
      return ta.localeCompare(tb) || a.id - b.id;
    });

  const approvedRecent = list.filter((p) => approvedIds.has(p.id)).slice(0, 12);

  return (
    <div>
      <p className="ph-eyebrow">Catalogue</p>
      <h1 className="ph-title">Produits</h1>
      <p className="ph-sub">Vue claire de chaque article en rayon · approuvés inclus.</p>
      <div className="ph-toolbar">
        <input className="ph-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher nom, SKU ou code-barres" />
        <button type="button" className={`ph-chip ${lowOnly ? 'on' : ''}`} onClick={() => setLowOnly((v) => !v)}>Stock bas</button>
      </div>
      <div className="ph-tabs" style={{ marginBottom: 10 }}>
        {([
          ['newest', 'Plus récents'],
          ['oldest', 'Plus anciens'],
          ['name', 'Nom'],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" className={sortMode === k ? 'on' : ''} onClick={() => setSortMode(k)}>
            {label}
          </button>
        ))}
      </div>

      {approvedRecent.length > 0 && !q && !lowOnly && (
        <>
          <div className="ph-section">Approuvés (PC) · {sortMode === 'oldest' ? 'plus anciens' : 'plus récents'}</div>
          {approvedRecent.map((p) => {
            const low = stockOf(p) < minOf(p);
            return (
              <div className="ph-prod" key={`ap-${p.id}`}>
                <div>
                  <div className="ph-row-title">{p.name}</div>
                  <div className="ph-row-detail">{p.sku} · {p.barcode}</div>
                  <div className="ph-meta">Approuvé {approvedIds.get(p.id)?.slice(0, 16)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={low ? 'ph-low' : ''}>{stockOf(p)} / min {minOf(p)}</div>
                  {!hideMoney && <div className="ph-row-title">{priceOf(p)} MAD</div>}
                  <span className="ph-badge ok">Approuvé</span>
                </div>
              </div>
            );
          })}
          <div className="ph-section" style={{ marginTop: 12 }}>Tout le catalogue</div>
        </>
      )}

      {list.map((p) => {
        const low = stockOf(p) < minOf(p);
        const wasApproved = approvedIds.has(p.id);
        return (
          <div className="ph-prod" key={p.id}>
            <div>
              <div className="ph-row-title">{p.name}</div>
              <div className="ph-row-detail">{p.sku} · {p.barcode}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={low ? 'ph-low' : ''}>{stockOf(p)} / min {minOf(p)}</div>
              {!hideMoney && <div className="ph-row-title">{priceOf(p)} MAD</div>}
              <span className={`ph-badge ${low ? 'bad' : 'ok'}`}>
                {wasApproved ? 'Approuvé' : low ? 'À réappro' : 'OK'}
              </span>
            </div>
          </div>
        );
      })}
      {list.length === 0 && (
        <div className="ph-empty">
          <div className="ph-empty-ico" aria-hidden><IconPackage size={28} /></div>
          <h2>Aucun produit</h2>
          <p>Ajoutez des articles pour gérer le stock.</p>
        </div>
      )}
      <button type="button" className="ph-chip" style={{ marginTop: 12 }} onClick={() => { onRefresh(); onToast('Catalogue actualisé'); }}>Actualiser</button>
    </div>
  );
}

function PhoneBoîte({ actions, onRefresh }: { actions: Action[]; onRefresh: () => void }) {
  const [tab, setTab] = useState<'pending' | 'done' | 'all'>('pending');
  const list = actions.filter((a) => {
    if (tab === 'pending') return a.status === 'pending';
    if (tab === 'done') return a.status === 'done' || a.status === 'cancelled';
    return true;
  });
  const rejectReason = (a: Action) => {
    try {
      const m = a.meta_json ? JSON.parse(a.meta_json) : {};
      return m.reject_reason || '';
    } catch {
      return '';
    }
  };
  const statusLabel = (s: string) =>
    s === 'pending' ? 'En attente' : s === 'done' ? 'Traité' : s === 'cancelled' ? 'Refusé' : s;
  return (
    <div>
      <p className="ph-eyebrow">Espace partagé</p>
      <h1 className="ph-title">Boîte d'actions</h1>
      <p className="ph-sub">Vos envois vers le PC (lecture seule).</p>
      <div className="ph-tabs-row">
        <div className="ph-tabs">
          {(['pending', 'done', 'all'] as const).map((tk) => (
            <button key={tk} type="button" className={tab === tk ? 'on' : ''} onClick={() => setTab(tk)}>{tk === 'pending' ? 'En attente' : tk === 'done' ? 'Terminées' : 'Toutes'}</button>
          ))}
        </div>
        <button type="button" className="ph-chip ph-refresh-inline" onClick={onRefresh}>Actualiser</button>
      </div>
      <div className="ph-card-list">
      {list.map((a) => (
        <div className="ph-row ph-card" key={a.id}>
          <div className={`ph-ico ${a.type}`}>{a.type.slice(0, 2).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ph-meta">{a.type} · {a.created_at?.slice(0, 16)}</div>
            <div className="ph-row-title">{a.title}</div>
            <div className="ph-row-detail">{a.detail}</div>
            {a.status === 'cancelled' && rejectReason(a) ? (
              <div className="ph-row-detail" style={{ color: '#b45309', marginTop: 4 }}>
                Refus PC : {rejectReason(a)}
              </div>
            ) : null}
          </div>
          <span className={`ph-badge ${a.status === 'done' ? 'ok' : 'bad'}`}>{statusLabel(a.status)}</span>
        </div>
      ))}
      </div>
      {list.length === 0 && (
        <div className="ph-empty">
          <div className="ph-empty-ico" aria-hidden><IconInbox size={28} /></div>
          <h2>Vide</h2>
          <p>Aucun élément à afficher.</p>
        </div>
      )}
    </div>
  );
}


function PhoneVente({
  products, onDone, onToast,
}: {
  products: Product[];
  onDone: (msg?: string) => void | Promise<void>;
  onToast: (m: string) => void;
}) {
  const [sel, setSel] = useState<Record<number, number>>(() => loadPhoneCart());
  const [payMode, setPayMode] = useState<'cash' | 'card' | 'credit'>('cash');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const lines = Object.entries(sel)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const p = products.find((x) => x.id === Number(id))!;
      const unit = priceOf(p);
      return {
        product_id: p.id,
        product_name: p.name,
        quantity: qty,
        unit_price: unit,
        tax_rate: 0,
        line_ht: qty * unit,
      };
    });
  const subtotal = lines.reduce((s, i) => s + i.line_ht, 0);
  const total = subtotal;
  const count = lines.reduce((s, i) => s + i.quantity, 0);

  const filtered = products.filter((p) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (p.name || '').toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s);
  }).slice(0, 40);

  const add = (id: number) => {
    setSel((prev) => {
      const next = { ...prev, [id]: (prev[id] || 0) + 1 };
      try { savePhoneCart(next); } catch { /* */ }
      return next;
    });
  };
  const dec = (id: number) => {
    setSel((prev) => {
      const n = { ...prev };
      const v = (n[id] || 0) - 1;
      if (v <= 0) delete n[id];
      else n[id] = v;
      try { savePhoneCart(n); } catch { /* */ }
      return n;
    });
  };

  const encaisser = async () => {
    if (!lines.length || busy) return;
    setBusy(true);
    try {
      // Part B: phone only queues a request — NOT paid until PC validates
      const clientName = payMode === 'credit' ? 'Client crédit (terrain)' : 'Client de passage';
      const invBody = {
        client_name: clientName,
        status: 'sent',
        quick_sale: true,
        doc_kind: 'quick_sale',
        tax_exempt: true,
        notes: `Vente rapide téléphone · mode prévu : ${payMode === 'cash' ? 'Espèces' : payMode === 'card' ? 'Carte' : 'Crédit'} · en attente validation PC`,
        items: lines.map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          list_price: i.unit_price,
          tax_rate: 0,
        })),
      };
      const detail = `${count} article(s) · ${clientName} · ${Math.round(total)} MAD · ${payMode} · en attente PC`;
      await api.createMobileAction({
        type: 'invoice',
        title: `Vente rapide ${Math.round(total)} MAD`,
        detail,
        created_by: getUsername(),
        meta: {
          needs_approval: true,
          quick_sale: true,
          pay_mode: payMode,
          total,
          create_invoice_body: invBody,
        },
      });
      setSel({});
      try { savePhoneCart({}); } catch { /* */ }
      await onDone(`Envoyée au bureau — pas payée tant que le PC n’a pas validé (${Math.round(total)} MAD)`);
    } catch (e: any) {
      onToast(e.message || 'Échec envoi au PC');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="ph-eyebrow">Vente rapide</p>
      <h1 className="ph-title" style={{ fontSize: 24 }}>Panier</h1>
      <p className="ph-sub" style={{ marginBottom: 12 }}>{count} article{count !== 1 ? 's' : ''}</p>

      <div className="ph-panel" style={{ marginBottom: 12 }}>
        {lines.length === 0 && (
          <p style={{ color: '#6b7c76', fontSize: 14, margin: 0 }}>Ajoutez des produits ci-dessous.</p>
        )}
        {lines.map((i) => (
          <div key={i.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{i.product_name}</div>
              <div style={{ fontSize: 12, color: '#6b7c76' }}>{i.quantity}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="ph-chip" onClick={() => dec(i.product_id)} aria-label="Retirer">−</button>
              <strong>{Math.round(i.line_ht).toLocaleString('fr-FR')} MAD</strong>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {([
          ['cash', 'Espèces'],
          ['card', 'Carte'],
          ['credit', 'Crédit'],
        ] as const).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setPayMode(k)}
            style={{
              flex: 1,
              padding: '10px 8px',
              borderRadius: 999,
              border: payMode === k ? 'none' : '1px solid #e5e0d6',
              background: payMode === k ? '#0f4f4b' : '#fff',
              color: payMode === k ? '#fff' : '#1a1814',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {lab}
          </button>
        ))}
      </div>

      <div className="ph-panel" style={{ background: '#0f4f4b', color: '#fff', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 20 }}>
          <span>Total</span><span>{Math.round(total).toLocaleString('fr-FR')} MAD</span>
        </div>
      </div>

      <button
        type="button"
        disabled={!lines.length || busy}
        onClick={() => void encaisser()}
        style={{
          width: '100%',
          padding: '16px',
          border: 0,
          borderRadius: 14,
          background: '#e8a317',
          color: '#1a1814',
          /* label below: Envoyer au PC (pas payé) */
          fontWeight: 800,
          fontSize: 16,
          marginBottom: 16,
          opacity: !lines.length || busy ? 0.5 : 1,
        }}
      >
        {busy ? 'Envoi…' : 'Envoyer au PC (pas encore payé)'}
      </button>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher un produit…"
        style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid #e5e0d6', padding: '0 12px', marginBottom: 10 }}
      />
      <div className="ph-panel">
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => add(p.id)}
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              border: 0,
              borderBottom: '1px solid #f0ebe3',
              background: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={{ color: '#1a6b66', fontWeight: 700 }}>{Math.round(priceOf(p)).toLocaleString('fr-FR')} MAD</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PhoneInvoice({
  products, onDone, onToast,
}: {
  products: Product[]; onDone: () => void; onToast: (m: string) => void;
}) {
  const [sel, setSel] = useState<Record<number, number>>(() => takePhoneCart());
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [clientId, setClientId] = useState('');
  const [customer, setCustomer] = useState('Client de passage');
  const [newClient, setNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.getClients()
      .then((res: any) => setClients((res.data || []).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const items = Object.entries(sel)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const p = products.find((x) => x.id === Number(id))!;
      return { product_id: p.id, product_name: p.name, quantity: qty, unit_price: priceOf(p) };
    });
  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  const filteredProducts = products.filter((p) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (p.name || '').toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s);
  });

  const create = async () => {
    if (!items.length || busy) return;
    setBusy(true);
    try {
      let cid = clientId ? Number(clientId) : undefined;
      let cname = customer.trim() || 'Client de passage';
      if (newClient && newClientName.trim()) {
        try {
          const res: any = await api.createClient({ name: newClientName.trim() });
          cid = res.data?.id;
          cname = newClientName.trim();
        } catch (e: any) {
          onToast(e.message || 'Erreur client');
          setBusy(false);
          return;
        }
      } else if (cid) {
        const cl = clients.find((c) => c.id === cid);
        if (cl) cname = cl.name;
      }
      const inv: any = await api.createInvoice({
        client_id: cid || null,
        client_name: cname,
        status: 'quote',
        notes: 'Devis créé depuis le téléphone — à confirmer sur PC',
        items: items.map((i) => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          list_price: i.unit_price,
        })),
      });
      const invId = inv?.data?.id;
      await api.createMobileAction({
        // The handoff table intentionally uses "invoice" for both invoice
        // drafts and quote requests. "quote" is not a valid DB enum value.
        type: 'invoice',
        title: `Devis ${total} MAD`,
        detail: `${count} articles · ${cname} · en attente conversion PC`,
        meta: { quote_id: invId, needs_conversion: true },
        created_by: 'mobile',
      });
      setSel({});
      await onDone();
    } catch (e: any) {
      onToast(e.message || 'Erreur devis');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="ph-eyebrow">Devis terrain</p>
      <h1 className="ph-title">Créer un devis</h1>
      <p className="ph-sub">Devis sans impact stock. Le PC convertira en facture après confirmation client.</p>

      <div className="ph-panel" style={{ marginBottom: 14 }}>
        <div className="ph-section" style={{ marginBottom: 10 }}>Client</div>
        {!newClient ? (
          <>
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                const cl = clients.find((c) => String(c.id) === e.target.value);
                if (cl) setCustomer(cl.name);
              }}
              style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid #e5e0d6', padding: '0 12px', marginBottom: 8 }}
            >
              <option value="">Client de passage</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button type="button" className="ph-chip" onClick={() => setNewClient(true)}>+ Nouveau client</button>
          </>
        ) : (
          <>
            <input
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="Nom du nouveau client"
              style={{ width: '100%', height: 44, borderRadius: 12, border: '1px solid #e5e0d6', padding: '0 12px', marginBottom: 8 }}
            />
            <button type="button" className="ph-chip" onClick={() => setNewClient(false)}>Choisir existant</button>
          </>
        )}
      </div>

      <input
        className="ph-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filtrer les produits…"
        style={{ marginBottom: 10 }}
      />

      <div className="ph-panel" style={{ padding: 0, overflow: 'hidden' }}>
        {filteredProducts.map((p) => (
          <label key={p.id} className="ph-inv-item">
            <input
              type="checkbox"
              checked={!!sel[p.id]}
              onChange={() =>
                setSel((prev) => {
                  const n = { ...prev };
                  if (n[p.id]) delete n[p.id];
                  else n[p.id] = 1;
                  return n;
                })
              }
            />
            <div style={{ flex: 1 }}>
              <div className="ph-row-title">{p.name}</div>
              <div className="ph-row-detail">{p.sku} · {stockOf(p)} dispo</div>
            </div>
            {!isStockRole() && <strong>{priceOf(p)} MAD</strong>}
          </label>
        ))}
        {filteredProducts.length === 0 && (
        <div className="ph-empty">
          <div className="ph-empty-ico" aria-hidden><IconPackage size={28} /></div>
          <h2>Aucun produit</h2>
          <p>Aucun article ne correspond à la recherche.</p>
        </div>
      )}
      </div>

      <div className="ph-inv-box">
        <div className="ph-inv-line"><span>Client</span><span>{newClient ? (newClientName || '—') : (customer || 'Client de passage')}</span></div>
        <div className="ph-inv-line"><span>Articles</span><span>{count}</span></div>
        <div className="ph-inv-line"><span>TVA</span><span>Incluse</span></div>
        <div className="ph-inv-total"><span>Total</span><span>{total} MAD</span></div>
        <button type="button" className="ph-inv-go" disabled={!count || busy} onClick={create}>
          Envoyer le devis →
        </button>
      </div>
    </div>
  );
}


function PhoneAgentMobile() {
  useEffect(() => {
    try {
      sessionStorage.setItem('atlas_agent_open', '1');
      document.documentElement.classList.add('atlas-agent-docked');
      window.dispatchEvent(new CustomEvent('atlas-agent-open', { detail: { open: true } }));
    } catch { /* */ }
    return () => {
      try {
        sessionStorage.setItem('atlas_agent_open', '0');
        document.documentElement.classList.remove('atlas-agent-docked');
        window.dispatchEvent(new CustomEvent('atlas-agent-open', { detail: { open: false } }));
      } catch { /* */ }
    };
  }, []);
  return (
    <div className="phone-panel phone-agent-hint" style={{ marginTop: 8 }}>
      <h1 className="ph-title" style={{ fontSize: 20 }}>Atlas Agent</h1>
      <p className="ph-sub">Posez une question sur le stock, le scan ou les actions en attente.</p>
    </div>
  );
}
