/**
 * v260 — Owner panel: crash & user reports → GitHub issues.
 * (docs/reports-github.md)
 *
 * - Configure the fine-grained PAT used to open issues (stored server-side in
 *   app_config, never echoed back; env GITHUB_ISSUE_TOKEN secret wins).
 * - Show recent crashes (deduplicated by fingerprint) and user reports with
 *   their GitHub issue links and the pending-queue count.
 * - "Renvoyer la file" drains queued reports (also retried by the daily cron).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { getRole } from '../../auth';

type Status = { configured: boolean; source: 'env' | 'app' | null; repo: string };

export default function GithubReportsPanel() {
  const isOwner = (typeof getRole === 'function' ? getRole() : '') === 'owner';
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [crashes, setCrashes] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      const s = await api.getGithubTokenStatus();
      setStatus(s?.data || null);
      setRepo(s?.data?.repo || '');
    } catch { /* panel stays collapsed */ }
    try {
      const l = await api.listReports(15);
      setCrashes(l?.data?.crashes || []);
      setReports(l?.data?.user_reports || []);
      setPending(Number(l?.data?.pending || 0));
    } catch { /* owner/admin only */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveToken(clear = false) {
    setBusy(true); setMsg(null);
    try {
      const value = clear ? '' : token.trim();
      if (!clear && !value) { setMsg({ ok: false, text: 'Collez un token GitHub (ou laissez vide pour effacer).' }); return; }
      const r = await api.saveGithubToken({ token: value, repo: repo.trim() || undefined });
      setMsg({
        ok: true,
        text: clear
          ? 'Token effacé — les rapports restent en file et partiront quand un token sera reconfiguré.'
          : `Token enregistré et validé${r?.data?.login ? ` (compte ${r.data.login})` : ''}. Les rapports en attente partiront automatiquement.`,
      });
      setToken('');
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message || 'Enregistrement impossible.') });
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.retryReports();
      setMsg({ ok: true, text: `File renvoyée : ${r?.data?.crashes ?? 0} crash(s) et ${r?.data?.user_reports ?? 0} signalement(s) créés sur GitHub.` });
      await load();
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message || 'Renvoi impossible.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Rapports &amp; crashs → GitHub</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
        Les plantages détectés par l’application et les signalements des utilisateurs
        (« Signaler un problème » dans À propos) deviennent des <strong>issues GitHub</strong> dans votre dépôt —
        dédupliqués par empreinte pour les crashs, sans données personnelles ni secrets.
        Sans token, tout est gardé en file (D1) et part automatiquement dès qu’il est configuré (cron quotidien inclus).
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
        Token requis : PAT « fine-granted » avec <strong>Issues : Read &amp; Write</strong> sur le dépôt —{' '}
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
          github.com/settings/personal-access-tokens/new
        </a>{' '}
        (gratuit). Détails : <code>docs/reports-github.md</code>.
      </p>

      <p style={{ fontSize: 13, marginTop: 10 }}>
        État : {status === null ? '…' : status.configured
          ? <>✓ configuré ({status.source === 'env' ? 'secret environnement' : 'token propriétaire'}) — dépôt <code>{status.repo}</code></>
          : <>✗ aucun token — les rapports s’accumulent en file (<strong>{pending}</strong> en attente)</>}
      </p>

      {isOwner && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_… (coller le token)"
            autoComplete="off"
            style={{ flex: '2 1 240px', borderRadius: 12, padding: '10px 12px', fontSize: 13 }}
          />
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="propriétaire/dépôt (défaut : Etherealmber/atlas-commerce)"
            style={{ flex: '1 1 220px', borderRadius: 12, padding: '10px 12px', fontSize: 13 }}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => saveToken(false)} style={{ borderRadius: 12, minHeight: 44, padding: '0 16px' }}>
            Enregistrer
          </button>
          {status?.configured && status.source === 'app' && (
            <button type="button" className="secondary" disabled={busy} onClick={() => saveToken(true)} style={{ borderRadius: 12, minHeight: 44, padding: '0 16px' }}>
              Effacer
            </button>
          )}
        </div>
      )}
      {!isOwner && (
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Seul le propriétaire peut configurer le token ; les admins voient la liste ci-dessous.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <button type="button" className="secondary" disabled={busy || !status?.configured} onClick={retry} style={{ borderRadius: 12, minHeight: 40, padding: '0 14px', fontSize: 13 }}>
          Renvoyer la file ({pending})
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={load} style={{ borderRadius: 12, minHeight: 40, padding: '0 14px', fontSize: 13 }}>
          Actualiser
        </button>
      </div>

      {msg && (
        <p style={{ fontSize: 13, marginTop: 10, color: msg.ok ? '#15803d' : '#b91c1c' }}>{msg.text}</p>
      )}

      {crashes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Crashs récents</h3>
          <ul style={{ fontSize: 12.5, lineHeight: 1.5, paddingLeft: 18, color: 'var(--muted)' }}>
            {crashes.map((cr) => (
              <li key={`c-${cr.id}`}>
                <code>×{cr.count}</code> {String(cr.message || '').slice(0, 90)}
                {cr.route ? <> · <code>{cr.route}</code></> : null} · v{cr.version || '?'}{' '}
                {cr.issue_url
                  ? <a href={cr.issue_url} target="_blank" rel="noreferrer">issue #{cr.issue_number}</a>
                  : <em>({cr.status})</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {reports.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>Signalements utilisateurs</h3>
          <ul style={{ fontSize: 12.5, lineHeight: 1.5, paddingLeft: 18, color: 'var(--muted)' }}>
            {reports.map((r) => (
              <li key={`r-${r.id}`}>
                <strong>R-{r.id}</strong> [{r.kind}] {String(r.message || '').slice(0, 90)} — {r.username || '?'}{' '}
                {r.issue_url
                  ? <a href={r.issue_url} target="_blank" rel="noreferrer">issue #{r.issue_number}</a>
                  : <em>({r.status})</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {crashes.length === 0 && reports.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }}>Aucun rapport pour l’instant.</p>
      )}
    </div>
  );
}
