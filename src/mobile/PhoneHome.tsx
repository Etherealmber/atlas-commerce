import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Package, RefreshCw, TrendingUp, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { canSell, getRole } from '../auth';
import type { FinanceMonthly } from './financeTypes';

type Dashboard = { operational_only?: boolean; products?: number; low_stock?: unknown[]; productCount?: number; lowStockCount?: number; currency?: string; currentBalance?: number; stockValue?: number; unpaidSales?: { total: number; count: number; overdue: number }; monthlySeries?: { key: string; label: string; sales: number }[]; recentInvoices?: { id: number; number?: string; client_name?: string; total?: number; status?: string }[] };
const money = (n: unknown, currency: string) => typeof n === 'number' && Number.isFinite(n) ? `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}` : 'Indisponible';

export default function PhoneHome() {
  const navigate = useNavigate(); const role = getRole(); const admin = role === 'owner' || role === 'admin'; const sell = canSell();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [finance, setFinance] = useState<FinanceMonthly | null>(null);
  const [loading, setLoading] = useState(true); const [financeError, setFinanceError] = useState(false); const [error, setError] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setError(false); setFinanceError(false); setFinance(null);
    const bounded = <T,>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 10_000);
      promise.then(value => { window.clearTimeout(timer); resolve(value); }, reason => { window.clearTimeout(timer); reject(reason); });
    });
    const [dash, fin] = await Promise.allSettled([bounded(api.getDashboard()), admin ? bounded(api.getFinanceMonthly()) : Promise.resolve(null)]);
    if (generation.current !== id) return;
    if (dash.status === 'fulfilled' && dash.value.data) setDashboard(dash.value.data as Dashboard); else { setDashboard(null); setError(true); }
    if (admin && fin.status === 'fulfilled' && fin.value?.data) setFinance(fin.value.data);
    else if (admin) setFinanceError(true);
    setLoading(false);
  }, [admin]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const productCount = dashboard?.operational_only ? dashboard.products : dashboard?.productCount;
  // The operational endpoint returns at most 50 low-stock rows, not a total.
  const lowCount = dashboard?.operational_only ? dashboard.low_stock?.length : dashboard?.lowStockCount;
  const lowText = lowCount == null ? 'Indisponible' : dashboard?.operational_only && lowCount >= 50 ? '50+' : String(lowCount);
  const financial = admin && finance != null && !dashboard?.operational_only;
  const currency = finance?.currency || dashboard?.currency || 'MAD';
  const greeting = new Date().getHours() >= 5 && new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  const trend = financial && Array.isArray(dashboard?.monthlySeries) ? dashboard.monthlySeries.slice(-6) : [];
  const peak = Math.max(1, ...trend.map(p => Math.max(0, Number(p.sales) || 0)));
  return <div className="ph-home ph-home-native">
    <div className="ph-home-greeting"><div><h1>{greeting}</h1><p>Voici l’essentiel de votre activité.</p></div><button type="button" className="ph-refresh" aria-label="Actualiser" disabled={loading} onClick={() => void refresh()}><RefreshCw size={26} /></button></div>
    {loading && <p role="status">Actualisation du tableau de bord…</p>}
    {error && <div className="ph-panel" role="alert"><strong>Tableau de bord indisponible</strong><p>Vérifiez la connexion puis réessayez. Le catalogue et le scanner restent accessibles.</p><button type="button" onClick={() => void refresh()}>Réessayer</button></div>}
    {dashboard && <>
      <div className="ph-hero"><span className="ph-hero-label">{financial ? 'SOLDE DE TRÉSORERIE' : 'CATALOGUE & STOCK'}</span><strong className="ph-hero-value">{financial ? money(dashboard.currentBalance, currency) : `${productCount ?? '—'} articles actifs`}</strong><div className="ph-hero-pills">{financial ? <><span className="ph-hero-pill">Stock {money(dashboard.stockValue, currency)}</span><span className="ph-hero-pill">Créances {money(dashboard.unpaidSales?.total, currency)}</span></> : <><span className="ph-hero-pill">{lowCount == null ? 'Alertes indisponibles' : lowCount ? `${lowText} article(s) en alerte stock` : 'Aucune rupture critique'}</span><span className="ph-hero-pill">Demandes → Admin</span></>}</div></div>
      <div className="ph-actions-row"><button type="button" className="ph-btn filled" onClick={() => navigate(sell ? '/m/vente' : '/m/scan')}>{sell ? 'Nouvelle vente' : 'Scanner un article'}</button><button type="button" className="ph-btn outlined" onClick={() => navigate('/m/products')}>Produits</button></div>
      <button type="button" className="ph-cardlink" onClick={() => navigate('/m/inbox')}><span className="ph-cardlink-ico"><Bell size={20} /></span><span className="ph-cardlink-txt"><strong>Info Box · Demandes &amp; notifications</strong><small>Retrouvez vos alertes et votre activité.</small></span><span className="ph-chip2 tone-info">Ouvrir</span></button>
      <div className="ph-tiles"><div className="ph-tile"><span className="ph-tile-lbl"><Package size={18} /> Produits</span><strong className="ph-tile-val">{productCount ?? '—'}</strong></div><div className="ph-tile"><span className="ph-tile-lbl">{financial ? <TrendingUp size={18} /> : <TriangleAlert size={18} />}{financial ? 'Valeur du stock' : 'Stock faible'}</span><strong className="ph-tile-val">{financial ? money(dashboard.stockValue, currency) : lowText}</strong></div></div>
      {financial && <div className="ph-tiles"><div className="ph-tile tone-warning"><span className="ph-tile-lbl"><TriangleAlert size={18} /> Stock faible</span><strong className="ph-tile-val">{lowText}</strong></div><div className="ph-tile tone-info"><span className="ph-tile-lbl">Créances clients</span><strong className="ph-tile-val">{money(dashboard.unpaidSales?.total, currency)}</strong><span className="ph-tile-hint">{dashboard.unpaidSales?.count ?? '—'} facture(s)</span></div></div>}
      {trend.length > 0 && <section className="ph-panel ph-home-trend"><h2>Tendance des ventes</h2><p>Données du serveur · {trend.length} périodes</p><div className="ph-home-bars">{trend.map(p => <div key={p.key}><span>{money(p.sales, currency)}</span><div className="ph-home-bar"><i style={{ height: `${Math.max(4, Math.max(0, Number(p.sales) || 0) / peak * 100)}%` }} /></div><small>{p.label || p.key}</small></div>)}</div></section>}
      {admin && <section className="ph-panel ph-home-finance"><div className="ph-home-section-head"><div><h2>Solde &amp; mouvements</h2><p>Relevé mensuel du serveur</p></div><button type="button" className="ph-refresh" aria-label="Actualiser les finances" disabled={loading} onClick={() => void refresh()}><RefreshCw size={18} /></button></div>{financeError ? <p role="alert">Données financières indisponibles. Réessayez.</p> : finance && <><p>Période : <strong>{finance.period}</strong></p><div className="ph-home-finance-values"><span>Solde d’ouverture <b>{money(finance.opening_balance, currency)}</b></span><span>Solde de clôture <b>{money(finance.closing_balance, currency)}</b></span><span>Ventes encaissées <b>{money(finance.sales_received, currency)}</b></span><span>Dépenses <b>{money(finance.expenses, currency)}</b></span><span>Salaires versés <b>{money(finance.payroll_paid, currency)}</b></span><span>Fournisseurs réglés <b>{money(finance.supplier_paid, currency)}</b></span><span>Paie à verser <b>{money(finance.payroll?.total_due, currency)}</b></span><span>Clients à recevoir <b>{money(finance.receivables?.total_outstanding, currency)}</b></span><span>Fournisseurs à payer <b>{money(finance.payables?.total_outstanding, currency)}</b></span></div><button type="button" className="ph-btn outlined" onClick={() => navigate('/m/balance?tab=reports')}>Rapports PDF · ouvrir dans Atlas</button><button type="button" className="ph-btn outlined" onClick={() => navigate('/m/balance')}>Voir la balance</button></>}</section>}
      {lowCount != null && lowCount > 0 && <section className="ph-panel"><div className="ph-home-section-head"><h2>Alerte stock</h2><button type="button" className="ph-textbtn" onClick={() => navigate('/m/products')}>Voir</button></div><p>{lowText} produit(s) au niveau ou sous le seuil d’alerte.</p></section>}
      {sell && <section className="ph-panel ph-home-documents"><h2>Derniers documents</h2>{dashboard.recentInvoices?.length ? dashboard.recentInvoices.slice(0, 5).map(invoice => <div className="ph-home-document" key={invoice.id}><div><strong>{invoice.number || 'Document'}</strong><small>{invoice.client_name || '—'} · {invoice.status || '—'}</small></div>{financial && <b>{money(invoice.total, currency)}</b>}</div>) : <p>Aucun document disponible.</p>}</section>}
      <section className="ph-panel"><h2>Outils terrain</h2><p>Retrouvez l’entrepôt et les autres outils disponibles pour votre rôle.</p><button type="button" className="ph-textbtn" onClick={() => navigate('/m/more')}>Ouvrir les outils</button></section>
    </>}
  </div>;
}
