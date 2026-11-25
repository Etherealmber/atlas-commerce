/**
 * Homepage feature cards, built from the app's own UI (no screenshots, no
 * photos): the same product cards, status badges, document lines, aging
 * buckets and Atlas Agent bubbles as the web app, with fictitious data.
 * Purely illustrative — every block is aria-hidden behind a figure label.
 */
import type { ReactNode } from 'react';
import { ArrowUp, Box, FileText, Package, Pencil, QrCode, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';

function Frame({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return (
    <figure className={`hm-fx hm-live ${className}`} role="img" aria-label={label}>
      <div className="hm-live-inner" aria-hidden="true">{children}</div>
    </figure>
  );
}

type Stock = 'ok' | 'low' | 'out';
const STOCK_LABEL: Record<Stock, string> = { ok: 'En stock', low: 'Stock bas', out: 'Rupture' };

function ProductCard({ name, sku, price, qty, stock, tone }: { name: string; sku: string; price: string; qty: string; stock: Stock; tone: 'stone' | 'night' }) {
  return (
    <div className="hl-pcard">
      <div className={`hl-pmedia is-${tone}`}>
        <Package size={22} strokeWidth={1.6} />
        <span className="hl-check" />
        <span className={`hl-stock is-${stock}`}>{STOCK_LABEL[stock]}</span>
      </div>
      <b className="hl-pname">{name}</b>
      <span className="hl-pref">{sku}</span>
      <span className="hl-pmeta"><b>{price}</b><i className={`is-${stock}`}>{qty}</i></span>
      <span className="hl-pacts">
        <span className="hl-pill hl-pill-edit"><Pencil size={10} /><span className="hl-pill-txt">Modifier</span></span>
        <span className="hl-round"><SlidersHorizontal size={10} /></span>
        <span className="hl-grow" />
        <span className="hl-round is-danger"><Trash2 size={10} /></span>
      </span>
    </div>
  );
}

export function StockDemo() {
  return (
    <Frame label="Catalogue produits Atlas : cartes produit avec niveaux de stock (données fictives)" className="hm-live-stock">
      <div className="hl-pgrid">
        <ProductCard name="Marbre Carrara blanc" sku="MAR-001 · Marbre" price="420 MAD" qty="42 m²" stock="ok" tone="stone" />
        <ProductCard name="Granit noir Zimbabwe" sku="GRA-014 · Granit" price="560 MAD" qty="6 m²" stock="low" tone="night" />
      </div>
    </Frame>
  );
}

type Status = 'success' | 'warning' | 'info';
const TICKETS: { n: string; client: string; total: string; status: string; tone: Status }[] = [
  { n: 'VR-2026-0148', client: 'Comptoir', total: '1 260 MAD', status: 'Payée', tone: 'success' },
  { n: 'VR-2026-0147', client: 'Atelier Benali', total: '3 480 MAD', status: 'Partielle', tone: 'warning' },
  { n: 'VR-2026-0146', client: 'Riad Al Bahja', total: '920 MAD', status: 'À régler', tone: 'info' },
];

export function SalesDemo() {
  return (
    <Frame label="Liste des tickets de vente rapide avec statuts de règlement (données fictives)" className="hm-live-sales">
      <div className="hl-panel">
        <div className="hl-panel-bar">
          <span className="hl-bar-title">3 tickets<span className="hl-bar-extra"> · aujourd’hui</span></span>
          <span className="hl-seg"><i className="is-on">Tous</i><i>À régler</i></span>
        </div>
        <div className="hl-rows">
          {TICKETS.map((t) => (
            <div className="hl-row" key={t.n}>
              <b className="hl-num">{t.n}</b>
              <span className="hl-client">{t.client}</span>
              <span className="hl-amt">{t.total}</span>
              <span className={`hl-badge is-${t.tone}`}>{t.status}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function InvoiceDemo() {
  return (
    <Frame label="Lignes d’une facture de vente avec totaux HT, TVA et TTC (données fictives)" className="hm-live-invoice">
      <div className="hl-panel">
        <div className="hl-panel-bar">
          <span className="hl-doc"><FileText size={12} /><b>FA-2026-0092</b></span>
          <span className="hl-badge is-success">Payée</span>
        </div>
        <div className="hl-lines">
          <div className="hl-line"><span>Marbre Carrara blanc — 60×60</span><i>24 × 420</i><b>10 080</b></div>
          <div className="hl-line"><span>Onyx miel — plan vasque</span><i>2 × 1 850</i><b>3 700</b></div>
        </div>
        <div className="hl-totals">
          <span className="hl-pill is-dark"><FileText size={10} />PDF</span>
          <span className="hl-pill"><QrCode size={10} />QR</span>
          <span className="hl-grow" />
          <span className="hl-tot"><i>HT 13 780</i><i>TVA 2 756</i><b>TTC 16 536 MAD</b></span>
        </div>
      </div>
    </Frame>
  );
}

const BUCKETS = [
  { k: 'Courant', v: '18,4 k', w: 46, tone: 'cur' },
  { k: '1–30 j', v: '10,9 k', w: 27, tone: 'b1' },
  { k: '31–60 j', v: '6,9 k', w: 17, tone: 'b2' },
  { k: '+60 j', v: '4,0 k', w: 10, tone: 'b3' },
];

export function AgingDemo() {
  return (
    <Frame label="Balance âgée des créances clients par tranche d’échéance (données fictives)" className="hm-live-aging">
      <div className="hl-panel">
        <div className="hl-stats">
          {BUCKETS.map((b) => (
            <span className="hl-stat" key={b.k}><i>{b.k}</i><b>{b.v}</b></span>
          ))}
        </div>
        <div className="hl-bar">
          {BUCKETS.map((b) => <span key={b.k} className={`is-${b.tone}`} style={{ width: `${b.w}%` }} />)}
        </div>
        <div className="hl-follow">
          <div className="hl-row">
            <b className="hl-num hl-ellipsis">Hôtel Casa Port</b>
            <span className="hl-badge is-danger">+60 j</span>
            <span className="hl-grow" />
            <span className="hl-pill">Relancer</span>
          </div>
          <div className="hl-row">
            <b className="hl-num hl-ellipsis">Atelier Benali</b>
            <span className="hl-badge is-warning">31–60 j</span>
            <span className="hl-grow" />
            <span className="hl-pill">Relancer</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function AgentDemo() {
  return (
    <Frame label="Atlas Agent : question et réponse dans une conversation fictive" className="hm-live-agent">
      <div className="hl-chat">
        <span className="hl-bubble is-user">Combien de ventes cette semaine ?</span>
        <span className="hl-bubble is-bot"><Sparkles size={11} /><span>Cette semaine : <b>23 ventes</b> pour <b>41 860 MAD</b>, +12 % vs la semaine dernière.</span></span>
        <span className="hl-prompt"><Box size={11} /><i>Demandez à Atlas…</i><span className="hl-send"><ArrowUp size={11} /></span></span>
      </div>
    </Frame>
  );
}
