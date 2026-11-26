import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Globe2, RefreshCw, Search, ShieldAlert, Timer } from 'lucide-react';
import { api } from '../../api';
import { ListPager } from '../ui/ListPager';
import AuditIpCell from './AuditIpCell';
import { createPortal } from 'react-dom';
import { AuditRequestDetails } from './AuditRequestDetails';
import { t, useLang } from '../../i18n/core';

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
 * « Journal des appels API »: eligible API calls, including failures, kept
 * for 30 days. Each row shows the city, country and operator (VPN flag),
 * with inspectable request details.
 */
export default function ApiLogPanel() {
  useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<Range>('24h');
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
    setLoading(true);
    try {
      const r = await api.getApiLog({ limit: PAGE, cursor, range, status: status || undefined, q: query || undefined, stats: reset });
      setRows(Array.isArray(r?.data) ? r.data : []);
      setNext(r?.meta?.has_more ? r.meta.next_cursor ?? null : null);
      if (r?.meta?.stats && typeof r.meta.stats === 'object') setStats(r.meta.stats);
      if (reset) setStack([null]);
    } catch {
      setRows([]);
      setNext(null);
    } finally {
      setLoading(false);
    }
  }, [range, status, q]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(null, true); }, [range, status]);

  const errRate = stats?.total ? Math.round((Number(stats.errors || 0) / Number(stats.total)) * 1000) / 10 : 0;

  return (
    <section className="ac-panel ac-apilog-panel" aria-label="Journal des appels API">
      <div className="ac-apilog-head">
        <div>
          <h3><Activity size={16} strokeWidth={2.2} aria-hidden="true" /> Journal des appels API</h3>
          <p className="ac-apilog-sub">{t('Requêtes enregistrées, y compris les échecs ; les vérifications QR en attente et certaines sondes sont exclues. Conservation : {n} jours.', { n: stats?.retention_days ?? 30 })}</p>
        </div>
        <div className="ac-apilog-tools">
          <div className="ac-dash-period-pills" role="group" aria-label="Période">
            {(['24h', '7d', '30d'] as Range[]).map((r) => (
              <button key={r} type="button" aria-pressed={range === r} className={`ac-seg-btn${range === r ? ' is-active' : ''}`} onClick={() => setRange(r)}>
                {r === '24h' ? '24 h' : r === '7d' ? '7 j' : '30 j'}
              </button>
            ))}
          </div>
          <button type="button" className="secondary ac-audit-action-btn" disabled={loading} onClick={() => void load(null, true)}>
            <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
            <span>{loading ? 'Chargement…' : 'Actualiser'}</span>
          </button>
        </div>
      </div>

      <div className="ac-metric-grid ac-apilog-kpis">
        <div className="ac-metric"><div className="ac-metric-top"><span>Appels</span><Activity size={14} aria-hidden="true" /></div><div className="as-value">{stats?.total ?? '—'}</div><div className="ac-kpi-sub">{stats ? `${stats.unique_ips} IP distinctes` : '\u00a0'}</div></div>
        <div className="ac-metric"><div className="ac-metric-top"><span>Échecs</span><AlertTriangle size={14} aria-hidden="true" /></div><div className="as-value">{stats?.errors ?? '—'}</div><div className="ac-kpi-sub">{stats ? `${errRate} % · ${stats.auth_failures} refus d’accès` : '\u00a0'}</div></div>
        <div className="ac-metric"><div className="ac-metric-top"><span>VPN / hébergeurs</span><ShieldAlert size={14} aria-hidden="true" /></div><div className="as-value">{stats?.risky_calls ?? '—'}</div><div className="ac-kpi-sub">appels depuis un réseau anonymisant</div></div>
        <div className="ac-metric"><div className="ac-metric-top"><span>Temps moyen</span><Timer size={14} aria-hidden="true" /></div><div className="as-value">{stats ? `${stats.avg_ms} ms` : '—'}</div><div className="ac-kpi-sub">{stats?.top_paths?.[0] ? `${stats.top_paths[0].method} ${stats.top_paths[0].path}` : '\u00a0'}</div></div>
      </div>

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
              <th>Horodatage</th>
              <th>Requête</th>
              <th>Statut</th>
              <th>Utilisateur</th>
              <th>IP · lieu · réseau</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
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
        <div className="audit-detail-modal card" role="dialog" aria-modal="true" aria-labelledby="api-log-detail-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setDetail(null); }}>
          <div className="audit-detail-heading"><h3 id="api-log-detail-title">Détails de la requête</h3><button type="button" className="secondary" aria-label="Fermer" onClick={() => setDetail(null)}>×</button></div>
          <p><bdi dir="ltr" translate="no">{detail.method} {detail.path} · {detail.status} · {detail.ms} ms</bdi></p>
          <AuditRequestDetails row={detail} kind="api" />
          <button type="button" className="secondary" onClick={() => setDetail(null)}>Fermer</button>
        </div>
      </div>, document.body)}
    </section>
  );
}

/** Separate archive browser: current D1 KPIs and filters do not include R2. */
function JournalArchive({ onOpen }: { onOpen: (row: any) => void }) {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [keys, setKeys] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async (next?: string) => {
    setBusy(true); setMessage('');
    try {
      const result = await api.listJournalArchive(day, next);
      setKeys(current => next ? [...current, ...result.data] : result.data);
      setCursor(result.meta.next_cursor);
      if (!result.data.length && !next) setMessage(t('Aucune entrée archivée pour cette date.'));
    } catch { setKeys([]); setCursor(null); setMessage(t('Archive indisponible ou non configurée.')); }
    finally { setBusy(false); }
  };
  const open = async (key: string) => {
    setBusy(true); setMessage('');
    try { const result = await api.getJournalArchiveItem(key); onOpen(result.data); }
    catch { setMessage(t('Impossible de lire cette entrée archivée.')); }
    finally { setBusy(false); }
  };
  return <details className="ac-panel">
    <summary>{t('Archive chiffrée des appels API')}</summary>
    <p>{t('Les statistiques et filtres ci-dessus concernent uniquement le journal D1. L’archive est consultable par jour, séparément.')}</p>
    <label>{t('Date UTC')} <input type="date" value={day} onChange={e => { setDay(e.target.value); setKeys([]); setCursor(null); setMessage(''); }} /></label>{' '}
    <button className="secondary" type="button" disabled={busy || !day} onClick={() => void load()}>{t('Afficher les archives')}</button>
    {message && <p role="status">{message}</p>}
    <ul>{keys.map((key, index) => <li key={key}><button className="secondary" type="button" disabled={busy} onClick={() => void open(key)}><bdi dir="ltr">{key.split('/').pop()?.slice(0, 23) || index + 1}</bdi></button></li>)}</ul>
    {cursor && <button className="secondary" type="button" disabled={busy} onClick={() => void load(cursor)}>{t('Afficher plus')}</button>}
  </details>;
}
