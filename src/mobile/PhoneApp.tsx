/**
 * Phone-limited experience (APK + mobile browser).
 * Floor operator: scan, stock check, request product, see own sends.
 * Full ERP lives on PC shell only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings, Sparkles, ShoppingCart, Search, ScanLine, RefreshCw, Grid2X2, List, Package, MessageSquarePlus, Plus, Send, ChevronRight, Bell, Minus, Trash2, CircleAlert, CircleCheck, CreditCard, ShieldCheck, Copy, ChevronDown, History, Hourglass } from 'lucide-react';
import PhoneDeviceScan from './PhoneDeviceScan';
import PhoneClients from './PhoneClients';
import { PhoneEmployeeDetail, PhoneEmployeeDirectory } from './PhoneEmployees';
import PhoneSettings from './PhoneSettings';
import PhoneProfile from './PhoneProfile';
const PhoneWhatsNew = lazy(() => import('./PhoneWhatsNew'));
import PhoneDock, { canOpenPhoneBalance, canOpenPhoneClients, canOpenPhoneEmployees, phoneBackTarget, phoneDockItems, phoneShowsBack, showPhoneDock } from './PhoneDock';
import { usePhoneTheme } from './usePhoneTheme';
import { usePhoneTopBar } from './usePhoneTopBar';
import { api, getBase } from '../api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PhoneAgentActivity from './PhoneAgentActivity';
import { getUsername, getDisplayInitials, hasAvatarUrl, getRole, isStockRole, canSell } from '../auth';
import { setDensity, type UiScale } from '../lib/density';
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
  listCachedLocations,
  lookupOffline,
  enqueueOutboxAndSync,
  countOutbox,
  countOfflineInventoryOps,
  flushOutbox,
  isOnline,
} from '../lib/offlineCatalog';
import {
  executeOrQueueOfflineInventoryOp,
  replayOfflineInventoryQueue,
} from '../lib/offlineInventoryClient';
import { startBarcodeScan, captureAndDecode, decodeImageFile, preloadBarcodeScanner, prepareZXing } from '../lib/barcodeScan';
import { IconPackage, IconInbox } from '../components/Icons';
import OfflineBanner from '../components/OfflineBanner';
import PhoneHome from './PhoneHome';
import ProductArtwork from '../components/ProductArtwork';
import ProductHistory from '../pages/ProductHistory';
import PhoneProductCreate from './PhoneProductCreate';
import { dualStockLabel } from '../lib/dualUnit';
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
  unit?: string | null;
  secondary_unit?: string | null;
  secondary_unit_factor?: number | null;
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
  created_by?: string | null;
  completed_by?: string | null;
};

const Balance = lazy(() => import('../pages/Balance'));
const PhoneBalance = lazy(() => import('./PhoneBalance'));

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
  ['/m/clients', 'Clients'],
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
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh('actions'); }, 90000);
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
      {pathname !== '/m/agent' && <header className={`phone-topbar${topCollapsed ? ' is-collapsed' : ''}`}>
        {showBack && <button type="button" className="ph-top-back" aria-label="Retour" onClick={() => navigate(backTarget)}><ArrowLeft size={21} /></button>}
        {topCollapsed ? <button type="button" className="ph-top-expand" aria-label={`Développer la barre : ${tabTitleFor(pathname)}`} onClick={() => setTopCollapsed(false)}>{tabTitleFor(pathname)}</button> : <>
        <div className="pt-titles">
          <span className="pt-title">{tabTitleFor(location.pathname)}</span>
          {/^\/m\/products\/\d+\/historique\/?$/.test(location.pathname) && <small className="ph-top-subtitle">Détails et mouvements de stock</small>}
        </div>
        {!showBack && <div className="phone-top-actions">
          <button type="button" className="ph-top-agent" aria-label="Ouvrir Atlas Agent" onClick={() => navigate('/m/agent')}><Sparkles size={21} aria-hidden="true" /></button>
          <PhoneQuickActions open={quickOpen} setOpen={setQuickOpen} pending={pending} allowSell={allowSell} allowClients={canOpenPhoneClients(getRole())} onNavigate={navigate} />
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
      </header>}

      {booting && pathname !== '/m/agent' && (
        <div className="ph-boot-strip">
          Synchronisation…
        </div>
      )}
      <main className={`phone-main${location.pathname.replace(/\/+$/, '') === '/m/agent' ? ' phone-main--agent' : ''}`}>
        <PhonePageFrame agent={pathname === '/m/agent'} disabled={!animations}>
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
            element={<PhoneBoîte actions={actions} actionsLoading={actionsLoading} actionsReady={actionsReady} actionsError={actionsError} onRefresh={() => void refresh('actions')} />}
          />
          <Route
            path="/vente"
            element={
              allowSell ? (
                <PhoneVente
                  products={products} ready={productReady} error={productError} onRefresh={() => void refresh('products')}
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
          <Route path="/balance" element={canOpenPhoneBalance(getRole()) ? <Suspense fallback={<PageSkeleton variant="phone" />}>{canOpenPhoneEmployees(getRole()) ? <PhoneBalance /> : <div className="phone-web-page"><Balance /></div>}</Suspense> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/clients" element={canOpenPhoneClients(getRole()) ? <PhoneClients onToast={show} /> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/employees" element={canOpenPhoneEmployees(getRole()) ? <PhoneEmployeeDirectory /> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/employees/:id" element={canOpenPhoneEmployees(getRole()) ? <PhoneEmployeeDetail /> : <div className="phone-panel"><p>Cette page n’est pas disponible pour votre rôle.</p></div>} />
          <Route path="/profile" element={<PhoneProfile onChanged={() => setProfileTick(tick => tick + 1)} preferences={{ theme, onTheme: applyTheme, animations, onAnimations: applyAnimations, compact, onCompact: applyCompact, scale: phoneScale, onScale: applyPhoneScale, startTab, onStartTab: applyStartTab }} />} />
          <Route path="/settings" element={<PhoneSettings theme={theme} onTheme={applyTheme} animations={animations} onAnimations={applyAnimations} compact={compact} onCompact={applyCompact} scale={phoneScale} onScale={applyPhoneScale} startTab={startTab} onStartTab={applyStartTab} />} />
          <Route path="/settings/whats-new" element={<Suspense fallback={<PageSkeleton variant="phone" />}><PhoneWhatsNew /></Suspense>} />
          <Route path="/agent" element={<PhoneAgentMobile onNavigate={path => navigate(path)} onBack={() => navigate(backTarget)} onTheme={applyTheme} onProductCreated={direct => { show(direct ? 'Produit créé au catalogue' : 'Demande envoyée à l’Admin'); void refresh(direct ? 'products' : 'actions'); }} />} />
          <Route path="/device-scan" element={<PhoneDeviceScan />} />

          <Route
            path="*"
            element={
              <div className="ph-restricted">
                <h1>Page non disponible sur mobile</h1>
                <p>
                  Seules les pages accessibles depuis la barre du haut et la barre du bas sont disponibles sur mobile.
                </p>
                <button type="button" className="ph-primary" onClick={() => navigate('/m')}>
                  Retour à l&apos;accueil
                </button>
              </div>
            }
          />
        </Routes>
        </PhonePageFrame>
      </main>

      {hasDock && <PhoneDock role={getRole()} />}
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
  const [scanOpKind, setScanOpKind] = useState<'count' | 'receive' | 'issue'>('count');
  const [scanLocs, setScanLocs] = useState<Array<{ id: number; name: string; code: string; quantity?: number; revision?: number }>>([]);
  const [scanLocId, setScanLocId] = useState<number>(0);
  const [scanPendingOps, setScanPendingOps] = useState(0);
  const [scanConflict, setScanConflict] = useState<{ current_quantity: number; current_revision: number; message: string } | null>(null);
  const [np, setNp] = useState({ name: '', sku: '', barcode: '', price: '', stock: '0', image_data_url: '' });
  const navigate = useNavigate();
  const scanLocation = useLocation();

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
        const [n, inv] = await Promise.all([countOutbox(), countOfflineInventoryOps()]);
        if (!stopped) {
          setOutboxN(n);
          setScanPendingOps(inv.pending);
        }
      } catch { /* */ }
      try {
        if (isOnline()) {
          const res = await api.getHubSnapshot();
          if (!stopped) setHubSnap(res.data);
        }
      } catch { /* */ }
    };
    void tick();
    const onOnline = async () => {
      try {
        const res = await replayOfflineInventoryQueue();
        if (res.applied > 0) onToast(`${res.applied} mouvement(s) synchronisé(s)`);
        if (res.conflicts > 0) onToast(`${res.conflicts} conflit(s) de comptage détecté(s)`);
      } catch { /* */ }
      void tick();
    };
    window.addEventListener('online', onOnline);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 90000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    // Preload WASM scanner engine (P3)
    void prepareZXing().catch(() => { /* scanner fallback stays available */ });
    return () => {
      stopped = true;
      window.removeEventListener('online', onOnline);
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    const pid = decision?.found?.id;
    if (!pid) return;
    setScanConflict(null);
    if (isOnline()) {
      api
        .getStockLocationsForProduct(pid)
        .then((res) => {
          const list = (res.data || []).map((l) => ({
            id: Number(l.id),
            name: l.name,
            code: l.code,
            quantity: Number(l.quantity ?? 0),
            revision: Number(l.revision ?? 0),
          }));
          setScanLocs(list);
          if (list.length && !list.some((x) => x.id === scanLocId)) {
            setScanLocId(list[0].id);
          }
        })
        .catch(() => { /* */ });
    } else {
      listCachedLocations()
        .then((cached) => {
          const list = (cached || []).map((l: any) => ({ id: Number(l.id), name: l.name, code: l.code, quantity: 0, revision: 0 }));
          setScanLocs(list);
          if (list.length && !scanLocId) setScanLocId(list[0].id);
        })
        .catch(() => { /* */ });
    }
  }, [decision?.found?.id]);

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
      navigate(scanLocation.state?.returnToSale === true ? '/m/vente' : '/m/invoice');
      setCode('');
    } catch (e: any) {
      onToast(e.message || 'Erreur envoi');
    } finally {
      setBusy(false);
    }
  };

  /** Exécuter un mouvement terrain (receive / issue / count) sur l'emplacement choisi */
  const submitScanOfflineOp = async () => {
    if (!decision?.found) return;
    if (!scanLocId) {
      onToast('Sélectionnez un emplacement');
      return;
    }
    const val = Number(countedStock);
    if (!Number.isFinite(val) || (scanOpKind === 'count' ? val < 0 : val <= 0)) {
      onToast(scanOpKind === 'count' ? 'Saisissez une quantité comptée (≥ 0)' : 'Saisissez une quantité (> 0)');
      return;
    }
    const loc = scanLocs.find((l) => l.id === scanLocId);
    setBusy(true);
    setScanConflict(null);
    try {
      const outcome = await executeOrQueueOfflineInventoryOp({
        kind: scanOpKind,
        product_id: decision.found.id,
        location_id: scanLocId,
        quantity_delta: scanOpKind === 'count' ? undefined : val,
        counted_quantity: scanOpKind === 'count' ? val : undefined,
        observed_quantity: scanOpKind === 'count' ? Number(loc?.quantity ?? 0) : undefined,
        observed_revision: scanOpKind === 'count' ? Number(loc?.revision ?? 0) : undefined,
        note: `Scan mobile · ${decision.code}`,
        product_name: decision.found.name,
        location_name: loc?.name,
      });
      const counts = await countOfflineInventoryOps();
      setScanPendingOps(counts.pending);
      if (outcome.state === 'applied') {
        setDecision(null);
        setCountedStock('');
        setCode('');
        onSent();
        onToast(`Stock mis à jour (rév. ${outcome.data?.revision})`);
      } else if (outcome.state === 'queued') {
        setDecision(null);
        setCountedStock('');
        setCode('');
        onToast('Hors ligne — mouvement mis en file d’attente');
      } else if (outcome.state === 'conflict') {
        setScanConflict({
          current_quantity: outcome.current_quantity,
          current_revision: outcome.current_revision,
          message: outcome.message,
        });
        setScanLocs((prev) =>
          prev.map((l) => (l.id === scanLocId ? { ...l, quantity: outcome.current_quantity, revision: outcome.current_revision } : l)),
        );
        onToast('Conflit de comptage détecté (409)');
      }
    } catch (e: any) {
      onToast(e?.message || 'Erreur mouvement stock');
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
        {(outboxN > 0 || scanPendingOps > 0 || (hubSnap && hubSnap.pending > 0)) && (
          <p className="ph-hub-badge" role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span>
              {scanPendingOps > 0 && <span>{scanPendingOps} en attente</span>}
              {scanPendingOps > 0 && outboxN > 0 && ' · '}
              {outboxN > 0 && <span>{outboxN} action(s) hors ligne en attente de sync</span>}
              {(outboxN > 0 || scanPendingOps > 0) && hubSnap?.pending > 0 && ' · '}
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
              className="ph-scan-photo"
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
            {scanLocs.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {([
                    ['count', 'Comptage'],
                    ['receive', 'Réception'],
                    ['issue', 'Sortie'],
                  ] as const).map(([k, label]) => (
                    <button key={k} type="button" className={`ph-chip ${scanOpKind === k ? 'on' : ''}`} onClick={() => { setScanOpKind(k); setScanConflict(null); }}>
                      {label}
                    </button>
                  ))}
                </div>
                <label htmlFor="phone-scan-loc">Emplacement</label>
                <select
                  id="phone-scan-loc"
                  value={scanLocId}
                  onChange={(e) => setScanLocId(Number(e.target.value))}
                  style={{ width: '100%', height: 42, borderRadius: 10, marginBottom: 8 }}
                >
                  {scanLocs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name} (qté {l.quantity ?? 0}, rév. {l.revision ?? 0})
                    </option>
                  ))}
                </select>
              </>
            )}
            <label htmlFor="phone-counted-stock">
              {scanOpKind === 'count' ? 'Quantité comptée en rayon' : scanOpKind === 'receive' ? 'Quantité reçue' : 'Quantité sortie'}
            </label>
            <input
              id="phone-counted-stock"
              value={countedStock}
              onChange={(e) => setCountedStock(e.target.value)}
              inputMode="numeric"
              placeholder={scanOpKind === 'count' ? 'Quantité réelle' : 'Quantité'}
            />
            {scanConflict && (
              <div role="alert" className="ph-sale-error" style={{ marginTop: 8, padding: 8, borderRadius: 8 }}>
                <strong>Conflit de révision (409)</strong> : serveur qté {scanConflict.current_quantity} (rév. {scanConflict.current_revision}).
              </div>
            )}
            <p className="ph-sub" style={{ marginTop: 8, marginBottom: 12 }}>
              Applique sur l’emplacement choisi (ou met en file hors ligne) ; ou proposez un ajustement au PC.
            </p>
            <div className="ph-modal-actions" style={{ flexDirection: 'column' }}>
              {scanLocs.length > 0 && (
                <button type="button" className="ph-cta" style={{ margin: 0 }} disabled={busy} onClick={submitScanOfflineOp}>
                  {scanOpKind === 'count' ? 'Valider comptage' : scanOpKind === 'receive' ? 'Enregistrer réception' : 'Enregistrer sortie'}
                </button>
              )}
              <button type="button" className="ph-chip" style={{ width: '100%' }} disabled={busy} onClick={adjustStock}>
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
        <div className="ph-catalog-info"><strong>{p.name}</strong><p>{p.sku || p.barcode || 'Sans référence'}</p><small className={phoneStockIsLow(p) ? 'ph-low' : ''}>{p.track_inventory != null && !Number(p.track_inventory) ? 'Stock non suivi' : `Stock : ${dualStockLabel(p)} · min ${minOf(p)}`}</small></div>
        {canSell() && typeof (p.unit_price ?? p.price) === 'number' && <strong className="ph-catalog-price">{priceOf(p).toLocaleString('fr-FR')} MAD</strong>}
      </NavLink>)}</div>
      {visible.length === 0 && <div className="ph-empty"><h2>Aucun produit</h2><p>Essayez une autre recherche ou actualisez le catalogue.</p></div>}
    </>}
  </section>;
}

function alertDestination(href: unknown) {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return null;
    if (/^\/products(?:[/?#]|$)/.test(href)) return '/m/products';
    if (/^\/scan(?:[/?#]|$)/.test(href)) return '/m/scan';
    if (/^\/quick-sale(?:[/?#]|$)/.test(href) && canSell()) return '/m/vente';
    if (/^\/balance(?:[/?#]|$)/.test(href) && canOpenPhoneBalance(getRole())) return '/m/balance';
    if (/^\/employees(?:[/?#]|$)/.test(href) && canOpenPhoneEmployees(getRole())) return '/m/employees';
    return null;
}

function notificationMetadata(action: Action): { target?: string; urgent: boolean; reason: string } {
  let meta: any = {};
  try { meta = action.meta_json ? JSON.parse(action.meta_json) : {}; } catch { /* legacy data */ }
  const targets: Record<string, string> = { admin: 'Administrateurs', owner: 'Propriétaire', secretary: 'Secrétariat & ventes', stock: 'Magasiniers & stock', all: 'Tous les rôles' };
  const key = typeof meta?.target_role === 'string' ? meta.target_role.toLowerCase() : '';
  return { target: Object.prototype.hasOwnProperty.call(targets, key) ? targets[key] : undefined, urgent: String(meta?.priority || '').toLowerCase() === 'urgent' || /^\[URGENT\]/i.test(action.title || ''), reason: typeof meta?.reject_reason === 'string' ? meta.reject_reason : '' };
}

export function PhoneBoîte({ actions, onRefresh, actionsLoading = false, actionsReady = true, actionsError = false }: { actions: Action[]; onRefresh: () => void; actionsLoading?: boolean; actionsReady?: boolean; actionsError?: boolean }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'pending' | 'done'>('all');
  const [alerts, setAlerts] = useState<any[]>([]); const [alertReady, setAlertReady] = useState(false);
  const [alertError, setAlertError] = useState(false); const [loadingAlerts, setLoadingAlerts] = useState(true);
  const generation = useRef(0);
  const loadAlerts = useCallback(async () => {
    const id = ++generation.current; setLoadingAlerts(true); setAlertError(false);
    try { const result = await api.getAlerts(); if (!Array.isArray(result.data)) throw new Error('invalid alerts'); if (id === generation.current) { setAlerts(result.data); setAlertReady(true); } }
    catch { if (id === generation.current) setAlertError(true); }
    finally { if (id === generation.current) setLoadingAlerts(false); }
  }, []);
  useEffect(() => { void loadAlerts(); return () => { generation.current++; }; }, [loadAlerts]);
  const pending = actions.filter(a => a.status === 'pending').length;
  const list = actions.filter(a => tab === 'all' || (tab === 'pending' ? a.status === 'pending' : a.status === 'done' || a.status === 'cancelled'));

  const refreshAll = () => { onRefresh(); void loadAlerts(); };
  return <div className="ph-notifications">
    <section className="ph-native-card ph-notifications-intro"><div className="ph-notifications-intro-row"><ShieldCheck size={22} aria-hidden="true" /><div><h1>Info Box · {androidRoleLabel(getRole())}</h1><p>{androidScopeSummary(getRole())}</p><small>{alertReady ? `${alerts.length} alerte(s)` : 'Alertes indisponibles'} · {actionsReady ? `${pending} en attente` : 'Demandes indisponibles'}</small></div><span className="ph-native-badge">{getRole() === 'owner' || getRole() === 'admin' ? 'Admin' : 'Rôle'}</span><button type="button" className="ph-native-icon" aria-label="Actualiser les notifications" onClick={refreshAll}><RefreshCw size={20} /></button></div><p className="ph-native-sub">Les demandes affichées proviennent du serveur. Les validations restent disponibles sur le PC.</p></section>
    {(loadingAlerts && !alertReady) ? <PhoneSkeleton variant="rows" label="Chargement des alertes" /> : <>
      {alertError && <div className="ph-sale-error" role="alert">Impossible de charger les alertes. <button type="button" className="ph-native-text" onClick={() => void loadAlerts()}>Réessayer</button></div>}
      {alertReady && <section className="ph-notifications-section"><h2>Alertes {androidRoleLabel(getRole())} ({alerts.length})</h2><p>Alertes accessibles selon vos permissions.</p>{alerts.map((alert, i) => { const dest = alertDestination(alert.href); const content = <><CircleAlert size={20} aria-hidden="true" /><strong>{String(alert.label || 'Alerte')}</strong>{Number(alert.count) > 0 && <span className="ph-native-badge">{alert.count}</span>}{dest && <ChevronRight size={18} aria-hidden="true" />}</>; return dest ? <button type="button" className="ph-native-card ph-alert-row" key={`${alert.kind}-${i}`} onClick={() => navigate(dest)}>{content}</button> : <div className="ph-native-card ph-alert-row" key={`${alert.kind}-${i}`}>{content}</div>; })}{alerts.length === 0 && <div className="ph-native-card ph-notifications-empty"><Bell size={26} /><strong>Aucune alerte</strong><p>Votre flux est à jour.</p></div>}</section>}
    </>}
    <section className="ph-notifications-section"><h2>Demandes &amp; notifications</h2><p>Suivi des demandes disponibles sur ce compte. Validation au PC.</p><div className="ph-native-chips" role="group" aria-label="Filtrer les demandes">{([['all', actionsReady ? `Toutes (${actions.length})` : 'Toutes'], ['pending', actionsReady ? `En attente (${pending})` : 'En attente'], ['done', 'Terminées']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      {actionsLoading && !actionsReady && <PhoneSkeleton variant="rows" label="Chargement des demandes" />}
      {actionsError && <div className="ph-sale-error" role="alert">Impossible de charger les demandes. <button type="button" className="ph-native-text" onClick={onRefresh}>Réessayer</button></div>}
      {actionsReady && list.map(a => { const meta = notificationMetadata(a); return <article className="ph-native-card ph-notification-action" key={a.id}><div className="ph-native-badges"><span className={a.status === 'done' ? 'positive' : a.status === 'cancelled' ? 'danger' : 'warning'}>{a.status === 'pending' ? 'En attente' : a.status === 'done' ? 'Validée ✓' : a.status === 'cancelled' ? 'Refusée' : a.status}</span>{a.status === 'pending' && meta.urgent && <span className="danger">Urgent</span>}{meta.target && <span className="neutral">→ {meta.target}</span>}</div><strong>{a.title || `Demande #${a.id}`}</strong>{a.detail && <p>{a.detail}</p>}<small>{a.type} · {a.created_at?.slice(0, 16)}{a.barcode ? ` · Code : ${a.barcode}` : ''}{a.created_by ? ` · Par ${a.created_by}` : ''}{a.completed_by ? ` · Traité par ${a.completed_by}` : ''}</small>{a.status === 'cancelled' && meta.reason && <p>Refus PC : {meta.reason}</p>}</article>; })}
      {actionsReady && !list.length && <div className="ph-native-card ph-notifications-empty"><IconInbox size={26} /><strong>Aucune demande à afficher</strong><p>Modifiez le filtre ou actualisez.</p></div>}
    </section>
  </div>;
}

const saleMoney = (value: number) => `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;

export function PhoneVente({ products, ready = true, error = false, onRefresh, onDone, onToast }: {
  products: Product[]; ready?: boolean; error?: boolean; onRefresh?: () => void;
  onDone: (msg?: string) => void | Promise<void>; onToast: (m: string) => void;
}) {
  const navigate = useNavigate();
  const [sel, setSel] = useState<Record<number, number>>(() => loadPhoneCart());
  const [payMode, setPayMode] = useState<'cash' | 'card' | 'credit'>('cash');
  const [client, setClient] = useState('Client de passage'); const [phone, setPhone] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [confirm, setConfirm] = useState(false);
  const [submitError, setSubmitError] = useState(''); const [sent, setSent] = useState(false); const [q, setQ] = useState('');
  const [showCatalog, setShowCatalog] = useState(false);
  const cart = Object.entries(sel).filter(([, qty]) => Number.isFinite(qty) && qty > 0);
  const lines = cart.flatMap(([id, quantity]) => {
    const product = products.find(p => p.id === Number(id));
    if (!product) return [];
    const unit = priceOf(product);
    return [{ product_id: product.id, product_name: product.name, quantity, unit_price: unit, line_ht: quantity * unit, has_price: product.unit_price != null || product.price != null }];
  });
  const missing = cart.length - lines.length;
  const validPrices = lines.every(line => line.has_price && Number.isFinite(line.unit_price) && line.unit_price >= 0 && Number.isFinite(line.line_ht));
  const total = lines.reduce((sum, line) => sum + line.line_ht, 0);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const matchingProducts = products.filter(p => !q.trim() || `${p.name || ''} ${p.sku || ''} ${p.barcode || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const filtered = matchingProducts.slice(0, 40);
  const changeCart = (update: (cart: Record<number, number>) => Record<number, number>) => setSel(previous => { const next = update(previous); savePhoneCart(next); return next; });
  const add = (id: number) => changeCart(previous => ({ ...previous, [id]: (previous[id] || 0) + 1 }));
  const dec = (id: number) => changeCart(previous => { const next = { ...previous }; if ((next[id] || 0) <= 1) delete next[id]; else next[id]--; return next; });
  const remove = (id: number) => changeCart(previous => { const next = { ...previous }; delete next[id]; return next; });
  const canSend = ready && !error && !missing && validPrices && lines.length > 0 && client.trim().length > 0 && !busy;
  const send = async () => {
    if (!canSend || busyRef.current) return;
    busyRef.current = true; setBusy(true); setSubmitError('');
    const clientName = client.trim();
    const notes = [`Vente rapide téléphone · mode prévu : ${payMode === 'cash' ? 'Espèces' : payMode === 'card' ? 'Carte' : 'Crédit'} · en attente validation PC`, phone.trim() ? `Téléphone : ${phone.trim()}` : '', note.trim() ? `Note : ${note.trim()}` : ''].filter(Boolean).join(' · ');
    try {
      await api.createMobileAction({ type: 'invoice', title: `Vente rapide ${Math.round(total)} MAD`, detail: `${count} article(s) · ${clientName} · ${saleMoney(total)} · ${payMode} · en attente PC`, created_by: getUsername(), source: 'mobile', meta: {
        needs_approval: true, quick_sale: true, pay_mode: payMode, total,
        create_invoice_body: { client_name: clientName, status: 'sent', quick_sale: true, doc_kind: 'quick_sale', tax_exempt: true, notes,
          items: lines.map(i => ({ product_id: i.product_id, product_name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, list_price: i.unit_price, tax_rate: 0 })) },
      } });
    } catch (e) { setSubmitError(e instanceof Error ? e.message : 'Échec de l’envoi au PC.'); setBusy(false); busyRef.current = false; return; }
    setConfirm(false); setSel({}); savePhoneCart({}); setClient('Client de passage'); setPhone(''); setNote(''); setPayMode('cash'); setSent(true); setBusy(false); busyRef.current = false;
    try { await onDone('Demande envoyée au PC. Elle n’est pas encore payée.'); } catch { onToast('Demande envoyée ; actualisation du catalogue impossible.'); }
  };
  return <div className="ph-sale">
    <section className="ph-native-card ph-sale-cart"><div className="ph-native-section-head"><div><h2>Panier</h2>{cart.length > 0 && <p>{cart.length} article(s)</p>}</div>{cart.length > 0 && <button type="button" className="ph-native-text" disabled={busy} onClick={() => changeCart(() => ({}))}>Vider</button>}</div>
      {!ready && <p role="status">Chargement des produits…</p>}
      {error && <p role="alert">Catalogue indisponible. <button type="button" className="ph-native-text" onClick={onRefresh}>Réessayer</button></p>}
      {ready && !cart.length && <div className="ph-sale-empty"><span><ShoppingCart size={27} aria-hidden="true" /></span><strong>Panier vide</strong><p>Ajoutez des produits depuis le catalogue ou en scannant un code-barres.</p><div className="ph-sale-empty-actions"><button type="button" className="ph-native-tonal" onClick={() => setShowCatalog(true)}>Parcourir les produits</button><button type="button" className="ph-native-tonal" onClick={() => navigate('/m/scan', { state: { returnToSale: true } })}><ScanLine size={17} /> Scanner</button></div></div>}
      {lines.map(line => <div className="ph-sale-line" key={line.product_id}><div className="ph-sale-line-main"><strong>{line.product_name}</strong><small>{line.has_price && Number.isFinite(line.unit_price) ? `${line.quantity} × ${saleMoney(line.unit_price)} = ${saleMoney(line.line_ht)}` : 'Prix indisponible'}</small><div className="ph-sale-quantity"><button type="button" disabled={busy} aria-label={`Diminuer ${line.product_name}`} onClick={() => dec(line.product_id)}><Minus size={17} /></button><span>{line.quantity}</span><button type="button" disabled={busy} aria-label={`Augmenter ${line.product_name}`} onClick={() => add(line.product_id)}><Plus size={17} /></button></div></div><button type="button" className="ph-sale-remove" disabled={busy} aria-label={`Retirer ${line.product_name}`} onClick={() => remove(line.product_id)}><Trash2 size={19} /></button></div>)}
      {ready && missing > 0 && <div role="alert" className="ph-sale-missing">{missing} produit(s) du panier ne sont pas dans le catalogue chargé. Actualisez ou retirez-les avant l’envoi.{cart.filter(([id]) => !products.some(p => p.id === Number(id))).map(([id]) => <button type="button" className="ph-native-text" key={id} onClick={() => remove(Number(id))}>Retirer #{id}</button>)}</div>}
      {ready && !validPrices && <p role="alert">Prix indisponible pour un article. Actualisez le catalogue avant l’envoi.</p>}
      {cart.length > 0 && <div className="ph-sale-add-actions"><button type="button" className="ph-native-tonal ph-sale-add" aria-expanded={showCatalog} onClick={() => setShowCatalog(!showCatalog)}><Plus size={17} /> Ajouter un produit</button><button type="button" className="ph-native-tonal ph-sale-add" onClick={() => navigate('/m/scan', { state: { returnToSale: true } })}><ScanLine size={17} /> Scanner</button></div>}

    </section>
    <section className="ph-native-card ph-sale-fields"><div className="ph-native-section-head"><div><h2>Client du ticket</h2><p>Le nom apparaît sur la demande envoyée au PC.</p></div></div><label>Nom du client *<input value={client} maxLength={120} disabled={busy} onChange={e => setClient(e.target.value)} /></label><label>Téléphone (facultatif)<input type="tel" value={phone} maxLength={40} disabled={busy} onChange={e => setPhone(e.target.value)} /></label></section>
    <section className="ph-native-card ph-sale-fields"><h2>Note interne (facultatif)</h2><label>Note<textarea value={note} maxLength={500} rows={2} disabled={busy} onChange={e => setNote(e.target.value)} /></label></section>
    <details className="ph-native-card ph-sale-payment"><summary>Mode prévu · {payMode === 'cash' ? 'Espèces' : payMode === 'card' ? 'Carte' : 'Crédit'}</summary><p className="ph-native-sub">Indicatif : la validation rapide actuelle sur PC enregistre un paiement en espèces. Aucun paiement n’est enregistré ici.</p><div className="ph-native-chips" role="group" aria-label="Mode de paiement prévu">{([['cash', 'Espèces'], ['card', 'Carte'], ['credit', 'Crédit']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={payMode === value} onClick={() => setPayMode(value)} disabled={busy}>{label}</button>)}</div></details>
    {submitError && <div className="ph-sale-error" role="alert"><strong>Demande non envoyée</strong><p>{submitError}</p></div>}
    <div className="ph-native-badges"><span>Vente rapide</span><span>Sans TVA</span><span>En attente PC</span></div>
    <section className="ph-sale-total"><div><div><small>TOTAL</small><strong>{saleMoney(total)}</strong></div><span>Sans TVA</span></div><button type="button" className="ph-native-primary" disabled={!canSend} onClick={() => setConfirm(true)}><CreditCard size={18} /> Envoyer au PC</button><p>La demande doit être validée au bureau. Elle n’est pas encore payée.</p></section>
    {showCatalog && <PhoneDialog className="ph-native-dialog ph-sale-picker" titleId="ph-sale-picker-title" onClose={() => { setShowCatalog(false); setQ(''); }}><div className="ph-sale-picker-content"><h2 id="ph-sale-picker-title">Ajouter un produit</h2><p>Choisissez un article du catalogue chargé.</p><div className="ph-sale-catalog"><label><span className="ph-sr-only">Rechercher un produit</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Nom, SKU ou code-barres" /></label><div className="ph-sale-picker-list">{filtered.map(p => <button type="button" key={p.id} disabled={busy} onClick={() => { add(p.id); setShowCatalog(false); setQ(''); }}><span>{p.name}</span><strong>{(p.unit_price != null || p.price != null) && Number.isFinite(priceOf(p)) ? saleMoney(priceOf(p)) : 'Prix indisponible'}</strong><Plus size={18} /></button>)}{!filtered.length && <p>Aucun produit trouvé.</p>}{matchingProducts.length > filtered.length && <p className="ph-sale-picker-more">Affichage des 40 premiers résultats. Affinez la recherche.</p>}</div></div><div className="ph-native-dialog-actions"><button type="button" onClick={() => { setShowCatalog(false); setQ(''); }}>Fermer</button></div></div></PhoneDialog>}
    {confirm && <PhoneDialog className="ph-native-dialog" titleId="ph-sale-confirm-title" onClose={() => { if (!busy) setConfirm(false); }}><h2 id="ph-sale-confirm-title">Confirmer l’envoi ?</h2><p>Client : {client.trim()}<br />Articles : {cart.length} · Total : {saleMoney(total)}</p><p>Cette demande sera envoyée au PC ; aucun paiement n’est enregistré maintenant. La validation rapide au PC enregistre un paiement en espèces.</p>{submitError && <p role="alert">{submitError}</p>}<div className="ph-native-dialog-actions"><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Annuler</button><button type="button" disabled={busy || !canSend} onClick={() => void send()}>{busy ? 'Envoi…' : 'Envoyer'}</button></div></PhoneDialog>}
    {sent && <PhoneDialog className="ph-native-dialog" titleId="ph-sale-sent-title" onClose={() => setSent(false)}><h2 id="ph-sale-sent-title"><CircleCheck size={21} /> Demande envoyée</h2><p>La vente attend la validation au PC et n’est pas encore payée.</p><div className="ph-native-dialog-actions"><button type="button" onClick={() => setSent(false)}>Nouveau panier</button></div></PhoneDialog>}
  </div>;
}

function newPhoneAgentThreadId() {
  return `mobile-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

function AgentMark() {
  return <span className="ph-agent-avatar" aria-hidden="true"><svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.1">{Array.from({ length: 16 }, (_, index) => index).filter(index => index !== 4).map(index => <line key={index} x1="10" y1="4" x2="10" y2=".8" transform={`rotate(${index * 22.5} 10 10)`} />)}<line x1="10" y1="10" x2="19.6" y2="10" /></svg></span>;
}

function agentMarkdownUrl(url: string): string {
  const trimmed = url.trim();
  return /^(https?:\/\/|#|\/(?!\/))/i.test(trimmed) ? trimmed : '';
}

function PhonePageFrame({ agent, disabled, children }: { agent: boolean; disabled: boolean; children: ReactNode }) {
  // A transformed route wrapper can become the containing block for a fixed chat
  // and clip it to the zero-height phone main. Do not animate that wrapper here.
  return agent ? <>{children}</> : <PageTransition disabled={disabled}>{children}</PageTransition>;
}

export function PhoneAgentMobile({ onNavigate, onBack, onTheme, onProductCreated }: { onNavigate?: (path: string) => void; onBack?: () => void; onTheme?: (theme: 'light' | 'dark' | 'system') => void; onProductCreated?: (direct: boolean) => void } = {}) {
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
          if (valid.length === 1 && valid[0].role === 'assistant' && ['Bonjour — je suis Atlas Agent (mobile). Posez une question sur le stock, les produits ou les actions terrain.', 'Bonjour, comment puis-je vous aider ?'].includes(valid[0].text)) return [];
          if (valid.length) return valid.slice(-40);
        }
      }
    } catch { /* */ }
    return [];
  });
  type SavedThread = { threadId: string; messages: Msg[] };
  const historyKey = storageKey ? `${storageKey}:history` : null;
  const [history, setHistory] = useState<SavedThread[]>(() => {
    try { const value = historyKey && JSON.parse(localStorage.getItem(historyKey) || '[]'); return Array.isArray(value) ? value.filter(t => typeof t?.threadId === 'string' && Array.isArray(t.messages)).map(t => ({ threadId: t.threadId, messages: t.messages.filter((m: Msg) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string').slice(-40) })) : []; } catch { return []; }
  });
  const [dialog, setDialog] = useState<'history' | 'quota' | 'activity' | 'language' | 'unlock' | 'photo' | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [policy, setPolicy] = useState<Awaited<ReturnType<typeof api.getAgentPolicy>>['data'] | null>(null);
  const [policyStatus, setPolicyStatus] = useState('');
  const [contextActions, setContextActions] = useState<{ title: string; detail: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLatest, setShowLatest] = useState(false); const [quickNotice, setQuickNotice] = useState(''); const [copyNotice, setCopyNotice] = useState('');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const followMessages = useRef(true);
  const sending = useRef(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const dockFocusAfterChange = useRef(false);
  const dockScroll = useRef({ last: 0, distance: 0, expandedUntil: 0 });

  useEffect(() => {
    if (!dockFocusAfterChange.current) return;
    dockFocusAfterChange.current = false;
    dockRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [dockCollapsed]);

  const onConversationScroll = (el: HTMLDivElement) => {
    followMessages.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setShowLatest(!followMessages.current);
    const state = dockScroll.current;
    const delta = el.scrollTop - state.last;
    state.last = el.scrollTop;
    if (el.dataset.phoneProgrammaticScroll === 'true' || Date.now() < state.expandedUntil) { state.distance = 0; return; }
    if ((delta > 0 && state.distance < 0) || (delta < 0 && state.distance > 0)) state.distance = 0;
    state.distance += delta;
    if (el.scrollTop <= 10 || state.distance <= -48) {
      state.distance = 0;
      if (dockCollapsed) {
        dockFocusAfterChange.current = !!dockRef.current?.contains(document.activeElement);
        setDockCollapsed(false);
      }
    } else if (state.distance >= 48 && el.scrollTop > 60 && !dockCollapsed) {
      state.distance = 0;
      dockFocusAfterChange.current = !!dockRef.current?.contains(document.activeElement);
      setDockCollapsed(true);
    }
  };
  const expandAgentDock = () => {
    dockFocusAfterChange.current = !!dockRef.current?.contains(document.activeElement);
    dockScroll.current.distance = 0;
    dockScroll.current.expandedUntil = Date.now() + 400;
    setDockCollapsed(false);
  };

  useEffect(() => {
    try {
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ threadId, messages: msgs.slice(-40) }));
    } catch { /* conversation remains available for this session */ }
    const el = listRef.current;
    if (el && msgs.length && followMessages.current) {
      const frame = requestAnimationFrame(() => { el.dataset.phoneProgrammaticScroll = 'true'; el.scrollTop = el.scrollHeight; window.setTimeout(() => { delete el.dataset.phoneProgrammaticScroll; }, 150); });
      return () => cancelAnimationFrame(frame);
    }
  }, [msgs, busy, storageKey, threadId]);

  useEffect(() => {
    const viewport = window.visualViewport; const shell = shellRef.current;
    if (!viewport || !shell) return;
    const update = () => shell.style.setProperty('--ph-agent-keyboard-inset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    update(); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, []);

  // Archive only on explicit navigation; preserve the current cache format for existing users.
  const archiveCurrent = () => {
    if (!msgs.length) return true;
    const next = [{ threadId, messages: msgs.slice(-40) }, ...history.filter(t => t.threadId !== threadId)];
    if (historyKey) {
      try { localStorage.setItem(historyKey, JSON.stringify(next)); }
      catch { setQuickNotice('Impossible de conserver cette discussion sur cet appareil.'); return false; }
    }
    setHistory(next); return true;
  };
  const newConversation = () => {
    if (!archiveCurrent()) return;
    followMessages.current = true; setThreadId(newPhoneAgentThreadId()); setMsgs([]); setInput(''); setShowLatest(false); setQuickNotice('');
  };
  const refreshContext = async () => {
    setRefreshing(true); setQuickNotice('Actualisation du contexte…');
    const results = await Promise.allSettled([api.assistStatus(), api.getAgentPolicy(), api.assistNextActions()]);
    if (results[1].status === 'fulfilled') setPolicy(results[1].value.data);
    if (results[2].status === 'fulfilled' && (getRole() === 'owner' || getRole() === 'admin')) {
      const items = results[2].value.data?.items;
      setContextActions(Array.isArray(items) ? items.filter(item => typeof item.title === 'string' && item.title.trim()).slice(0, 4) : []);
    }
    const ok = results.filter(r => r.status === 'fulfilled').length;
    setQuickNotice(ok === results.length ? 'Contexte actualisé.' : ok ? 'Contexte partiellement actualisé. Vérifiez la connexion.' : 'Actualisation indisponible. Vérifiez la connexion.');
    setRefreshing(false);
  };
  const openQuota = async () => {
    setDialog('quota'); setPolicyStatus('Chargement…');
    try { const result = await api.getAgentPolicy(); setPolicy(result.data); setPolicyStatus(''); }
    catch { setPolicy(null); setPolicyStatus('Quota indisponible. Vérifiez la connexion.'); }
  };

  const send = async (prompt?: string) => {
    const text = (prompt ?? input).trim();
    if (!text || sending.current) return;
    sending.current = true;
    setQuickNotice('');
    followMessages.current = true; setShowLatest(false);
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
    <div className="ph-agent-shell" data-agent-mobile="1" ref={shellRef}>
      <nav ref={dockRef} className={`ph-agent-dock${dockCollapsed ? ' is-collapsed' : ''}`} aria-label="Actions Atlas Agent">
        {dockCollapsed ? <button type="button" className="ph-agent-dock-expand" aria-expanded="false" onClick={expandAgentDock}>Atlas Agent</button> : <>
        <div className="ph-agent-dock-brand">
          {(onBack || onNavigate) && <button type="button" aria-label="Retour" title="Retour" onClick={() => onBack ? onBack() : onNavigate?.('/m')}><ArrowLeft size={21} /></button>}
          <span className="ph-agent-dock-mark" aria-label="Atlas Agent"><AtlasAgentMascot size={30} /></span>
          <span className="ph-agent-dock-title">Atlas Agent</span>
        </div>
        <div className="ph-agent-dock-actions">
          <button type="button" disabled={busy} title="Historique" aria-label="Historique des discussions" onClick={() => setDialog('history')}><History size={21} /></button>
          <button type="button" disabled={busy} title="Nouvelle discussion" aria-label="Nouvelle discussion" onClick={newConversation}><MessageSquarePlus size={21} /></button>
          <button type="button" disabled={refreshing} title="Actualiser le contexte" aria-label="Actualiser le contexte" onClick={() => void refreshContext()}><RefreshCw size={21} /></button>
          <button type="button" title="Quota IA" aria-label="Quota IA" onClick={() => void openQuota()}><Hourglass size={21} /></button>
        </div>
        </>}
      </nav>
      <div className="ph-agent-msgs" ref={listRef} role="log" aria-live="polite" aria-label="Conversation" onScroll={e => onConversationScroll(e.currentTarget)}>
        {quickNotice && <p className="ph-agent-quick-notice" role="status">{quickNotice}</p>}
        {msgs.length === 0 && <div className="ph-agent-quick" role="group" aria-label="Actions rapides">
            {onNavigate && <button type="button" onClick={() => onNavigate('/m/settings/whats-new')}>Mises à jour</button>}
            {onTheme && ([['light', 'Thème clair'], ['dark', 'Thème sombre'], ['system', 'Thème système']] as const).map(([theme, label]) => <button type="button" key={theme} data-theme-toggle onClick={() => { onTheme(theme); setQuickNotice(`${label} activé.`); }}>{label}</button>)}
            <button type="button" onClick={() => setDialog('activity')}>Mon activité</button>
            <button type="button" onClick={() => setDialog('unlock')}>Déverrouillage</button>
            <button type="button" onClick={() => setDialog('language')}>Langue</button>
            {onNavigate && <button type="button" onClick={() => onNavigate('/m/profile')}>Modifier mon profil</button>}
            <button type="button" onClick={() => setDialog('photo')}>Changer ma photo</button>
            <button type="button" onClick={() => setShowCreate(true)}>{getRole() === 'owner' || getRole() === 'admin' ? 'Créer un produit' : 'Demander un produit'}</button>
            {onNavigate && <><button type="button" onClick={() => onNavigate('/m/scan')}>Modifier le stock</button><button type="button" onClick={() => onNavigate('/m/products')}>Produits</button><button type="button" onClick={() => onNavigate('/m/scan')}>Scanner</button></>}
          </div>}
        {msgs.length === 0 && <>
          {contextActions.length > 0 && <div className="ph-agent-prompts" aria-label="Suggestions actualisées">{contextActions.map((item, i) => <button type="button" disabled={busy} key={`${item.title}-${i}`} onClick={() => void send(item.detail ? `${item.title} : ${item.detail}` : item.title)}>{item.title}</button>)}</div>}
          <div className="ph-agent-prompts" aria-label="Questions suggérées"><button type="button" disabled={busy} onClick={() => void send('Quels articles sont en rupture ou à réapprovisionner ?')}>Quels articles sont en rupture ou à réapprovisionner ?</button><button type="button" disabled={busy} onClick={() => void send('Quelles demandes scan sont en attente ?')}>Quelles demandes scan sont en attente ?</button></div>
        </>}
        {msgs.map((m, i) => (
          <div key={i} className={`ph-agent-message ${m.role}`}>
            {m.role === 'assistant' && <AgentMark />}
            <div className="ph-agent-message-content"><span className="ph-agent-message-label">{m.role === 'user' ? 'Vous' : 'Assistant Atlas'}</span><div className={'ph-agent-bubble ' + m.role} dir="auto">{m.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={agentMarkdownUrl} components={{ a: ({ href, children }) => href ? <a href={href} target={/^https?:/i.test(href) ? '_blank' : undefined} rel="noopener noreferrer">{children}</a> : <span>{children}</span>, img: ({ alt }) => <span>{alt || 'Image non affichée'}</span> }}>{m.text}</ReactMarkdown> : m.text}{m.role === 'assistant' && <button type="button" className="theme-toggle ph-agent-copy" aria-label="Copier la réponse" onClick={() => { if (!navigator.clipboard?.writeText) { setCopyNotice('Copie indisponible dans ce navigateur.'); return; } void navigator.clipboard.writeText(m.text).then(() => setCopyNotice('Réponse copiée.'), () => setCopyNotice('Impossible de copier la réponse.')); }}><Copy size={15} aria-hidden="true" /> Copier</button>}</div></div>
          </div>
        ))}
        {copyNotice && <p className="ph-agent-copy-notice" role="status">{copyNotice}</p>}
        {busy ? <div className="ph-agent-typing" role="status"><AtlasAgentMascot size={30} engaged /><span className="ph-agent-dots" aria-hidden="true"><i /><i /><i /></span> Atlas Agent réfléchit…</div> : null}
        <p className="ph-agent-disclaimer">Atlas Agent peut se tromper. Votre message est transmis au serveur Atlas et au fournisseur IA configuré. Ne partagez pas de mots de passe ni de données personnelles inutiles.</p>
      </div>
      {showCreate && <PhoneProductCreate onClose={() => setShowCreate(false)} onCreated={direct => { setShowCreate(false); onProductCreated?.(direct); setQuickNotice(direct ? 'Produit créé au catalogue.' : 'Demande envoyée à l’administrateur.'); }} />}
      {dialog === 'activity' && <PhoneAgentActivity onClose={() => setDialog(null)} />}
      {(dialog === 'language' || dialog === 'unlock' || dialog === 'photo') && <PhoneDialog titleId="ph-agent-info-title" onClose={() => setDialog(null)}>
        <h2 id="ph-agent-info-title">{dialog === 'language' ? 'Langue' : dialog === 'unlock' ? 'Déverrouillage' : 'Changer ma photo'}</h2>
        <p>{dialog === 'language' ? 'La version web est disponible en français. Les autres langues arrivent bientôt.' : dialog === 'unlock' ? 'Le déverrouillage de l’appareil est disponible dans l’application Android, pas dans ce navigateur.' : 'Le changement de photo n’est pas encore disponible dans le profil mobile web.'}</p>
        <button type="button" className="ph-btn" onClick={() => setDialog(null)}>Fermer</button>
      </PhoneDialog>}
      {dialog === 'history' && <PhoneDialog titleId="ph-agent-history-title" onClose={() => setDialog(null)}>
        <h2 id="ph-agent-history-title">Historique des discussions</h2><p>Discussions enregistrées sur cet appareil pour ce compte.</p>{quickNotice && <p role="status">{quickNotice}</p>}
        {history.filter(t => t.threadId !== threadId).length === 0 && <p>Aucune autre discussion enregistrée.</p>}
        <div className="ph-agent-history-list">{history.filter(t => t.threadId !== threadId).map(t => <button type="button" key={t.threadId} onClick={() => { if (!archiveCurrent()) return; setThreadId(t.threadId); setMsgs(t.messages); setInput(''); setShowLatest(false); followMessages.current = true; setDialog(null); }}>{t.messages.find(m => m.role === 'user')?.text.slice(0, 90) || 'Discussion'}</button>)}</div>
        <button type="button" className="ph-btn" onClick={() => setDialog(null)}>Fermer</button>
      </PhoneDialog>}
      {dialog === 'quota' && <PhoneDialog titleId="ph-agent-quota-title" onClose={() => setDialog(null)}>
        <h2 id="ph-agent-quota-title">Quota IA</h2>{policyStatus && <p role="status">{policyStatus}</p>}
        {!policyStatus && policy && (policy.blocked ? <p>Accès à l’Agent bloqué.</p> : policy.isAdmin ? <p>Compte administrateur : quota non limité.</p> : <><p>Jour : {policy.dailyUsed} / {policy.dailyLimit} jetons</p><p>Semaine : {policy.weeklyUsed} / {policy.weeklyLimit} jetons</p></>)}
        <button type="button" className="ph-btn" onClick={() => setDialog(null)}>Fermer</button>
      </PhoneDialog>}
      {showLatest && msgs.length > 0 && <button type="button" className="theme-toggle ph-agent-latest" aria-label="Aller aux derniers messages" onClick={() => { const el = listRef.current; followMessages.current = true; setShowLatest(false); if (el) { el.dataset.phoneProgrammaticScroll = 'true'; el.scrollTop = el.scrollHeight; window.setTimeout(() => { delete el.dataset.phoneProgrammaticScroll; }, 150); } }}><ChevronDown size={20} /></button>}
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
          className="theme-toggle ph-agent-send"
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

