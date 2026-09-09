/** Admin: API keys + webhooks (Settings → API) */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useUi } from './AppDialogs';
import { friendlyError } from '../lib/errors';

export default function IntegrationsPanel() {
  const { toast, confirm } = useUi();
  const [keys, setKeys] = useState<any[]>([]);
  const [hooks, setHooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState('Clé API');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState('invoice.created,payment.created,stock.adjusted');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [k, h] = await Promise.all([api.listApiKeys(), api.listWebhooks()]);
      setKeys((k as any).data || []);
      setHooks((h as any).data || []);
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createKey = async () => {
    setBusy(true);
    setMsg('');
    setRevealedKey(null);
    try {
      const r: any = await api.createApiKey({ name: newKeyName.trim() || 'Clé API' });
      setRevealedKey(r.data?.key || null);
      setMsg(r.message || 'Clé créée — copiez-la maintenant.');
      await load();
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (id: number) => {
    if (!(await confirm({ title: 'Révoquer la clé', message: 'Cette clé API ne pourra plus être utilisée.', confirmLabel: 'Révoquer', danger: true }))) return;
    setBusy(true);
    try {
      await api.deleteApiKey(id);
      setMsg('Clé révoquée.');
      await load();
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const createHook = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r: any = await api.createWebhook({
        url: hookUrl.trim(),
        events: hookEvents.trim(),
      });
      setMsg(r.message || 'Webhook enregistré.');
      setHookUrl('');
      await load();
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const removeHook = async (id: number) => {
    if (!(await confirm({ title: 'Supprimer le webhook', message: 'Les notifications vers cette URL s’arrêteront.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(true);
    try {
      await api.deleteWebhook(id);
      setMsg('Webhook supprimé.');
      await load();
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="muted">Chargement des intégrations…</p>;

  return (
    <div>
      {err && (
        <p style={{ color: 'var(--bad, #b91c1c)', fontSize: 13 }}>{err}</p>
      )}
      {msg && (
        <p style={{ color: 'var(--ok, #0f766e)', fontSize: 13 }}>{msg}</p>
      )}

      {revealedKey && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'var(--paper-2, #f7f4ee)',
          }}
        >
          <strong style={{ fontSize: 13 }}>Clé (une seule fois)</strong>
          <code
            style={{
              display: 'block',
              marginTop: 8,
              fontSize: 12,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {revealedKey}
          </code>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 8, fontSize: 12 }}
            onClick={() => {
              void navigator.clipboard?.writeText(revealedKey);
              setMsg('Clé copiée.');
            }}
          >
            Copier
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <input
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Nom de la clé"
          style={{ minWidth: 160 }}
        />
        <button type="button" disabled={busy} onClick={() => void createKey()}>
          Créer une clé
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
          Actualiser
        </button>
      </div>

      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Préfixe</th>
              <th>Scopes</th>
              <th>Créée</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.key_prefix}…</code>
                </td>
                <td style={{ fontSize: 12 }}>{k.scopes}</td>
                <td style={{ fontSize: 12 }}>{String(k.created_at || '').slice(0, 16)}</td>
                <td>
                  <button
                    type="button"
                    className="danger"
                    style={{ fontSize: 12 }}
                    disabled={busy}
                    onClick={() => void revokeKey(k.id)}
                  >
                    Révoquer
                  </button>
                </td>
              </tr>
            ))}
            {!keys.length && (
              <tr>
                <td colSpan={5} className="empty">
                  Aucune clé API.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 15, marginTop: 8 }}>Webhooks</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        URL HTTPS appelée sur certains événements (facture, paiement, stock).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          value={hookUrl}
          onChange={(e) => setHookUrl(e.target.value)}
          placeholder="https://…"
          style={{ flex: 1, minWidth: 200 }}
        />
        <input
          value={hookEvents}
          onChange={(e) => setHookEvents(e.target.value)}
          placeholder="events"
          style={{ minWidth: 180 }}
        />
        <button type="button" disabled={busy || !hookUrl.trim()} onClick={() => void createHook()}>
          Ajouter
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h.id}>
                <td style={{ fontSize: 12, wordBreak: 'break-all' }}>{h.url}</td>
                <td style={{ fontSize: 12 }}>{h.events}</td>
                <td>
                  <button
                    type="button"
                    className="danger"
                    style={{ fontSize: 12 }}
                    disabled={busy}
                    onClick={() => void removeHook(h.id)}
                  >
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
            {!hooks.length && (
              <tr>
                <td colSpan={3} className="empty">
                  Aucun webhook.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
