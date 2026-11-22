/**
 * Phone-limited experience (APK + mobile browser).
 * Floor operator: scan, stock check, request product, see own sends.
 * Full ERP lives on PC shell only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings, Sparkles, ShoppingCart, Search, ScanLine, RefreshCw, Grid2X2, List, Package, MessageSquarePlus, Plus, Send, ChevronRight, Home, Bell, Bot, Wallet, Users, Receipt, Warehouse, FileText, Monitor, UserRound } from 'lucide-react';
import PhoneDeviceScan from './PhoneDeviceScan';
import PhoneBills from './PhoneBills';
import PhoneWarehouse from './PhoneWarehouse';
import PhoneSettings from './PhoneSettings';
import PhoneProfile from './PhoneProfile';
const PhoneWhatsNew = lazy(() => import('./PhoneWhatsNew'));
import PhoneDock, { canOpenPhoneBalance, canOpenPhoneEmployees, phoneBackTarget, phoneDockItems, phoneShowsBack, showPhoneDock } from './PhoneDock';
import { usePhoneTheme } from './usePhoneTheme';
import { usePhoneTopBar } from './usePhoneTopBar';
import { api, getBase } from '../api';
import { clearToken, getUsername, getDisplayInitials, hasAvatarUrl, getRole, setProfileCache, isStockRole, canSell, canAccessSettings, canAccessSettingsBeyondProfile } from '../auth';
import { setDensity, type UiScale } from '../lib/density';
import { APP_VERSION } from '../version';
import './phone.css';
import PageTransition from '../components/PageTransition';
import PhoneDialog from './PhoneDialog';
import { isSafeInventoryCode } from './phoneScan';
import { phoneStockQuantity as stockOf, phoneStockThreshold as minOf, phoneStockIsLow } from './phoneStock';
import PageSkeleton from '../components/PageSkeleton';
import { AvatarImage } from '../components/ui/AvatarImage';
import { useProfileWarm } from '../lib/useProfileWarm';
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
import { IconPackage, IconInbox } from '../components/Icons';
import OfflineBanner from '../components/OfflineBanner';
import PhoneHome from './PhoneHome';
import ProductArtwork from '../components/ProductArtwork';
import ProductHistory from '../pages/ProductHistory';
import PhoneProductCreate from './PhoneProductCreate';
import PhoneSkeleton from './PhoneSkeleton';
import PhoneQuickActions from './PhoneQuickActions';
import AtlasAgentMascot from './AtlasAgentMascot';
import { getScanPreference, phoneScanFeedback } from './phoneScanPreferences';


type Product = {
  id: number;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  stock_quantity?: number;
  stock?: number;
  min_stock?: number;
  low_stock_threshold?: number | null;
  track_inventory?: number | boolean | null;
  unit_price?: number;
  price?: number;
  image_url?: string | null;
  image_inline_large?: number;
};

type Action = {
  id: number;
  type: string;
  title: string;
  detail: string;
  status: string;
  created_at: string;
  barcode?: string;
  meta_json?: string | null;
};

const Balance = lazy(() => import('../pages/Balance'));
const PhoneBalance = lazy(() => import('./PhoneBalance'));
const Employees = lazy(() => import('../pages/Employees'));

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

function priceOf(p: Product) {
  return Number(p.unit_price ?? p.price ?? 0);
}

/* ─── v255 — Phone = twin of the Android app.
 * Role labels & scope summaries copied verbatim from the native Roles.kt so
 * both clients speak with the exact same words. ─── */
function androidRoleLabel(role: string | null | undefined): string {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'owner') return 'Propriétaire (Admin)';
  if (r === 'admin') return 'Administrateur';
  if (r === 'secretaire') return 'Secrétaire · Ventes';
  if (r === 'stock' || r === 'magasinier') return 'Magasinier · Stock';
  return 'Opérateur';
}

function androidScopeSummary(role: string | null | undefined): string {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'owner' || r === 'admin') return 'Accès complet : création directe produits, validations, finances & alertes globales';
  if (r === 'secretaire') return 'Accès Ventes & Caisse : facturation, stock & envoi direct des nouveaux produits à l\u2019Admin';
  if (r === 'stock' || r === 'magasinier') return 'Accès Entrepôt : inventaire, ajustements stock & demandes envoyées directement à l\u2019Admin';
  return 'Accès Opérateur : consultation catalogue, scan & demandes transmises à l\u2019Admin';
}

/** Top bar title = current tab label, exactly like the Android AtlasTopBar. */
const TAB_TITLES: [string, string][] = [
  ['/m/products', 'Produits'],
  ['/m/scan', 'Scan'],
  ['/m/vente', 'Vente'],
  ['/m/agent', 'Atlas Agent'],
  ['/m/inbox', 'Notifications'],
  ['/m/device-scan', 'Scanner un appareil'],
  ['/m/settings/whats-new', 'Mises à jour des versions'],
  ['/m/settings', 'Paramètres'],
  ['/m/profile', 'Mon profil'],
  ['/m/warehouse', 'Entrepôt'],
  ['/m/bills', 'Achats'],
  ['/m/balance', 'Balance'],
  ['/m/employees', 'Employés'],
  ['/m/invoice', 'Devis'],
  ['/m/more', 'Plus'],
];
function tabTitleFor(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/m';
  if (/^\/m\/products\/\d+\/historique$/.test(p)) return 'Historique du produit';
  for (const [prefix, title] of TAB_TITLES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return title;
  }
  return 'Accueil';
}



function PhoneMore() {
  const stockOnly = isStockRole();
  const office = canSell();
  const groups = [
    { title: 'Navigation', items: [
      { to: '/m', label: 'Accueil', icon: Home }, { to: '/m/products', label: 'Produits', icon: Package },
      { to: '/m/scan', label: 'Scan code-barres', icon: ScanLine }, { to: '/m/inbox', label: 'Notifications', icon: Bell },
      { to: '/m/agent', label: 'Atlas Agent', icon: Bot },
      ...(canOpenPhoneBalance(getRole()) ? [{ to: '/m/balance', label: 'Balance', icon: Wallet }] : []),
      ...(canOpenPhoneEmployees(getRole()) ? [{ to: '/m/employees', label: 'Employés', icon: Users }] : []),
    ] },
    { title: 'Outils', items: [
      ...(office ? [{ to: '/m/vente', label: 'Vente rapide', icon: ShoppingCart }, { to: '/m/bills', label: 'Achats & réception', icon: Receipt }] : []),
      { to: '/m/warehouse', label: 'Entrepôts · inventaire · transfert', icon: Warehouse },
      ...(office ? [{ to: '/m/invoice', label: 'Nouveau devis', icon: FileText }, { to: '/?mode=pc', label: 'Rapports & clôture (PC)', icon: Monitor, external: true }] : []),
    ] },
    { title: 'Personnel', items: [
      { to: '/m/profile', label: 'Mon profil', icon: UserRound }, { to: '/m/settings', label: 'Paramètres', icon: Settings },
      ...(office ? [{ to: '/?mode=pc', label: 'Tous les outils de la version PC', icon: Monitor, external: true }] : []),
    ] },
  ];
  return <div className="ph-more-native">
    <p className="ph-settings-lead">Retrouvez vos outils et préférences.</p>
    {groups.map(group => <section className="ph-settings-card ph-more-group" key={group.title}><h2>{group.title}</h2><ul className="phone-more-list">{group.items.map(item => {
      const Icon = item.icon;
      const content = <><span className="ph-more-icon"><Icon size={19} aria-hidden="true" /></span><span className="ph-more-label">{item.label}</span><ChevronRight size={18} aria-hidden="true" /></>;
      return <li key={item.label}>{'external' in item && item.external ? <a href={item.to}>{content}</a> : <NavLink to={item.to}>{content}</NavLink>}</li>;
    })}</ul></section>)}
    <p className="ph-settings-hint">{stockOnly ? 'Rôle magasinier : scan, stock et propositions produit. Caisse et argent sont gérés sur le PC.' : 'Réception des achats, UBL et clôture fiscale sont aussi sur PC (menu latéral).'}</p>
  </div>;
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
  useProfileWarm();
  useEffect(() => {
    try {
      setDensity('comfortable');
      document.documentElement.dataset.density = 'comfortable';
      document.documentElement.classList.remove('density-compact');
    } catch { /* */ }
  }, []);

  const location = useLocation();
  const [products, setProducts] = useState<Product[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [productLoading, setProductLoading] = useState(true);
  const [productReady, setProductReady] = useState(false);
  const [productError, setProductError] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsReady, setActionsReady] = useState(false);
  const [actionsError, setActionsError] = useState(false);
  const productGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);
  useEffect(() => { setQuickOpen(false); }, [location.pathname]);
  const navigate = useNavigate();

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const refresh = useCallback(async (target: 'all' | 'products' | 'actions' = 'all') => {
    const bounded = <T,>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 10_000);
      promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
    });
    const tasks: Promise<void>[] = [];
    if (target !== 'actions') {
      const generation = ++productGeneration.current; setProductLoading(true); setProductError(false);
      tasks.push((async () => {
        try {
          const result = await bounded(api.getProducts({ include_variants: true, fields: 'mobile', limit: 400 }));
          if (generation !== productGeneration.current) return;
          if (!Array.isArray(result.data)) throw new Error('invalid catalog');
          setProducts(result.data as Product[]); setProductReady(true);
          void cacheProducts(result.data).catch(() => {});
        } catch { if (generation === productGeneration.current) setProductError(true); }
        finally { if (generation === productGeneration.current) setProductLoading(false); }
      })());
    }
    if (target !== 'products') {
      const generation = ++actionGeneration.current; setActionsLoading(true); setActionsError(false);
      tasks.push((async () => {
        const [actionsResult, statsResult] = await Promise.allSettled([bounded(api.listMobileActions({ status: 'all', limit: 40, noStore: true })), bounded(api.getMobileActionStats(true))]);
        if (generation !== actionGeneration.current) return;
        if (actionsResult.status === 'fulfilled' && Array.isArray(actionsResult.value.data)) { setActions(actionsResult.value.data as Action[]); setActionsReady(true); }
        else setActionsError(true);
        if (statsResult.status === 'fulfilled') setPending(Number(statsResult.value.data?.pending || 0));
        setActionsLoading(false);
      })());
    }
    await Promise.all(tasks); setBooting(false);
  }, []);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => setBooting(false), 6000);
    void refresh();
    // Refresh pending activity while the app is visible; do not repeatedly reload the catalog or locations.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh('actions'); }, 15000);
    void api.getStockLocations().then(loc => cacheLocations((loc as any).data || [])).catch(() => {});
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
      window.clearTimeout(bootTimer);
      productGeneration.current++; actionGeneration.current++;
      clearInterval(t);
      if ((window as any).__atlasFlushOutbox === flush) delete (window as any).__atlasFlushOutbox;
      window.removeEventListener('online', flush);
      if (navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', onMsg);
      }
    };
  }, [refresh]);

  const allowSell = canSell();
  const [theme, applyTheme] = usePhoneTheme();
  const [, setProfileTick] = useState(0);
  const [animations, setAnimations] = useState(() => { try { return localStorage.getItem('atlas_phone_animations') !== 'off'; } catch { return true; } });
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('atlas_phone_density') === 'compact'; } catch { return false; } });
  const [phoneScale, setPhoneScale] = useState<UiScale>(() => { try { const value = localStorage.getItem('atlas_phone_scale'); return value === 'sm' || value === 'lg' ? value : 'md'; } catch { return 'md'; } });
  const [startTab, setStartTab] = useState(() => { try { return localStorage.getItem('atlas_phone_start_tab') || '/m'; } catch { return '/m'; } });
  const applyAnimations = (enabled: boolean) => { setAnimations(enabled); try { localStorage.setItem('atlas_phone_animations', enabled ? 'on' : 'off'); } catch { /* use session preference */ } };
  const applyCompact = (enabled: boolean) => { setCompact(enabled); try { localStorage.setItem('atlas_phone_density', enabled ? 'compact' : 'comfort'); } catch { /* use session preference */ } };
  const applyPhoneScale = (scale: UiScale) => { setPhoneScale(scale); try { localStorage.setItem('atlas_phone_scale', scale); } catch { /* use session preference */ } };
  const applyStartTab = (path: string) => { if (!phoneDockItems(getRole()).some(item => item.path === path)) return; setStartTab(path); try { localStorage.setItem('atlas_phone_start_tab', path); } catch { /* use session preference */ } };
  const startHandled = useRef(false);
  useEffect(() => {
    if (startHandled.current) return;
    startHandled.current = true;
    if ((location.pathname === '/m' || location.pathname === '/m/') && !location.search && startTab !== '/m' && phoneDockItems(getRole()).some(item => item.path === startTab)) navigate(startTab, { replace: true });
  }, [location.pathname, location.search, navigate, startTab]);
  const hasDock = showPhoneDock(location.pathname);
  const showBack = phoneShowsBack(location.pathname);
  const lastMainTab = useRef('/m');
  const pathname = location.pathname.replace(/\/+$/, '') || '/m';
  const closeQuickMenu = useCallback(() => setQuickOpen(false), []);
  const [topCollapsed, setTopCollapsed] = usePhoneTopBar(pathname, closeQuickMenu);
  if (['/m', '/m/scan', '/m/products', '/m/balance', '/m/employees'].includes(pathname)) lastMainTab.current = pathname;
  const parentTarget = phoneBackTarget(pathname);
  const backTarget = pathname === '/m/settings' && location.state?.phoneBack === '/m/profile'
    ? '/m/profile' : parentTarget === '/m' ? lastMainTab.current : parentTarget;

  return (
    <div data-phone-scale={phoneScale} className={`phone-root${scanDialogOpen ? ' phone-root--dialog-open' : ''}${hasDock ? '' : ' phone-root--no-dock'}${animations ? '' : ' phone-root--no-motion'}${compact ? ' phone-root--compact' : ''}`}>
      <OfflineBanner />
      <header className={`phone-topbar${topCollapsed ? ' is-collapsed' : ''}`}>
        {showBack && <button type="button" className="ph-top-back" aria-label="Retour" onClick={() => navigate(backTarget)}><ArrowLeft size={21} /></button>}
        {topCollapsed ? <button type="button" className="ph-top-expand" aria-label={`Développer la barre : ${tabTitleFor(pathname)}`} onClick={() => setTopCollapsed(false)}>{tabTitleFor(pathname)}</button> : <>
        {pathname === '/m/agent' && <AtlasAgentMascot size={30} />}
        <div className="pt-titles">
          <span className="pt-title">{tabTitleFor(location.pathname)}</span>
          {/^\/m\/products\/\d+\/historique\/?$/.test(location.pathname) && <small className="ph-top-subtitle">Détails et mouvements de stock</small>}
        </div>
        {!showBack && <div className="phone-top-actions">
          <button type="button" className="ph-top-agent" aria-label="Ouvrir Atlas Agent" onClick={() => navigate('/m/agent')}><Sparkles size={21} aria-hidden="true" /></button>
          <PhoneQuickActions open={quickOpen} setOpen={setQuickOpen} pending={pending} allowSell={allowSell} onNavigate={navigate} />
          <button
            type="button"
            className="phone-avatar phone-profile-btn"
            aria-label="Mon profil"
            onClick={() => navigate('/m/profile')}
          >
            {hasAvatarUrl() ? (
              <AvatarImage className="phone-avatar-img" />
            ) : (
              getDisplayInitials()
            )}
          </button>
        </div>}
        {pathname === '/m/profile' && <button type="button" className="ph-top-settings" aria-label="Paramètres" onClick={() => navigate('/m/settings', { state: { phoneBack: '/m/profile' } })}><Settings size={20} aria-hidden="true" /></button>}
        </>}
      </header>

      {booting && (
        <div className="ph-boot-strip">
          Synchronisation…
        </div>
      )}
      <main className={`phone-main${location.pathname.replace(/\/+$/, '') === '/m/agent' ? ' phone-main--agent' : ''}`}>
        <PageTransition disabled={!animations}>
        <Routes>
          <Route
            path="/"
            element={
              <PhoneHome />
            }
          />
          <Route
            path="/scan"
            element={
              <PhoneScan
                products={products}
                actions={actions}
                onDecisionVisibilityChange={setScanDialogOpen}
                onSent={async () => {
                  show('Envoyé au PC');
                  await refresh('actions');
                }}
                onToast={show}
              />
            }
          />
          <Route
            path="/products"
            element={<PhoneProduits products={products} actions={actions} loading={productLoading} ready={productReady} error={productError} actionsLoading={actionsLoading} actionsReady={actionsReady} actionsError={actionsError} onRefresh={(target) => refresh(target)} onToast={show} />}
          />
          <Route path="/products/:id/historique" element={<ProductHistory mobile onProductUpdated={() => void refresh('products')} />} />
          <Route
            path="/inbox"
            element={<PhoneBoîte actions={actions} onRefresh={() => void refresh('actions')} />}
          />
          <Route
            path="/vente"
            element={
              allowSell ? (
                <PhoneVente
                  products={products}
                  onDone={async (msg) => {
                    show(msg || 'Vente encaissée');
                    await refresh('products');
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
                    await refresh('actions');
                  }}
                  onToast={show}
                />
              ) : (
                <div className="phone-panel"><p className="ph-perm-banner">Rôle magasinier : pas de devis / caisse.</p></div>
              )
            }
          />
          <Route path="/balance" element={canOpenPhoneBalance(getRole()) ? <Suspense fallback={<PageSkeleton variant="phone" />}>{canOpenPhoneEmployees(getRole()) ? <PhoneBalance /> : <div className="phone-web-page"><Balance /></div>}</Suspense> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/balance/classic" element={canOpenPhoneBalance(getRole()) ? <div className="phone-web-page"><Suspense fallback={<PageSkeleton variant="phone" />}><Balance /></Suspense></div> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/employees" element={canOpenPhoneEmployees(getRole()) ? <div className="phone-web-page"><Suspense fallback={<PageSkeleton variant="phone" />}><Employees /></Suspense></div> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/more" element={<PhoneMore />} />
          <Route path="/profile" element={<PhoneProfile onChanged={() => setProfileTick(tick => tick + 1)} />} />
          <Route path="/settings" element={<PhoneSettings theme={theme} onTheme={applyTheme} animations={animations} onAnimations={applyAnimations} compact={compact} onCompact={applyCompact} scale={phoneScale} onScale={applyPhoneScale} startTab={startTab} onStartTab={applyStartTab} />} />
          <Route path="/settings/whats-new" element={<Suspense fallback={<PageSkeleton variant="phone" />}><PhoneWhatsNew /></Suspense>} />
          <Route path="/bills" element={allowSell ? <PhoneBills onToast={show} /> : <div className="phone-panel"><p className="ph-perm-banner">Rôle magasinier : pas d’achats.</p></div>} />
          <Route path="/warehouse" element={<PhoneWarehouse onToast={show} />} />
          <Route path="/agent" element={<PhoneAgentMobile />} />
          <Route path="/device-scan" element={<PhoneDeviceScan />} />

          <Route
            path="*"
            element={
              <div className="ph-restricted">
                <h1>Oups</h1>
                <p>
                  Cette page n&apos;est pas disponible sur mobile, ou elle a été restreinte.
                  Utilisez le menu du bas ou retournez à l&apos;accueil terrain.
                </p>
                <button type="button" className="ph-primary" onClick={() => navigate('/m')}>
                  Retour à l&apos;accueil
                </button>
              </div>
            }
          />
        </Routes>
        </PageTransition>
      </main>

      {hasDock && <PhoneDock role={getRole()} lastMainTab={lastMainTab.current} />}
      {toast && <div className="phone-toast">{toast}</div>}
    </div>
  );
}

function PhoneScan({
  products, actions, onSent, onToast, onDecisionVisibilityChange,
}: {
  products: Product[]; actions: Action[]; onSent: () => void; onToast: (m: string) => void;
  onDecisionVisibilityChange: (open: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hubSnap, setHubSnap] = useState<any>(null);
  const [outboxN, setOutboxN] = useState(0);
  const [camPermission, setCamPermission] = useState<'unknown' | 'granted' | 'denied' | 'unavailable'>('unknown');
  const readerRef = useRef<HTMLDivElement | null>(null);
  const scanStopRef = useRef<(() => void) | null>(null);
  const cameraGeneration = useRef(0);
  const [decision, setDecision] = useState<null | {
    code: string;
    found: Product | null;
    offline: boolean;
  }>(null);
  const [addNow, setAddNow] = useState(false);
  useEffect(() => {
    onDecisionVisibilityChange(!!decision && (decision.found ? !addNow : addNow));
    return () => onDecisionVisibilityChange(false);
  }, [decision, addNow, onDecisionVisibilityChange]);
  const [countedStock, setCountedStock] = useState('');
  const [np, setNp] = useState({ name: '', sku: '', barcode: '', price: '', stock: '0', image_data_url: '' });
  const navigate = useNavigate();

  // Warm scanner script while the user is on this screen (faster first Caméra).
  useEffect(() => {
    preloadBarcodeScanner();
  }, []);

  const stopCamera = () => {
    cameraGeneration.current++;
    try { scanStopRef.current?.(); } catch { /* camera cleanup is best-effort */ }
    scanStopRef.current = null;
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
    void prepareZXing().catch(() => { /* scanner fallback stays available */ });
    return () => { stopped = true; window.clearInterval(id); };
  }, []);

  const startCamera = async () => {
    if (busy) return;
    stopCamera();
    const generation = cameraGeneration.current;
    try {
      setDecision(null);
      setAddNow(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamPermission('unavailable');
        onToast('Caméra non supportée sur cet appareil — utilisez Image ou saisie');
        return;
      }
      setScanning(true);
      // Wait two frames so readerRef mounts with scanning UI
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      if (generation !== cameraGeneration.current) return;
      const reader = readerRef.current;
      if (!reader) {
        onToast('Caméra non prête — réessayez');
        setScanning(false);
        return;
      }
      reader.innerHTML = '';
      const stop = await startBarcodeScan(
        reader,
        (scanned) => {
          if (generation !== cameraGeneration.current) return;
          const text = String(scanned || '').trim();
          if (!text) return;
          setCamPermission('granted');
          setCode(text);
          if (isSafeInventoryCode(text)) phoneScanFeedback();
          stopCamera();
          void resolveCode(text);
        },
        (msg) => {
          if (generation === cameraGeneration.current) onToast(msg);
        }
      );
      if (generation !== cameraGeneration.current) { stop(); return; }
      scanStopRef.current = stop;
      setCamPermission('granted');
    } catch (e: any) {
      if (generation !== cameraGeneration.current) return;
      stopCamera();
      const name = String(e?.name || '');
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCamPermission('denied');
        onToast('Permission caméra refusée — autorisez-la dans Réglages, ou utilisez Image');
      } else {
        onToast(e?.message || 'Caméra indisponible — utilisez Image ou saisissez le code');
      }
    }
  };

  useEffect(() => { if (getScanPreference('autoCamera')) void startCamera(); }, []);

  const resolveCode = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    if (!isSafeInventoryCode(c)) {
      onToast('Ce scanner est réservé aux codes produit. Utilisez la connexion d’appareil pour un QR de connexion.');
      return;
    }
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
            if (!found && isOnline()) { onToast('Recherche indisponible. Réessayez avant de créer un produit.'); return; }
            if (!found) offline = true;
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
    if (!decision?.found || !canSell()) return;
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
        unit_price: 0,
        price: 0,
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
        detail: `${body.sku} · stock ${body.stock_quantity} · code ${body.barcode}`,
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
      <div className="ph-scan-native">
        <div className="ph-scan-status">{isOnline() ? 'En ligne' : 'Hors ligne'}</div>
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
        {!scanning && <div className="ph-scan-idle">
          <span className="ph-scan-idle-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="14" height="14" rx="3" /><path d="m17 10 4-2v8l-4-2z" /></svg></span>
          <h2>Caméra en veille</h2>
          <p>La caméra reste éteinte jusqu’à votre demande. Démarrez-la pour scanner un code-barres ou saisissez le code manuellement.</p>
          <button type="button" className="ph-scan-start theme-toggle" disabled={busy} onClick={startCamera}>Démarrer la caméra</button>
        </div>}

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
          <div ref={readerRef} className="ph-scan-reader ph-h5-reader" id="ph-h5-reader" data-h5-reader="1" />
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
        <div className="ph-scan-controls">
        <label htmlFor="phone-scan-code">Code-barres ou SKU</label>
        <div className="ph-scan-row">
          <input
            id="phone-scan-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resolveCode(code)}
            placeholder="Scannez ou saisissez un code"
            inputMode="text"
          />
          <button type="button" className="theme-toggle" disabled={busy} onClick={() => resolveCode(code)}>Rechercher</button>
        </div>
        <div className="ph-phone-actions">
          {scanning && <button type="button" className="theme-toggle" onClick={stopCamera}>Arrêter la caméra</button>}
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
                    if (isSafeInventoryCode(decoded)) phoneScanFeedback();
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
              className="ph-scan-file-input"
              aria-label="Importer une image de code-barres"
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
                    if (isSafeInventoryCode(decoded)) phoneScanFeedback();
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
          <button type="button" className="theme-toggle" disabled={busy} onClick={shelf}>Contrôle rayon</button>
        </div>
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
        <PhoneDialog titleId="phone-stock-dialog-title" onClose={closeDecision}>
            <h3 id="phone-stock-dialog-title">Ajuster le stock</h3>
            <p className="ph-sub" style={{ marginBottom: 12 }}>
              Code <strong>{decision.code}</strong>
              {decision.offline ? ' · mode hors ligne / cache' : ''}
            </p>
            <div className="ph-row-title">{decision.found.name}</div>
            <div className="ph-row-detail" style={{ marginBottom: 12 }}>
              Stock système : <strong>{stockOf(decision.found)}</strong> · min {minOf(decision.found)}
              {!isStockRole() && <> · {priceOf(decision.found)} MAD</>}
            </div>
            <label htmlFor="phone-counted-stock">Stock compté en rayon</label>
            <input
              id="phone-counted-stock"
              value={countedStock}
              onChange={(e) => setCountedStock(e.target.value)}
              inputMode="numeric"
              placeholder="Quantité réelle"
            />
            <p className="ph-sub" style={{ marginTop: 8, marginBottom: 12 }}>
              L&apos;ajustement est envoyé au PC pour approbation avant d&apos;être appliqué.
            </p>
            <div className="ph-modal-actions" style={{ flexDirection: 'column' }}>
              <button type="button" className="ph-cta" style={{ margin: 0 }} disabled={busy} onClick={adjustStock}>
                Ajuster le stock → PC
              </button>
              {canSell() && (
              <button type="button" className="ph-chip" style={{ width: '100%' }} disabled={busy} onClick={confirmFound}>
                Ajouter au devis
              </button>
              )}
              <button type="button" className="ph-chip" style={{ width: '100%' }} onClick={closeDecision}>
                Annuler
              </button>
            </div>
        </PhoneDialog>
      )}

      {/* Single modal only: unknown product */}
      {decision && !decision.found && addNow && (
        <PhoneDialog titleId="phone-new-product-dialog-title" onClose={closeDecision}>
            <h3 id="phone-new-product-dialog-title">Produit inconnu</h3>
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
              <button type="button" className="ph-chip" style={{ width: '100%' }} onClick={closeDecision}>
                Annuler
              </button>
            </div>
        </PhoneDialog>
      )}
    </div>
  );
}

export function PhoneProduits({ products, actions, onRefresh, onToast, loading = false, ready = true, error = false, actionsLoading = false, actionsReady = true, actionsError = false }: {
  products: Product[]; actions?: Action[]; onRefresh: (target: 'products' | 'actions') => void; onToast: (m: string) => void;
  loading?: boolean; ready?: boolean; error?: boolean; actionsLoading?: boolean; actionsReady?: boolean; actionsError?: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const direct = getRole() === 'owner' || getRole() === 'admin';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'requests'>('all');
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem('atlas_phone_products_view') === 'grid'; } catch { return false; } });
  const changeView = (showGrid: boolean) => { setGrid(showGrid); try { localStorage.setItem('atlas_phone_products_view', showGrid ? 'grid' : 'list'); } catch { /* session only */ } };
  const navigate = useNavigate();
  const lowCount = products.filter(phoneStockIsLow).length;
  const requests = (actions || []).filter(a => a.type === 'new_product' && a.status === 'pending');
  const visible = products.filter(p => (filter !== 'low' || phoneStockIsLow(p)) &&
    [p.name, p.sku, p.barcode].some(value => String(value || '').toLowerCase().includes(query.trim().toLowerCase())));
  return <section className="ph-catalogue">
    <label className="ph-catalog-search"><Search size={20} aria-hidden="true" /><span className="sr-only">Rechercher un produit</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom, SKU ou code-barres" /></label>
    <div className="ph-catalog-actions">
      <button type="button" title={direct ? 'Créer un produit' : 'Demander un produit à l’Admin'} aria-label={direct ? 'Créer un produit' : 'Demander un produit à l’Admin'} onClick={() => setShowCreate(true)}>{direct ? <Plus size={21} /> : <Send size={21} />}</button>
      <button type="button" aria-label="Scanner un code-barres" onClick={() => navigate('/m/scan')}><ScanLine size={21} /></button>
      <button type="button" aria-label="Actualiser le catalogue" disabled={filter === 'requests' ? actionsLoading : loading} onClick={() => onRefresh(filter === 'requests' ? 'actions' : 'products')}><RefreshCw size={20} /></button>
      {filter !== 'requests' && <div className="ph-catalog-view" role="group" aria-label="Affichage des produits"><button type="button" title="Affichage en grille" aria-label="Affichage en grille" aria-pressed={grid} onClick={() => changeView(true)}><Grid2X2 size={20} /></button><button type="button" title="Affichage en liste" aria-label="Affichage en liste" aria-pressed={!grid} onClick={() => changeView(false)}><List size={20} /></button></div>}
    </div>
    <div className="ph-catalog-filters" role="group" aria-label="Filtrer les produits">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Tous</button>
      <button type="button" aria-pressed={filter === 'low'} onClick={() => setFilter('low')}>À réappro. ({lowCount})</button>
      <button type="button" aria-pressed={filter === 'requests'} onClick={() => setFilter('requests')}>{getRole() === 'owner' || getRole() === 'admin' ? 'À valider' : 'Mes demandes'} ({requests.length})</button>
    </div>
    {showCreate && <PhoneProductCreate onClose={() => setShowCreate(false)} onCreated={(createdDirectly) => { setShowCreate(false); onToast(createdDirectly ? 'Produit créé au catalogue' : 'Demande envoyée à l’Admin'); onRefresh(createdDirectly ? 'products' : 'actions'); }} />}
    {filter !== 'requests' && loading && ready && <div className="ph-refresh-status" role="status">Actualisation du catalogue…</div>}
    {filter !== 'requests' && error && <p role="alert" className="ph-catalog-error">Impossible d’actualiser le catalogue. {ready ? 'Les dernières données restent affichées.' : 'Vérifiez la connexion.'} <button type="button" onClick={() => onRefresh('products')}>Réessayer</button></p>}
    {filter === 'requests' && actionsLoading && actionsReady && <div className="ph-refresh-status" role="status">Actualisation des demandes…</div>}
    {filter === 'requests' && actionsError && <p role="alert" className="ph-catalog-error">Impossible de charger les demandes. {actionsReady ? 'Les dernières données restent affichées.' : 'Vérifiez la connexion.'} <button type="button" onClick={() => onRefresh('actions')}>Réessayer</button></p>}
    {filter === 'requests' && !actionsReady && actionsLoading ? <PhoneSkeleton variant="rows" label="Chargement des demandes" /> : filter === 'requests' && !actionsReady ? null : filter !== 'requests' && !ready && loading ? <PhoneSkeleton variant={grid ? 'catalog-grid' : 'catalog-list'} label="Chargement du catalogue" /> : filter !== 'requests' && !ready ? null : filter === 'requests' ? <div className="ph-catalog-list">{requests.length ? requests.map(a => <div className="ph-catalog-card" key={a.id}><div className="ph-catalog-icon"><Package size={22} /></div><div><strong>{a.title}</strong><p>{a.detail || 'Demande en attente'}</p><small>En attente</small></div></div>) : <div className="ph-empty"><h2>Aucune demande en attente</h2></div>}</div> : <>
      <div className="ph-catalog-summary" aria-live="polite"><span>{visible.length} résultat{visible.length === 1 ? '' : 's'}</span></div>
      <div className={`ph-catalog-list${grid ? ' is-grid' : ''}`}>{visible.map(p => <NavLink className="ph-catalog-card ph-catalog-product" to={`/m/products/${p.id}/historique`} key={p.id}>
        <ProductArtwork url={p.image_url} largeImageProductId={p.image_inline_large ? p.id : undefined} className="ph-catalog-art" />
        <div className="ph-catalog-info"><strong>{p.name}</strong><p>{p.sku || p.barcode || 'Sans référence'}</p><small className={phoneStockIsLow(p) ? 'ph-low' : ''}>{p.track_inventory != null && !Number(p.track_inventory) ? 'Stock non suivi' : `Stock : ${stockOf(p)} · min ${minOf(p)}`}</small></div>
        {canSell() && typeof (p.unit_price ?? p.price) === 'number' && <strong className="ph-catalog-price">{priceOf(p).toLocaleString('fr-FR')} MAD</strong>}
      </NavLink>)}</div>
      {visible.length === 0 && <div className="ph-empty"><h2>Aucun produit</h2><p>Essayez une autre recherche ou actualisez le catalogue.</p></div>}
    </>}
  </section>;
}

function PhoneBoîte({ actions, onRefresh }: { actions: Action[]; onRefresh: () => void }) {
  const [tab, setTab] = useState<'pending' | 'done' | 'all'>('pending');
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertError, setAlertError] = useState(false);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const loadAlerts = useCallback(async () => {
    setLoadingAlerts(true);
    try { const result = await api.getAlerts(); setAlerts(result.data || []); setAlertError(false); }
    catch { setAlertError(true); }
    finally { setLoadingAlerts(false); }
  }, []);
  useEffect(() => { void loadAlerts(); }, [loadAlerts]);
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
      <div className="ph-inbox-header"><div><h1>Info Box &amp; Notifications</h1><p>{androidRoleLabel(getRole())} · {alerts.length} alerte(s) · {actions.filter(a => a.status === 'pending').length} en attente</p></div><button type="button" aria-label="Actualiser les notifications" onClick={() => { onRefresh(); void loadAlerts(); }}><RefreshCw size={20} /></button></div>
      <section className="ph-inbox-intro"><strong>Info Box · {androidRoleLabel(getRole())}</strong><p>{androidScopeSummary(getRole())}</p></section>
      <h2 className="ph-section">Alertes</h2>
      {loadingAlerts && !alerts.length ? <PhoneSkeleton variant="rows" label="Chargement des alertes" /> : alertError ? <p role="alert">Impossible de charger les alertes. Réessayez.</p> : alerts.length ? <div className="ph-card-list">{alerts.map((alert, i) => <div className="ph-row ph-card" key={`${alert.kind}-${i}`}><div className={`ph-inbox-dot ${alert.severity === 'high' ? 'danger' : 'warn'}`} /><div className="ph-row-title">{alert.label}</div></div>)}</div> : <p className="ph-sub">Aucune alerte pour votre rôle.</p>}
      <h2 className="ph-section">Actions envoyées</h2>
      <p className="ph-sub">Vos envois vers le PC (lecture seule).</p>
      <div className="ph-tabs-row">
        <div className="ph-tabs">
          {(['pending', 'done', 'all'] as const).map((tk) => (
            <button key={tk} type="button" className={tab === tk ? 'on' : ''} onClick={() => setTab(tk)}>{tk === 'pending' ? 'En attente' : tk === 'done' ? 'Terminées' : 'Toutes'}</button>
          ))}
        </div>
        <button type="button" className="ph-chip ph-refresh-inline" onClick={onRefresh} aria-label="Actualiser" title="Actualiser"><RefreshCw size={18} aria-hidden="true" /></button>
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
          <p style={{ color: '#9aa3b5', fontSize: 14, margin: 0 }}>Ajoutez des produits ci-dessous.</p>
        )}
        {lines.map((i) => (
          <div key={i.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #eee' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{i.product_name}</div>
              <div style={{ fontSize: 12, color: '#9aa3b5' }}>{i.quantity}</div>
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
              background: payMode === k ? '#0a0a0a' : '#fff',
              color: payMode === k ? '#fff' : '#1a1814',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {lab}
          </button>
        ))}
      </div>

      <div className="ph-panel" style={{ background: '#0a0a0a', color: '#fff', marginBottom: 12 }}>
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
            <span style={{ color: '#171717', fontWeight: 700 }}>{Math.round(priceOf(p)).toLocaleString('fr-FR')} MAD</span>
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


function newPhoneAgentThreadId() {
  return `mobile-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

export function PhoneAgentMobile() {
  type Msg = { role: 'user' | 'assistant'; text: string };
  // Never display the old unscoped local conversation for a different account.
  const storageKey = useMemo(() => {
    try {
      const username = localStorage.getItem('stock_auth_user');
      if (!username) return null;
      return `atlas-agent-mobile-msgs-v2:${encodeURIComponent(getBase() || window.location.origin)}:${encodeURIComponent(username)}`;
    } catch { return null; }
  }, []);
  const [threadId, setThreadId] = useState(() => {
    try {
      const raw = storageKey && localStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) : null;
      if (typeof saved?.threadId === 'string' && /^mobile-[a-zA-Z0-9-]{1,70}$/.test(saved.threadId)) return saved.threadId;
    } catch { /* create a new thread */ }
    return newPhoneAgentThreadId();
  });
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const raw = storageKey && localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        const p = Array.isArray(saved) ? saved : saved?.messages;
        if (Array.isArray(p)) {
          const valid = p.filter((m): m is Msg => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
          if (valid.length) return valid.slice(-40);
        }
      }
    } catch { /* */ }
    return [
      {
        role: 'assistant',
        text: 'Bonjour — je suis Atlas Agent (mobile). Posez une question sur le stock, les produits ou les actions terrain.',
      },
    ];
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const followMessages = useRef(true);
  const sending = useRef(false);

  useEffect(() => {
    try {
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ threadId, messages: msgs.slice(-40) }));
    } catch { /* conversation remains available for this session */ }
    const el = listRef.current;
    if (el && followMessages.current) {
      const frame = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      return () => cancelAnimationFrame(frame);
    }
  }, [msgs, busy, storageKey, threadId]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending.current) return;
    sending.current = true;
    followMessages.current = true;
    if (inputRef.current) inputRef.current.style.height = '';
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Casablanca';
      const res = await api.assistChat(text, { task: 'mobile_field', timezone, thread_id: threadId });
      const reply = res.data?.reply;
      if (typeof reply !== 'string' || !reply.trim()) throw new Error('Aucune réponse reçue. Réessayez.');
      setMsgs((m) => [...m, { role: 'assistant', text: reply }]);
    } catch (e: any) {
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          text: e?.message || 'Impossible de joindre l’assistant. Vérifiez la connexion ou la config API.',
        },
      ]);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="ph-agent-shell" data-agent-mobile="1">
      <header className="ph-agent-head">
        <span className="ph-agent-status"><AtlasAgentMascot size={30} engaged={busy || !!input.trim()} /> Conversation sur cet appareil</span>
        <button type="button" disabled={busy} className="ph-agent-new" title="Nouvelle discussion" aria-label="Nouvelle discussion" onClick={() => { followMessages.current = true; setThreadId(newPhoneAgentThreadId()); setMsgs([{ role: 'assistant', text: 'Bonjour, comment puis-je vous aider ?' }]); }}><MessageSquarePlus size={20} aria-hidden="true" /></button>
      </header>
      <div className="ph-agent-msgs" ref={listRef} aria-label="Conversation" onScroll={e => { const el = e.currentTarget; followMessages.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {msgs.map((m, i) => (
          <div key={i} className={`ph-agent-message ${m.role}`}>
            {m.role === 'assistant' && <AtlasAgentMascot size={32} />}
            <div className="ph-agent-message-content"><span className="ph-agent-message-label">{m.role === 'user' ? 'Vous' : 'Assistant Atlas'}</span><div className={'ph-agent-bubble ' + m.role}>{m.text}</div></div>
          </div>
        ))}
        {busy ? <div className="ph-agent-typing" role="status">Atlas Agent réfléchit…</div> : null}
        <p className="ph-agent-disclaimer">Atlas Agent peut se tromper. Votre message est transmis au serveur Atlas et au fournisseur IA configuré. Ne partagez pas de mots de passe ni de données personnelles inutiles.</p>
      </div>
      <form
        className="ph-agent-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          className="ph-agent-input"
          rows={1}
          maxLength={2500}
          aria-label="Message à l’assistant Atlas"
          enterKeyHint="send"
          placeholder="Écrivez votre question…"
          value={input}
          disabled={busy}
          onChange={(e) => { const field = e.currentTarget; field.style.height = 'auto'; field.style.height = `${Math.min(120, field.scrollHeight)}px`; setInput(field.value); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
        />
        <button
          type="submit"
          className="ph-agent-send"
          disabled={busy || !input.trim()}
          aria-label="Envoyer"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </form>
    </div>
  );
}


function PhoneInbox() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api.getAlerts().then((r: any) => { if (!cancelled) setAlerts(r?.data || []); }).catch(() => { if (!cancelled) setAlerts([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const dest = (href: string) => {
    if (href.startsWith('/products')) return '/m/warehouse';
    if (href.startsWith('/scan')) return '/m/scan';
    if (href.startsWith('/quick-sale')) return '/m/vente';
    if (href.startsWith('/bills')) return '/m/bills';
    return '/m';
  };
  return (
    <div className="phone-panel ph-inbox">
      <h1 className="ph-title">Notifications</h1>
      {loading ? <p className="ph-muted">Chargement…</p> : alerts.length === 0 ? (
        <p className="ph-muted">Aucune alerte — tout est en ordre.</p>
      ) : (
        <ul className="ph-inbox-list">
          {alerts.map((a: any, i: number) => (
            <li key={`${a.kind}-${i}`}>
              <button type="button" className="ph-inbox-item" onClick={() => navigate(dest(a.href || '/m'))}>
                <span className={`ph-inbox-dot ${a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warn' : ''}`} />
                <span className="ph-inbox-text">
                  <strong>{a.label}</strong>
                  <em>{String(a.kind).replace(/_/g, ' ')}</em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
