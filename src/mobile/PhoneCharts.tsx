/**
 * Phone home charts — small, touch-friendly SVG charts fed by data the home
 * page already loads (the shared `/api/metrics/daily` series and the monthly
 * finance statement), so they add no request and no D1 read.
 *
 *  - PhoneInOutChart:  encaissements vs décaissements per day (14 days) + net.
 *  - PhoneStockDonut:  en stock / stock bas / rupture (every role may read it).
 *  - PhoneMonthFlow:   where the month's cash went (ventes, dépenses, paie,
 *                      fournisseurs) with the resulting net.
 * Tapping a bar or a slice shows its exact value — no hover needed.
 */
import { useMemo, useState } from 'react';
import { useMetricSeries } from '../lib/metricSeries';
import { getLang, intlLocale, useLang } from '../i18n/core';
import type { FinanceMonthly } from './financeTypes';

const nb = (s: string) => s.replace(/\u202f/g, '\u00a0');
export const fmtInt = (n: number) => nb(new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 0 }).format(Math.round(n)));
/** 1 250 → « 1,3 k », 2 400 000 → « 2,4 M ». */
export function compactMoney(n: number): string {
  const a = Math.abs(n);
  const suffix = (en: string, ar: string) => getLang() === 'ar' ? ar : en;
  if (a >= 1_000_000_000) return `${nb((n / 1_000_000_000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }))} ${suffix('B', 'مليار')}`;
  if (a >= 1_000_000) return `${nb((n / 1_000_000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }))} ${suffix('M', 'مليون')}`;
  if (a >= 10_000) return `${nb(Math.round(n / 1000).toLocaleString(intlLocale()))} ${suffix('k', 'ألف')}`;
  if (a >= 1_000) return `${nb((n / 1000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 }))} ${suffix('k', 'ألف')}`;
  return fmtInt(n);
}
const displayCurrency = (currency: string) => /^(MAD|DH)$/i.test(currency) ? (getLang() === 'ar' ? 'درهم' : getLang() === 'en' ? 'MAD' : 'DH') : currency;
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso.slice(5) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

export function PhoneInOutChart({ currency = 'MAD', days = 14 }: { currency?: string; days?: number }) {
  useLang();
  const { data } = useMetricSeries();
  const [pick, setPick] = useState<number | null>(null);
  const model = useMemo(() => {
    const inS = data?.series.money_in;
    const outS = data?.series.money_out;
    if (!data || !Array.isArray(inS) || !Array.isArray(outS)) return null;
    const n = Math.min(days, data.dates.length);
    const dates = data.dates.slice(-n);
    const ins = inS.slice(-n).map((v) => Math.max(0, Number(v) || 0));
    const outs = outS.slice(-n).map((v) => Math.max(0, Number(v) || 0));
    const totalIn = ins.reduce((a, v) => a + v, 0);
    const totalOut = outs.reduce((a, v) => a + v, 0);
    if (totalIn + totalOut <= 0) return null;
    return { dates, ins, outs, totalIn, totalOut, peak: Math.max(1, ...ins, ...outs) };
  }, [data, days]);
  if (!model) return null;
  const W = 320;
  const H = 96;
  const slot = W / model.dates.length;
  const bw = Math.max(3, Math.min(9, slot / 2 - 2));
  const net = model.totalIn - model.totalOut;
  const sel = pick !== null && pick < model.dates.length ? pick : null;
  return (
    <section className="ph-panel ph-chart" aria-label="Encaissements et décaissements">
      <div className="ph-chart-head">
        <div><h2>Entrées &amp; sorties</h2><p>{model.dates.length} derniers jours</p></div>
        <span className={`ph-chart-net ${net >= 0 ? 'is-up' : 'is-down'}`}>{net >= 0 ? '+' : '−'}{compactMoney(Math.abs(net))} {displayCurrency(currency)}</span>
      </div>
      <div className="ph-chart-legend">
        <span><i className="sw sw-in" />Encaissé <b>{compactMoney(model.totalIn)}</b></span>
        <span><i className="sw sw-out" />Décaissé <b>{compactMoney(model.totalOut)}</b></span>
      </div>
      <svg className="ph-chart-svg" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Encaissé ${fmtInt(model.totalIn)} ${displayCurrency(currency)}, décaissé ${fmtInt(model.totalOut)} ${displayCurrency(currency)}`}>
        <line x1="0" x2={W} y1={H} y2={H} className="ph-chart-axis" />
        {model.dates.map((d, i) => {
          const x = i * slot + slot / 2;
          const hi = (model.ins[i] / model.peak) * (H - 8);
          const ho = (model.outs[i] / model.peak) * (H - 8);
          return (
            <g key={d} className={sel === i ? 'is-sel' : sel !== null ? 'is-dim' : ''} onClick={() => setPick(sel === i ? null : i)}>
              <rect x={i * slot} y="0" width={slot} height={H + 18} fill="transparent" />
              <rect className="bar-in" x={x - bw - 1} y={H - Math.max(hi, model.ins[i] > 0 ? 2 : 0)} width={bw} height={Math.max(hi, model.ins[i] > 0 ? 2 : 0)} rx="2" />
              <rect className="bar-out" x={x + 1} y={H - Math.max(ho, model.outs[i] > 0 ? 2 : 0)} width={bw} height={Math.max(ho, model.outs[i] > 0 ? 2 : 0)} rx="2" />
              {(model.dates.length - 1 - i) % Math.ceil(model.dates.length / 5) === 0 && <text x={x} y={H + 14} textAnchor="middle" className="ph-chart-tick">{dayLabel(d)}</text>}
            </g>
          );
        })}
      </svg>
      <p className="ph-chart-pick" aria-live="polite">
        {sel !== null
          ? <>{dayLabel(model.dates[sel])} · encaissé <b>{fmtInt(model.ins[sel])} {displayCurrency(currency)}</b> · décaissé <b>{fmtInt(model.outs[sel])} {displayCurrency(currency)}</b></>
          : 'Touchez un jour pour voir le détail.'}
      </p>
    </section>
  );
}

export function PhoneStockDonut({ onOpen }: { onOpen?: () => void }) {
  useLang();
  const { data } = useMetricSeries();
  const [pick, setPick] = useState<number | null>(null);
  const parts = useMemo(() => {
    const last = (k: string) => {
      const s = data?.series[k];
      if (!Array.isArray(s)) return null;
      for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return Math.max(0, Number(s[i]) || 0);
      return null;
    };
    const low = last('low_stock');
    const out = last('out_of_stock');
    let ok = last('in_stock');
    const total = last('products');
    if (low === null && out === null) return null;
    if (ok === null && total !== null) ok = Math.max(0, total - (low || 0) - (out || 0));
    const list = [
      { k: 'ok', label: 'En stock', v: ok || 0 },
      { k: 'low', label: 'Stock bas', v: low || 0 },
      { k: 'out', label: 'Rupture', v: out || 0 },
    ];
    return list.reduce((a, p) => a + p.v, 0) > 0 ? list : null;
  }, [data]);
  if (!parts) return null;
  const total = parts.reduce((a, p) => a + p.v, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const healthy = Math.round((parts[0].v / total) * 100);
  const sel = pick !== null ? parts[pick] : null;
  return (
    <section className="ph-panel ph-chart ph-chart--donut" aria-label="Santé du stock">
      <div className="ph-chart-head">
        <div><h2>Santé du stock</h2><p>{fmtInt(total)} références suivies</p></div>
        {onOpen && <button type="button" className="ph-textbtn" onClick={onOpen}>Voir</button>}
      </div>
      <div className="ph-donut-row">
        <svg viewBox="0 0 110 110" className="ph-donut" role="img" aria-label={`${healthy} % des références en stock`}>
          <circle cx="55" cy="55" r={R} className="ph-donut-track" />
          {parts.map((p, i) => {
            const len = (p.v / total) * C;
            const el = p.v > 0 ? (
              <circle key={p.k} cx="55" cy="55" r={R} className={`ph-donut-seg seg-${p.k}${pick === i ? ' is-sel' : ''}`}
                strokeDasharray={`${Math.max(0, len - (len > 4 ? 2 : 0))} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 55 55)"
                onClick={() => setPick(pick === i ? null : i)} />
            ) : null;
            acc += len;
            return el;
          })}
          <text x="55" y="53" textAnchor="middle" className="ph-donut-big">{sel ? fmtInt(sel.v) : `${healthy} %`}</text>
          <text x="55" y="68" textAnchor="middle" className="ph-donut-small">{sel ? sel.label : 'en stock'}</text>
        </svg>
        <ul className="ph-donut-legend">
          {parts.map((p, i) => (
            <li key={p.k}>
              <button type="button" className={pick === i ? 'is-sel' : ''} onClick={() => setPick(pick === i ? null : i)}>
                <i className={`sw seg-${p.k}`} />{p.label}<b>{fmtInt(p.v)}</b>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function PhoneMonthFlow({ finance, currency = 'MAD' }: { finance: FinanceMonthly; currency?: string }) {
  useLang();
  const rows = [
    { k: 'in', label: 'Ventes encaissées', v: Number(finance.sales_received) || 0 },
    { k: 'exp', label: 'Dépenses', v: Number(finance.expenses) || 0 },
    { k: 'pay', label: 'Salaires versés', v: Number(finance.payroll_paid) || 0 },
    { k: 'sup', label: 'Fournisseurs réglés', v: Number(finance.supplier_paid) || 0 },
  ];
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  const out = rows.slice(1).reduce((a, r) => a + r.v, 0);
  const net = rows[0].v - out;
  if (rows.every((r) => r.v === 0)) return null;
  return (
    <div className="ph-flow" aria-label="Flux de trésorerie du mois">
      {rows.map((r) => (
        <div className={`ph-flow-row flow-${r.k}`} key={r.k}>
          <span className="ph-flow-lbl">{r.label}</span>
          <span className="ph-flow-track"><i style={{ width: `${Math.max(r.v > 0 ? 3 : 0, (Math.abs(r.v) / peak) * 100)}%` }} /></span>
          <b className="ph-flow-val">{compactMoney(r.v)}</b>
        </div>
      ))}
      <div className={`ph-flow-net ${net >= 0 ? 'is-up' : 'is-down'}`}>
        <span>Résultat de trésorerie</span>
        <b>{net >= 0 ? '+' : '−'}{fmtInt(Math.abs(net))} {displayCurrency(currency)}</b>
      </div>
    </div>
  );
}
