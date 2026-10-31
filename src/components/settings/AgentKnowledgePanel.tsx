import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

type Knowledge = {
  isAdmin: boolean;
  memory: { id: number; username: string; scope: string; content: string; created_at: string }[];
  context: string;
  guardrails: { id: number; rule: string; active: number; created_at: string }[];
  docs: { id: number; name: string; chars: number; created_at: string }[];
  tools: { name: string; description: string; enabled: boolean; allowedForRole: boolean }[];
};

const cardTitle: React.CSSProperties = { fontSize: 15, marginTop: 0, marginBottom: 8 };
const hint: React.CSSProperties = { fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px' };
const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 10px',
  border: '1px solid var(--line)',
  borderRadius: 10,
  marginBottom: 6,
  fontSize: 13,
};
const input: React.CSSProperties = { flex: '1 1 auto', minWidth: 0 };

/**
 * v0.7.7 — Paramètres → Intégrations : pilote MÉMOIRE, CONTEXTE, GARDE-FOUS,
 * OUTILS et BASE DE CONNAISSANCES (RAG) de l'Atlas Agent. Tout est persisté
 * côté serveur (D1) et injecté dans chaque conversation de l'Agent.
 */
export default function AgentKnowledgePanel() {
  const [k, setK] = useState<Knowledge | null>(null);
  const [err, setErr] = useState('');
  const [mem, setMem] = useState('');
  const [ctx, setCtx] = useState<string | null>(null);
  const [rule, setRule] = useState('');
  const [docName, setDocName] = useState('');
  const [docBody, setDocBody] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await api.getAgentKnowledge();
      setK((r as any)?.data || null);
      setCtx((prev) => prev ?? (r as any)?.data?.context ?? '');
    } catch {
      setErr('Impossible de charger le savoir de l’Agent.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      await reload();
      if (okMsg) setErr('');
    } catch (e: any) {
      setErr(String(e?.message || 'Action refusée.'));
    } finally {
      setBusy(false);
    }
  };

  if (!k) {
    return (
      <div className="card" style={{ marginBottom: 16, padding: 16 }} data-settings-anchor="agent-knowledge">
        <h2 style={cardTitle}>Mémoire & savoir de l’Agent</h2>
        <p style={hint}>{err || 'Chargement…'}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16, padding: 16 }} data-settings-anchor="agent-knowledge">
      <h2 style={cardTitle}>Mémoire & savoir de l’Atlas Agent</h2>
      <p style={hint}>
        Mémoire, contexte métier, garde-fous, outils et base de connaissances (RAG) : tout ce que l’Agent
        utilise à chaque conversation, éditable ici. La mémoire personnelle est privée à votre compte.
      </p>
      {err && (
        <p style={{ fontSize: 12, color: '#b91c1c', marginBottom: 10 }} role="alert">
          {err}
        </p>
      )}

      {/* ── Mémoire ── */}
      <h3 style={{ fontSize: 13, margin: '14px 0 8px' }}>Mémoire</h3>
      {k.memory.length === 0 && <p style={hint}>Aucun souvenir enregistré pour l’instant.</p>}
      {k.memory.map((m) => (
        <div key={m.id} style={row}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              textTransform: 'uppercase',
              padding: '2px 7px',
              borderRadius: 999,
              border: '1px solid var(--line)',
              flex: '0 0 auto',
            }}
          >
            {m.scope === 'org' ? 'Org' : 'Moi'}
          </span>
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>{m.content}</span>
          {(k.isAdmin || m.scope === 'user') && (
            <button
              type="button"
              className="secondary"
              style={{ flex: '0 0 auto', padding: '3px 9px', fontSize: 12 }}
              disabled={busy}
              aria-label={`Supprimer le souvenir ${m.content}`}
              onClick={() => void run(() => api.deleteAgentMemory(m.id))}
            >
              Retirer
            </button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          style={input}
          value={mem}
          maxLength={500}
          placeholder="Ex. : le client préfère les factures par WhatsApp…"
          onChange={(e) => setMem(e.target.value)}
          aria-label="Nouveau souvenir"
        />
        <button
          type="button"
          className="secondary"
          disabled={busy || !mem.trim()}
          onClick={() => {
            const v = mem.trim();
            setMem('');
            void run(() => api.addAgentMemory(v, 'user'));
          }}
        >
          Mémoriser
        </button>
      </div>

      {/* ── Contexte (org) ── */}
      {k.isAdmin && (
        <>
          <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Contexte métier</h3>
          <p style={hint}>Injecté à chaque conversation (ton, horaires, règles commerciales…).</p>
          <textarea
            style={{ width: '100%', minHeight: 84, fontSize: 13 }}
            value={ctx ?? k.context}
            maxLength={4000}
            onChange={(e) => setCtx(e.target.value)}
            aria-label="Contexte métier"
          />
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => void run(() => api.setAgentContext(ctx ?? ''), 'ok')}
          >
            Enregistrer le contexte
          </button>
        </>
      )}

      {/* ── Garde-fous (org) ── */}
      {k.isAdmin && (
        <>
          <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Garde-fous</h3>
          <p style={hint}>Règles absolues imposées à l’Agent (prioritaires sur tout le reste).</p>
          {k.guardrails.map((g) => (
            <div key={g.id} style={row}>
              <input
                type="checkbox"
                checked={g.active === 1}
                aria-label={`Activer la règle ${g.rule}`}
                onChange={(e) => void run(() => api.setAgentGuardrailActive(g.id, e.target.checked))}
              />
              <span style={{ flex: '1 1 auto', minWidth: 0, opacity: g.active === 1 ? 1 : 0.55 }}>{g.rule}</span>
              <button
                type="button"
                className="secondary"
                style={{ flex: '0 0 auto', padding: '3px 9px', fontSize: 12 }}
                disabled={busy}
                aria-label={`Supprimer la règle ${g.rule}`}
                onClick={() => void run(() => api.deleteAgentGuardrail(g.id))}
              >
                Supprimer
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              style={input}
              value={rule}
              maxLength={300}
              placeholder="Ex. : ne jamais modifier un prix sans confirmation écrite"
              onChange={(e) => setRule(e.target.value)}
              aria-label="Nouvelle règle"
            />
            <button
              type="button"
              className="secondary"
              disabled={busy || !rule.trim()}
              onClick={() => {
                const v = rule.trim();
                setRule('');
                void run(() => api.addAgentGuardrail(v));
              }}
            >
              Ajouter
            </button>
          </div>
        </>
      )}

      {/* ── Outils (org) ── */}
      {k.isAdmin && (
        <>
          <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Outils de l’Agent</h3>
          <p style={hint}>Activez ou coupez chaque outil disponible pour vos rôles.</p>
          <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
            {k.tools.map((t) => (
              <div key={t.name} style={row}>
                <input
                  type="checkbox"
                  checked={t.enabled}
                  disabled={!t.allowedForRole || busy}
                  aria-label={`Activer l'outil ${t.name}`}
                  onChange={(e) => void run(() => api.setAgentToolPref(t.name, e.target.checked))}
                />
                <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <strong style={{ fontSize: 12.5 }}>{t.name}</strong>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
                    {t.description || (t.allowedForRole ? '' : 'non autorisé pour votre rôle')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Base de connaissances RAG (org) ── */}
      {k.isAdmin && (
        <>
          <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Base de connaissances (RAG)</h3>
          <p style={hint}>
            Documents texte interrogés par recherche à chaque question (procédures, tarifs, catalogue…).
          </p>
          {k.docs.map((d) => (
            <div key={d.id} style={row}>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <strong style={{ fontSize: 12.5 }}>{d.name}</strong>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
                  {d.chars.toLocaleString('fr-FR')} caractères
                </span>
              </span>
              <button
                type="button"
                className="secondary"
                style={{ flex: '0 0 auto', padding: '3px 9px', fontSize: 12 }}
                disabled={busy}
                aria-label={`Supprimer le document ${d.name}`}
                onClick={() => void run(() => api.deleteAgentDoc(d.id))}
              >
                Supprimer
              </button>
            </div>
          ))}
          <input
            style={{ ...input, marginBottom: 6 }}
            value={docName}
            maxLength={120}
            placeholder="Nom du document (ex. : Procédure retour marchandises)"
            onChange={(e) => setDocName(e.target.value)}
            aria-label="Nom du document"
          />
          <textarea
            style={{ width: '100%', minHeight: 90, fontSize: 13 }}
            value={docBody}
            maxLength={20000}
            placeholder="Collez ici le contenu texte du document…"
            onChange={(e) => setDocBody(e.target.value)}
            aria-label="Contenu du document"
          />
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 8 }}
            disabled={busy || !docBody.trim()}
            onClick={() => {
              const n = docName.trim() || 'Document';
              const b = docBody.trim();
              setDocName('');
              setDocBody('');
              void run(() => api.addAgentDoc(n, b));
            }}
          >
            Indexer le document
          </button>
        </>
      )}
    </div>
  );
}
