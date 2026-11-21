import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getBase } from '../api';
import { getToken } from '../auth';
import { getCachedFingerprint } from '../fingerprint';
import PhoneDialog from './PhoneDialog';
import { readReportBytes } from './reportResponse';

const sections = [['balance', 'Balance'], ['stock', 'Stock'], ['receivables', 'Créances clients'], ['payables', 'Fournisseurs'], ['employees', 'Employés & paie'], ['aging', 'Balance âgée'], ['tva', 'TVA']] as const;
const periods = [['month', 'Ce mois'], ['3m', '3 mois'], ['6m', '6 mois'], ['12m', '12 mois'], ['year', 'Année en cours'], ['custom', 'Du… au…']] as const;
type Selection = { period: string; from: string; to: string; sections: string[] };
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/** The report is server-generated, but still rendered as untrusted HTML in an isolated frame.
 * Remove navigable URLs, including temporary tickets, before inserting it. */
export function isolateReportHtml(html: string, sectionIndex?: number): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, iframe, object, embed, form, base, link, meta[http-equiv], main.report-content > nav').forEach(el => el.remove());
  if (sectionIndex !== undefined) parsed.querySelectorAll('main.report-content > section').forEach((el, index) => { if (index !== sectionIndex) el.remove(); });
  parsed.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || /(^|:)href$/i.test(attr.name) || ['src', 'srcset', 'action', 'formaction'].includes(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }
  });
  const csp = parsed.createElement('meta'); csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'");
  parsed.head.insertBefore(csp, parsed.head.firstChild);
  return '<!doctype html>' + parsed.documentElement.outerHTML;
}

function ReportReader({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const [html, setHtml] = useState(''); const [error, setError] = useState(''); const [tab, setTab] = useState('overview');
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    (async () => {
      try {
        const token = getToken(); if (!token) throw new Error('Session expirée.');
        const fp = await getCachedFingerprint(); if (cancelled) return;
        const query = new URLSearchParams({ period: selection.period, sections: selection.sections.join(',') });
        if (selection.period === 'custom') { query.set('from', selection.from); query.set('to', selection.to); }
        const res = await fetch(`${getBase()}/api/reports/combined?${query}`, { headers: { Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': fp, Accept: 'text/html' }, cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!res.ok || !(res.headers.get('content-type') || '').toLowerCase().includes('text/html')) throw new Error('Rapport indisponible. Vérifiez votre accès ou réessayez.');
        const text = new TextDecoder().decode(await readReportBytes(res, 5 * 1024 * 1024));
        if (!cancelled) setHtml(text);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Rapport indisponible.'); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [selection]);
  return <PhoneDialog titleId="bundle-title" onClose={onClose} className="ph-report-modal"><div className="ph-report-viewer">
    <header className="ph-report-header"><button type="button" aria-label="Fermer le rapport" onClick={onClose}><X size={20} /></button><div><h2 id="bundle-title">Pack de rapports</h2><small>Lecture sécurisée dans Atlas</small></div></header>
    {error && <p className="ph-report-error" role="alert">{error}</p>}
    {!html && !error && <p role="status">Préparation du rapport…</p>}
    {html && <><div className="ph-report-tabs" aria-label="Rubriques du rapport">{['overview', ...selection.sections].map(key => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{key === 'overview' ? 'Aperçu' : sections.find(section => section[0] === key)?.[1]}</button>)}</div><iframe title="Pack de rapports financiers" sandbox="" referrerPolicy="no-referrer" srcDoc={isolateReportHtml(html, tab === 'overview' ? undefined : selection.sections.indexOf(tab))} className="ph-report-frame" /></>}
  </div></PhoneDialog>;
}

export default function PhoneReportBundle({ onClose }: { onClose: () => void }) {
  const today = localDate();
  const [period, setPeriod] = useState('month'); const [from, setFrom] = useState(today.slice(0, 8) + '01'); const [to, setTo] = useState(today);
  const [selected, setSelected] = useState<string[]>(sections.map(s => s[0])); const [ready, setReady] = useState<Selection | null>(null);
  const valid = period !== 'custom' || (!!from && !!to && from <= to && to <= today);
  if (ready) return <ReportReader selection={ready} onClose={onClose} />;
  return <PhoneDialog titleId="bundle-select-title" onClose={onClose}><div className="ph-bundle-select"><h2 id="bundle-select-title">Personnaliser le rapport</h2><p>Choisissez une période et les rubriques à consulter.</p><h3>PÉRIODE</h3><div className="ph-bundle-chips">{periods.map(([key, label]) => <button type="button" key={key} aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>)}</div>
    {period === 'custom' ? <><div className="ph-bundle-dates"><label>Du<input type="date" max={today} value={from} onChange={e => setFrom(e.target.value)} /></label><label>Au<input type="date" min={from} max={today} value={to} onChange={e => setTo(e.target.value)} /></label></div>{!valid && <p role="alert">Vérifiez les dates : début avant fin, et aucune date future.</p>}</> : <p>Période calculée par le serveur dans son fuseau financier.</p>}
    <h3>RUBRIQUES</h3><div className="ph-bundle-chips">{sections.map(([key, label]) => <button type="button" key={key} aria-pressed={selected.includes(key)} onClick={() => setSelected(old => old.includes(key) ? old.filter(s => s !== key) : [...old, key])}>{label}</button>)}</div><p>Les rubriques sélectionnées s’ouvrent dans Atlas.</p><div className="pb-form-actions"><button type="button" onClick={onClose}>Annuler</button><button type="button" disabled={!valid || !selected.length} onClick={() => setReady({ period, from, to, sections: selected })}>Préparer</button></div></div></PhoneDialog>;
}
