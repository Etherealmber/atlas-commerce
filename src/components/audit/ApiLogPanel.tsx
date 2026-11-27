import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Globe2, RefreshCw, Search, ShieldAlert, Timer } from 'lucide-react';
import { api } from '../../api';
import { ListPager } from '../ui/ListPager';
import AuditIpCell from './AuditIpCell';
import { createPortal } from 'react-dom';
import { AuditRequestDetails } from './AuditRequestDetails';
import { AuditAgentExplanation } from './AuditAgentExplanation';
import { t, useLang } from '../../i18n/core';
import TopPageActions from '../TopPageActions';
import DatePicker from '../DatePicker';
import Select from '../ui/Select';
import './journal-archive.css';

const PAGE = 25;
type Range = '24h' | '7d' | '30d';
type StatusFilter = '' | 'ok' | 'error' | 'auth';

function when(s?: string) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return d.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-MA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusTone(st: number) {
  if (st >= 500) return 'danger';
  if (st === 401 || st === 403 || st === 429) return 'warn';
  if (st >= 400) return 'muted';
  return 'ok';
}

/**
 * « Journal des appels API »: eligible API calls, including failures.
 * Retention is not guaranteed until verified archival and purge are active. Each row shows the city, country and operator (VPN flag),
 * with inspectable request details.
 */
export default function ApiLogPanel({ range, dockActions = true, forceR2 = false }: { range: Range; dockActions?: boolean; forceR2?: boolean }) {
  useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const statsCache = useRef<Partial<Record<Range, { value: any; at: number }>>>({});
  const generation = useRef(0);
  const lastAttempt = useRef(0);
  const [error, setError] = useState(false);
  const [r2Only, setR2Only] = useState(forceR2);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  useEffect(() => {
    if (!detail) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const load = useCallback(async (cursor: string | null, reset: boolean, query = q) => {
    const requestId = ++generation.current;
    lastAttempt.current = Date.now();
    setLoading(true); setError(false);
    const cached = statsCache.current[range];
    const useCache = !!cached && Date.now() - cached.at < 60_000;
    if (reset) setStats(useCache ? cached.value : null);
    try {
      const r = await api.getApiLog({ limit: PAGE, cursor, range, status: status || undefined, q: query || undefined, stats: reset && !useCache });
      if (requestId !== generation.current) return;
      setR2Only(false);
      setRows(Array.isArray(r?.data) ? r.data : []);
      setNext(r?.meta?.has_more ? r.meta.next_cursor ?? null : null);
      if (r?.meta?.stats && typeof r.meta.stats === 'object') {
        statsCache.current[range] = { value: r.meta.stats, at: Date.now() };
        setStats(r.meta.stats);
      }
      if (reset) setStack([null]);
    } catch (err: any) {
      if (requestId !== generation.current) return;
      setR2Only(err?.code === 'JOURNAL_R2_ONLY');
      setRows([]);
      setNext(null); setError(err?.code !== 'JOURNAL_R2_ONLY');
    } finally {
      if (requestId === generation.current) setLoading(false);
    }
  }, [range, status, q]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!forceR2) void load(null, true); }, [range, status, forceR2]);
  useEffect(() => {
    if (forceR2 || r2Only) return;
    const refreshIfStale = () => {
      if (document.visibilityState === 'visible' && stack.length === 1 && Date.now() - lastAttempt.current >= 300_000) void load(null, true);
    };
    const timer = window.setInterval(refreshIfStale, 60_000);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshIfStale); };
  }, [load, stack.length, forceR2, r2Only]);
  useEffect(() => () => { generation.current++; }, []);

  const days = Array.isArray(stats?.by_day) ? stats.by_day.slice(-14) : [];
  const maxDay = Math.max(1, ...days.map((item: any) => Number(item.n || 0)));
  const errRate = stats?.total ? Math.round((Number(stats.errors || 0) / Number(stats.total)) * 1000) / 10 : 0;

  if (r2Only) return <section id="journal-api" className="ac-panel ac-apilog-panel" aria-label="Journal des appels API">
    <h3>Journal des appels API et audit</h3>
    <p>Consultez les entrées archivées par date. Les statistiques, filtres et exports de l’ancienne vue ne sont pas encore disponibles pour R2.</p>
    <JournalArchive onOpen={setDetail} r2Only />
    {detail && createPortal(<div className="audit-detail-modal-backdrop" role="presentation" onClick={() => setDetail(null)}>
      <div className="audit-detail-modal audit-detail-modal--expanded card" role="dialog" aria-modal="true" aria-label="Détails de la requête" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setDetail(null); }}>
        <div className="audit-detail-heading"><h3>Détails de la requête</h3><button type="button" className="secondary" aria-label="Fermer" onClick={() => setDetail(null)}>×</button></div>
        <p className="audit-request-summary"><bdi dir="ltr" translate="no">{detail.method} {detail.path} · {detail.status} · {detail.ms} ms</bdi></p>
        <AuditRequestDetails row={detail} kind="api" />
      </div>
    </div>, document.body)}
  </section>;

  return (
    <section id="journal-api" className="ac-panel ac-apilog-panel" aria-label="Journal des appels API">
      <TopPageActions enabled={dockActions}><button type="button" className="secondary" title="Actualiser" aria-label="Actualiser" disabled={loading} onClick={() => { delete statsCache.current[range]; void load(null, true); }}><RefreshCw size={15} aria-hidden="true" /><span className="tpa-label">Actualiser</span></button></TopPageActions>
      <div className="ac-apilog-head">
        <div>
          <h3><Activity size={16} strokeWidth={2.2} aria-hidden="true" /> Journal des appels API</h3>
          <p className="ac-apilog-sub">Requêtes enregistrées, y compris les échecs ; les vérifications QR en attente et certaines sondes sont exclues.</p>
        </div>

      </div>

      <div className="ac-metric-grid ac-apilog-kpis">
        <div className="ac-metric"><div className="ac-metric-top"><span>Appels</span><Activity size={14} aria-hidden="true" /></div><div className="as-value">{stats?.total ?? '—'}</div><div className="ac-kpi-sub">{stats ? `${stats.unique_ips} IP distinctes` : '\u00a0'}</div></div>
        <div className="ac-metric"><div className="ac-metric-top"><span>Échecs</span><AlertTriangle size={14} aria-hidden="true" /></div><div className="as-value">{stats?.errors ?? '—'}</div><div className="ac-kpi-sub">{stats ? `${errRate} % · ${stats.auth_failures} refus d’accès` : '\u00a0'}</div></div>
        <div className="ac-metric"><div className="ac-metric-top"><span>VPN / hébergeurs</span><ShieldAlert size={14} aria-hidden="true" /></div><div className="as-value">{stats?.risky_calls ?? '—'}</div><div className="ac-kpi-sub">appels depuis un réseau anonymisant</div></div>
        <div className="ac-metric"><div className="ac-metric-top"><span>Temps moyen</span><Timer size={14} aria-hidden="true" /></div><div className="as-value">{stats ? `${stats.avg_ms} ms` : '—'}</div><div className="ac-kpi-sub">{stats?.top_paths?.[0] ? `${stats.top_paths[0].method} ${stats.top_paths[0].path}` : '\u00a0'}</div></div>
      </div>

      <div className="ac-audit-charts-grid ac-apilog-charts">
        <section className="ac-panel" aria-label={t('Activité API dans le temps')}>
          <div className="ac-panel-head"><div><h3><Activity size={16} aria-hidden="true" /> {t('Activité API dans le temps')}</h3>
            <p>{t('Appels enregistrés par jour UTC · 14 derniers jours affichés')}</p></div></div>
          {days.length ? <div className="ac-audit-bars">{days.map((day: any) => {
            const count = Number(day.n || 0);
            return <div className="ac-audit-bar-col" key={day.day} title={`${day.day} UTC: ${count}`}>
              <span className="ac-audit-bar-val">{count}</span><div className="ac-audit-bar-track"><div className="ac-audit-bar" style={{ height: `${Math.max(6, Math.round(count / maxDay * 100))}%` }} /></div>
              <span className="ac-audit-bar-lbl">{String(day.day).slice(5)}</span>
            </div>;
          })}</div> : <div className="atlas-empty">{t('Pas assez de données sur cette période.')}</div>}
        </section>
        <section className="ac-panel ac-apilog-chart" aria-label={t('Chemins API les plus appelés')}>
          <div className="ac-panel-head"><div><h3>{t('Chemins API les plus appelés')}</h3>
            <p>{t('Appels enregistrés sur la période · statistiques indépendantes des filtres')}</p></div></div>
          {stats?.top_paths?.length ? stats.top_paths.map((item: any) => <div className="ac-apilog-chart-row" key={`${item.method}:${item.path}`}>
            <code dir="ltr" translate="no">{item.method} {item.path}</code>
            <span className="ac-audit-hbar-track" aria-hidden="true"><span className="ac-audit-hbar-fill" style={{ display: 'block', width: `${Math.max(0, Number(item.n) / Number(stats.top_paths[0].n) * 100)}%` }} /></span>
            <span>{item.n}</span>
          </div>) : <div className="atlas-empty">{t('Pas assez de données sur cette période.')}</div>}
        </section>
      </div>
      {error && <p role="alert">{t('Impossible de charger le journal. Réessayez plus tard.')}</p>}
      <div className="ac-audit-filters ac-apilog-filters">
        <div className="ac-audit-search-wrap">
          <Search className="ac-audit-search-ico" size={15} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            placeholder="Rechercher (chemin, utilisateur, IP, opérateur, ville…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void load(null, true); }}
          />
        </div>
        <div className="ac-dash-period-pills ac-apilog-status" role="group" aria-label="Statut">
          {([['', 'Tous'], ['ok', 'Réussis'], ['error', 'Échecs'], ['auth', 'Refus 401/403']] as [StatusFilter, string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" aria-pressed={status === k} className={`ac-seg-btn${status === k ? ' is-active' : ''}`} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="ac-audit-table-wrap">
        <table className="audit-table ac-apilog-table">
          <thead>
            <tr>
              <th>{t('Horodatage (heure locale)')}</th>
              <th>Requête</th>
              <th>Statut</th>
              <th>Utilisateur</th>
              <th>IP · lieu · réseau</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {!loading && !error && rows.length === 0 ? (
              <tr><td colSpan={6} className="audit-empty">Aucun appel pour ces filtres.</td></tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="ac-audit-row">
                <td className="ac-audit-time">{when(r.created_at)}</td>
                <td>
                  <div className="ac-apilog-req">
                    <span className={`ac-apilog-method ac-apilog-method--${String(r.method).toLowerCase()}`}>{r.method}</span>
                    <code translate="no">{r.path}</code>
                    <span className="ac-apilog-ms">{r.ms} ms</span>
                  </div>
                </td>
                <td><span className={`ac-apilog-status ac-apilog-status--${statusTone(Number(r.status))}`}>{r.status}</span></td>
                <td translate="no">{r.username || <span className="muted">anonyme</span>}</td>
                <td>
                  <AuditIpCell ip={r.ip} geo={{ country: r.country, city: r.city, region: r.region, asn: r.asn, as_org: r.as_org, ...r.network }} />
                </td>
                <td className="ac-apilog-actions">
                  <button type="button" className="secondary" onClick={() => setDetail(r)}>Détails</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ac-audit-pager">
        <span className="ac-audit-pager-meta"><Globe2 size={13} aria-hidden="true" /> Page {stack.length} · {rows.length} affiché{rows.length > 1 ? 's' : ''}</span>
        <ListPager
          page={stack.length - 1}
          hasMore={Boolean(next)}
          disabled={loading}
          onChange={(target) => {
            const cur = stack.length - 1;
            if (target < cur) {
              const s = stack.slice(0, target + 1);
              setStack(s);
              void load(s[s.length - 1] ?? null, false);
            } else if (target > cur && next) {
              setStack((p) => [...p, next]);
              void load(next, false);
            }
          }}
        />
      </div>
      <JournalArchive onOpen={setDetail} />
      {detail && createPortal(<div className="audit-detail-modal-backdrop" role="presentation" onClick={() => setDetail(null)}>
        <div className="audit-detail-modal audit-detail-modal--expanded card" role="dialog" aria-modal="true" aria-labelledby="api-log-detail-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setDetail(null); }}>
          <div className="audit-detail-heading"><h3 id="api-log-detail-title">Détails de la requête</h3><button type="button" className="secondary" aria-label="Fermer" onClick={() => setDetail(null)}>×</button></div>
          <p className="audit-request-summary"><bdi dir="ltr" translate="no">{detail.method} {detail.path} · {detail.status} · {detail.ms} ms</bdi></p>
          {Number(detail.id) > 0 && <AuditAgentExplanation key={detail.id} id={Number(detail.id)} kind="api" />}
          <h4>Détails de la connexion</h4>
          <AuditRequestDetails row={detail} kind="api" />
          <button type="button" className="secondary" onClick={() => setDetail(null)}>Fermer</button>
        </div>
      </div>, document.body)}
    </section>
  );
}

/** R2 entries are decrypted in bounded pages. Search covers loaded entries only. */
function JournalArchive({ onOpen, r2Only = false }: { onOpen: (row: any) => void; r2Only?: boolean }) {
  type Entry = { key: string; row: Record<string, any> | null; unreadable: boolean };
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<'api' | 'audit'>('api');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [auditEntry, setAuditEntry] = useState<Record<string, any> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const load = async (next?: string) => {
    const requestId = ++generation.current;
    setBusy(true); setMessage('');
    try {
      const result = await api.listJournalArchiveEntries(day, next, kind);
      if (requestId !== generation.current) return;
      setEntries(current => next ? [...current, ...result.data] : result.data);
      setCursor(result.meta.next_cursor);
      if (!result.data.length && !next) setMessage(t('Aucune entrée archivée pour cette date.'));
    } catch { if (requestId === generation.current) { if (!next) setEntries([]); setMessage(t('Archive indisponible ou non configurée.')); } }
    finally { if (requestId === generation.current) setBusy(false); }
  };
  useEffect(() => {
    if (r2Only && day) void load();
    return () => { generation.current++; };
  }, [day, kind, r2Only]);
  const reset = () => { generation.current++; setEntries([]); setCursor(null); setSelected(''); setAuditEntry(null); setMessage(''); setBusy(false); };
  const label = (entry: Entry) => {
    if (!entry.row) return `${entry.key.split('/').pop()?.slice(0, 23) || '—'} · Lecture impossible`;
    const row = entry.row;
    return kind === 'api'
      ? `${when(row.created_at)} · ${row.method || '—'} ${row.path || '—'} · ${row.status ?? '—'} · ${row.username || 'anonyme'}`
      : `${when(row.created_at)} · ${row.action || '—'} · ${row.entity || '—'} · ${row.username || '—'}`;
  };
  const filtered = entries.filter(entry => label(entry).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const current = filtered.find(entry => entry.key === selected);
  return <details className="ac-panel ac-journal-archive" open={r2Only || undefined}>
    <summary>{t('Archive chiffrée des appels API')} / Audit</summary>
    {!r2Only && <p>{t('Les statistiques et filtres ci-dessus concernent uniquement le journal D1. L’archive est consultable par jour, séparément.')}</p>}
    <div className="ac-journal-archive-controls">
      <label>Journal<Select value={kind} disabled={busy} aria-label="Journal" onChange={e => { reset(); setKind(e.target.value as 'api' | 'audit'); }}><option value="api">API</option><option value="audit">Audit</option></Select></label>
      <label htmlFor="journal-archive-day">{t('Date UTC')}<DatePicker id="journal-archive-day" value={day} onChange={value => { reset(); setDay(value); }} /></label>
      <button className="secondary" type="button" disabled={busy || !day} onClick={() => { setSelected(''); void load(); }}>{busy ? 'Chargement…' : t('Afficher les archives')}</button>
    </div>
    {message && <p role="status">{message}</p>}
    {entries.some(entry => entry.unreadable) && <p role="alert">Certaines entrées R2 ne peuvent pas être déchiffrées ou ont disparu. Vérifiez la clé et la configuration du journal.</p>}
    {entries.length > 0 && <div className="ac-journal-browser">
      <label>Rechercher dans les entrées chargées<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Chemin, action, utilisateur, statut…" /></label>
      <label>Entrée archivée<Select aria-label="Entrée archivée" value={filtered.some(entry => entry.key === selected) ? selected : ''} onChange={e => setSelected(e.target.value)}>
        <option value="">Sélectionner une entrée</option>
        {filtered.map(entry => <option key={entry.key} value={entry.key} disabled={entry.unreadable}>{label(entry)}</option>)}
      </Select></label>
      <button className="secondary" type="button" disabled={!current?.row || current.unreadable} onClick={() => { if (!current?.row) return; if (kind === 'audit') setAuditEntry(current.row); else onOpen(current.row); }}>Voir les détails</button>
      <p>{filtered.length} / {entries.length} entrées chargées. La recherche ne couvre que ces entrées{cursor ? ' ; chargez la suite pour élargir la recherche' : ''}.</p>
    </div>}
    {cursor && <button className="secondary" type="button" disabled={busy} onClick={() => void load(cursor)}>{t('Afficher plus')}</button>}
    {auditEntry && createPortal(<div className="audit-detail-modal-backdrop" role="presentation" onClick={() => setAuditEntry(null)}><div className="audit-detail-modal audit-detail-modal--expanded card" role="dialog" aria-modal="true" aria-label="Détails de l’événement audit" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setAuditEntry(null); }}>
      <div className="audit-detail-heading"><h3>Détails de l’événement audit</h3><button type="button" className="secondary" aria-label="Fermer" onClick={() => setAuditEntry(null)}>×</button></div>
      <dl className="audit-detail-dl">{(['created_at', 'username', 'role', 'action', 'entity', 'entity_id', 'detail'] as const).map(field => auditEntry[field] != null && auditEntry[field] !== '' ? <div key={field}><dt>{field}</dt><dd><bdi dir="auto">{String(auditEntry[field])}</bdi></dd></div> : null)}</dl>
      <AuditRequestDetails row={auditEntry} kind="audit" />
    </div></div>, document.body)}
  </details>;
}
