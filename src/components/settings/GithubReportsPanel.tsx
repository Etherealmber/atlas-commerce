/**
 * Owner panel: crash & user reports → GitHub issues (docs/reports-github.md).
 *
 * v0.9.3 — two channels, two secrets:
 *  - Web app (browser, desktop or phone) → GITHUB_WEB_ISSUE_TOKEN, repo
 *    Etherealmber/atlas-commerce by default;
 *  - Android app (native) → GITHUB_ISSUE_TOKEN, repo
 *    Etherealmber/atlas-commerce-android by default.
 * Each channel can also get an owner-entered token (stored server-side, never
 * echoed back; the environment secret wins). Optional AI triage (Groq) status.
 * Recent crashes are grouped by message so a bug seen on 10 pages is one line.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type GithubChannelStatus, type GithubReportsStatus, type ReportChannel } from '../../api';
import { getRole } from '../../auth';
import './github-reports.css';

const CHANNELS: { id: ReportChannel; title: string; hint: string; defaultRepo: string; secret: string }[] = [
  { id: 'web', title: 'App web', hint: 'Navigateur — bureau et téléphone', defaultRepo: 'Etherealmber/atlas-commerce', secret: 'GITHUB_WEB_ISSUE_TOKEN' },
  { id: 'android', title: 'App Android', hint: 'Application native (APK)', defaultRepo: 'Etherealmber/atlas-commerce-android', secret: 'GITHUB_ISSUE_TOKEN' },
];

type CrashGroup = {
  key: string;
  message: string;
  channel: ReportChannel;
  count: number;
  routes: string[];
  versions: string[];
  issues: { number: number; url: string }[];
  pending: number;
};

function groupCrashes(rows: any[]): CrashGroup[] {
  const map = new Map<string, CrashGroup>();
  for (const r of rows) {
    const channel: ReportChannel = r.channel === 'web' ? 'web' : 'android';
    const message = String(r.message || '').trim();
    const key = `${channel}|${message}`;
    let g = map.get(key);
    if (!g) {
      g = { key, message, channel, count: 0, routes: [], versions: [], issues: [], pending: 0 };
      map.set(key, g);
    }
    g.count += Number(r.count || 1);
    if (r.route && !g.routes.includes(r.route)) g.routes.push(String(r.route));
    if (r.version && !g.versions.includes(r.version)) g.versions.push(String(r.version));
    if (r.issue_url && !g.issues.some((i) => i.url === r.issue_url)) g.issues.push({ number: Number(r.issue_number), url: String(r.issue_url) });
    if (r.status !== 'linked') g.pending += 1;
  }
  return [...map.values()];
}

function ChannelCard({
  ch, status, pending, isOwner, busy, onSave,
}: {
  ch: (typeof CHANNELS)[number];
  status: GithubChannelStatus | undefined;
  pending: number;
  isOwner: boolean;
  busy: boolean;
  onSave: (channel: ReportChannel, token: string, repo: string) => Promise<boolean>;
}) {
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [editing, setEditing] = useState(false);
  const configured = !!status?.configured;
  const source = status?.source;
  return (
    <section className={`ghr-channel${configured ? ' is-on' : ''}`} aria-label={ch.title}>
      <header className="ghr-channel-head">
        <span className={`ghr-dot${configured ? ' is-on' : ''}`} aria-hidden="true" />
        <div className="ghr-channel-titles">
          <strong>{ch.title}</strong>
          <span>{ch.hint}</span>
        </div>
        {pending > 0 && <span className="ghr-badge" title="Rapports en attente d’envoi">{pending} en attente</span>}
      </header>
      <dl className="ghr-meta">
        <div><dt>Dépôt</dt><dd><code>{status?.repo || ch.defaultRepo}</code></dd></div>
        <div>
          <dt>Token</dt>
          <dd>
            {configured
              ? (source === 'env' ? <>Secret <code>{ch.secret}</code></> : 'Token propriétaire (app)')
              : <span className="ghr-warn">Aucun — les rapports restent en file</span>}
          </dd>
        </div>
      </dl>
      {isOwner && source !== 'env' && (
        editing || !configured ? (
          <form
            className="ghr-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await onSave(ch.id, token.trim(), repo.trim())) { setToken(''); setEditing(false); }
            }}
          >
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_… (token « Issues : Read & Write »)"
              autoComplete="off"
              aria-label={`Token GitHub — ${ch.title}`}
            />
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder={`propriétaire/dépôt (défaut : ${ch.defaultRepo})`}
              aria-label={`Dépôt GitHub — ${ch.title}`}
            />
            <div className="ghr-form-actions">
              <button type="submit" className="primary" disabled={busy || !token.trim()}>Enregistrer</button>
              {configured && <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Annuler</button>}
            </div>
          </form>
        ) : (
          <div className="ghr-form-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(true)}>Remplacer le token</button>
            <button type="button" className="secondary ghr-danger" disabled={busy} onClick={() => onSave(ch.id, '', '')}>Effacer</button>
          </div>
        )
      )}
      {isOwner && source === 'env' && (
        <p className="ghr-note">Géré par le secret du Worker — changez-le avec <code>wrangler secret put {ch.secret}</code>.</p>
      )}
    </section>
  );
}

export default function GithubReportsPanel() {
  const isOwner = (typeof getRole === 'function' ? getRole() : '') === 'owner';
  const [status, setStatus] = useState<GithubReportsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [crashes, setCrashes] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [pending, setPending] = useState<Record<ReportChannel, number>>({ web: 0, android: 0 });

  const load = useCallback(async () => {
    try {
      const s = await api.getGithubTokenStatus();
      setStatus(s?.data || null);
    } catch { /* owner/admin only */ }
    try {
      const l = await api.listReports(30);
      setCrashes(l?.data?.crashes || []);
      setReports(l?.data?.user_reports || []);
      const by = l?.data?.pending_by_channel;
      setPending(by ? { web: Number(by.web || 0), android: Number(by.android || 0) } : { web: 0, android: Number(l?.data?.pending || 0) });
    } catch { /* owner/admin only */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const channels = useMemo((): Partial<Record<ReportChannel, GithubChannelStatus>> | null => {
    const c = status?.channels;
    if (c) return c;
    // Older Worker: only the Android channel exists.
    return status ? { android: { configured: status.configured, source: status.source, repo: status.repo } } : null;
  }, [status]);
  const anyConfigured = !!(channels?.web?.configured || channels?.android?.configured);
  const totalPending = pending.web + pending.android;
  const groups = useMemo(() => groupCrashes(crashes), [crashes]);

  async function save(channel: ReportChannel, token: string, repo: string): Promise<boolean> {
    setBusy(true); setMsg(null);
    try {
      const r = await api.saveGithubToken({ token, repo: repo || undefined, channel });
      const label = channel === 'web' ? 'web' : 'Android';
      setMsg({
        ok: true,
        text: token
          ? `Token ${label} validé${r?.data?.login ? ` (compte ${r.data.login})` : ''}. Les rapports en attente partiront automatiquement.`
          : `Token ${label} effacé — les rapports restent en file jusqu’à un nouveau token.`,
      });
      await load();
      return true;
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message || 'Enregistrement impossible.') });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.retryReports();
      const by = r?.data?.by_channel;
      const parts = by
        ? (['web', 'android'] as ReportChannel[]).map((c) => {
            const v = by[c];
            const name = c === 'web' ? 'Web' : 'Android';
            if (!v?.configured) return `${name} : pas de token`;
            return `${name} : ${v.crashes} crash(s), ${v.user_reports} signalement(s)`;
          })
        : [`${r?.data?.crashes ?? 0} crash(s), ${r?.data?.user_reports ?? 0} signalement(s)`];
      const more = r?.data?.more ? ' D’autres éléments attendent (limite de requêtes par envoi) : cliquez à nouveau sur « Envoyer la file », ou laissez le cron quotidien continuer.' : '';
      setMsg({ ok: true, text: `File envoyée — ${parts.join(' · ')}.${more}` });
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message || 'Renvoi impossible.') });
    } finally {
      setBusy(false);
    }
  }

  const triage = status?.triage;

  return (
    <div className="card ghr-panel">
      <div className="ghr-head">
        <div>
          <h2>Rapports &amp; crashs → GitHub</h2>
          <p>
            Les plantages et les « Signaler un problème » deviennent des <strong>issues GitHub</strong>, assainies
            (aucun secret ni donnée personnelle) et dédupliquées. Chaque application a son propre dépôt et son propre token ;
            sans token, tout reste en file (D1) et part dès qu’il est configuré (cron quotidien inclus).
          </p>
        </div>
      </div>

      <div className="ghr-channels">
        {CHANNELS.map((ch) => (
          <ChannelCard
            key={ch.id}
            ch={ch}
            status={channels?.[ch.id]}
            pending={pending[ch.id]}
            isOwner={isOwner}
            busy={busy}
            onSave={save}
          />
        ))}
      </div>

      <div className={`ghr-triage${triage?.enabled ? ' is-on' : ''}`}>
        <span className={`ghr-dot${triage?.enabled ? ' is-on' : ''}`} aria-hidden="true" />
        <div>
          <strong>Triage automatique (IA)</strong>{' '}
          {triage?.enabled ? (
            <span>
              actif — <code>{triage.model}</code> · {triage.used_today}/{triage.daily_limit} analyses aujourd’hui
              {triage.paused_until ? ` · en pause jusqu’à ${new Date(triage.paused_until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (quota)` : ''}
            </span>
          ) : (
            <span>inactif — ajoutez le secret <code>GROQ_ISSUES_API_KEY</code> (ou <code>GROQ_API_KEY</code>) pour un titre clair, une cause probable et une gravité sur chaque nouvelle issue.</span>
          )}
        </div>
      </div>

      {!isOwner && (
        <p className="ghr-note">Seul le propriétaire peut configurer les tokens ; les admins voient la liste ci-dessous.</p>
      )}

      <div className="ghr-actions">
        <button type="button" className="secondary" disabled={busy || !anyConfigured || totalPending === 0} onClick={retry}>
          Envoyer la file ({totalPending})
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={load}>Actualiser</button>
      </div>

      {msg && <p className={`ghr-msg${msg.ok ? ' is-ok' : ' is-err'}`} role="status">{msg.text}</p>}

      {groups.length > 0 && (
        <div className="ghr-list">
          <h3>Crashs récents</h3>
          <ul>
            {groups.map((g) => (
              <li key={g.key}>
                <span className="ghr-count">×{g.count}</span>
                <div className="ghr-item-main">
                  <span className="ghr-item-msg" title={g.message}>{g.message || 'Erreur inconnue'}</span>
                  <span className="ghr-item-sub">
                    <span className={`ghr-chip ghr-chip--${g.channel}`}>{g.channel === 'web' ? 'Web' : 'Android'}</span>
                    {g.routes.slice(0, 4).map((r) => <code key={r}>{r}</code>)}
                    {g.routes.length > 4 && <span>+{g.routes.length - 4}</span>}
                    {g.versions.length > 0 && <span>v{g.versions.slice(0, 2).join(', v')}</span>}
                  </span>
                </div>
                <span className="ghr-item-state">
                  {g.issues.length > 0
                    ? g.issues.slice(0, 2).map((i) => <a key={i.url} href={i.url} target="_blank" rel="noreferrer">#{i.number}</a>)
                    : <em>en attente</em>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {reports.length > 0 && (
        <div className="ghr-list">
          <h3>Signalements utilisateurs</h3>
          <ul>
            {reports.map((r) => (
              <li key={`r-${r.id}`}>
                <span className="ghr-count">R-{r.id}</span>
                <div className="ghr-item-main">
                  <span className="ghr-item-msg" title={String(r.message || '')}>{String(r.message || '')}</span>
                  <span className="ghr-item-sub">
                    <span className={`ghr-chip ghr-chip--${r.channel === 'web' ? 'web' : 'android'}`}>{r.channel === 'web' ? 'Web' : 'Android'}</span>
                    <span>{r.kind}</span>
                    {r.username ? <span>{r.username}</span> : null}
                  </span>
                </div>
                <span className="ghr-item-state">
                  {r.issue_url ? <a href={r.issue_url} target="_blank" rel="noreferrer">#{r.issue_number}</a> : <em>en attente</em>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {crashes.length === 0 && reports.length === 0 && (
        <p className="ghr-note">Aucun rapport pour l’instant.</p>
      )}
    </div>
  );
}
