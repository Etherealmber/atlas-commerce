/**
 * Atlas Agent permissions — auto-saving segmented selector + custom tool toggles.
 * v0.7.7 : dans Settings, rendu « trigger » = carte résumé + popup façon
 * « Appareils connectés » (modal-overlay / modal / ac-modal-foot). Les modes ne
 * sont plus trois gros cartons sombres mais un sélecteur segmenté lisible
 * (clair & sombre), et la liste des outils de l'organisation vit dans la popup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { friendlyError } from '../lib/errors';

type Mode = 'full' | 'read_only' | 'custom';

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: 'full', label: 'Accès complet', desc: 'Tous les outils autorisés par le rôle' },
  { id: 'read_only', label: 'Lecture seule', desc: 'Pas de proposition d’ajustement stock' },
  { id: 'custom', label: 'Personnalisé', desc: 'Choisir les outils un par un' },
];

type OrgTool = { name: string; description: string; enabled: boolean; allowedForRole: boolean };

type Props = {
  /** Compact layout for Atlas Agent drawer popover */
  compact?: boolean;
  /** Called after a successful save */
  onSaved?: () => void;
  /** Settings : carte résumé + popup « Appareils connectés »-style */
  asTrigger?: boolean;
};

export default function AgentPermissionsPanel({ compact = false, onSaved, asTrigger = false }: Props) {
  const [mode, setMode] = useState<Mode>('full');
  const [tools, setTools] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [orgAdmin, setOrgAdmin] = useState(false);
  const [orgTools, setOrgTools] = useState<OrgTool[]>([]);
  const [orgBusy, setOrgBusy] = useState(false);
  const saveGen = useRef(0);
  const toolsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.getAgentPermissions();
      setMode((r.data?.mode as Mode) || 'full');
      setTools(r.data?.tools || []);
      setAvailable(r.data?.available || []);
      setGroups(r.data?.groups || {});
    } catch (e: any) {
      setErr(friendlyError(e) || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrg = useCallback(async () => {
    try {
      const r = await api.getAgentKnowledge();
      setOrgAdmin(!!r.data?.isAdmin);
      setOrgTools(r.data?.tools || []);
    } catch { /* la section perso reste utilisable sans la partie org */ }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) void loadOrg();
  }, [open, loadOrg]);

  const persist = useCallback(
    async (nextMode: Mode, nextTools: string[]) => {
      const gen = ++saveGen.current;
      setStatus('saving');
      setErr('');
      try {
        await api.updateAgentPermissions({
          mode: nextMode,
          tools: nextMode === 'custom' ? nextTools : undefined,
        });
        if (gen !== saveGen.current) return;
        setStatus('saved');
        onSaved?.();
        window.setTimeout(() => {
          if (gen === saveGen.current) setStatus('idle');
        }, 1800);
      } catch (e: any) {
        if (gen !== saveGen.current) return;
        setStatus('error');
        setErr(friendlyError(e) || 'Échec de l’enregistrement');
        // Reload server state on failure
        void load();
      }
    },
    [load, onSaved],
  );

  const selectMode = (id: Mode) => {
    if (id === mode && status !== 'error') return;
    setMode(id);
    void persist(id, tools);
  };

  const toggleTool = (name: string) => {
    setTools((prev) => {
      const next = prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name];
      if (toolsTimer.current) clearTimeout(toolsTimer.current);
      toolsTimer.current = setTimeout(() => {
        void persist('custom', next);
      }, 280);
      return next;
    });
    if (mode !== 'custom') setMode('custom');
  };

  const selectGroup = (key: string) => {
    const g = groups[key] || [];
    setTools((prev) => {
      const next = Array.from(new Set([...prev, ...g]));
      if (toolsTimer.current) clearTimeout(toolsTimer.current);
      toolsTimer.current = setTimeout(() => {
        void persist('custom', next);
      }, 200);
      return next;
    });
    if (mode !== 'custom') setMode('custom');
  };

  const toggleOrgTool = async (name: string, enabled: boolean) => {
    setOrgBusy(true);
    try {
      await api.setAgentToolPref(name, enabled);
      setOrgTools((prev) => prev.map((t) => (t.name === name ? { ...t, enabled } : t)));
    } catch (e: any) {
      setStatus('error');
      setErr(friendlyError(e) || 'Échec de l’enregistrement');
    } finally {
      setOrgBusy(false);
    }
  };

  const descOf = (name: string) => orgTools.find((t) => t.name === name)?.description || '';
  const modeLabel = MODES.find((m) => m.id === mode)?.label || mode;

  const statusLine = (
    <p className={`agent-perm-status agent-perm-status-${status}`} aria-live="polite">
      {status === 'saving' && 'Enregistrement…'}
      {status === 'saved' && '✓ Enregistré'}
      {status === 'error' && (err || 'Erreur')}
      {status === 'idle' && 'Les changements sont enregistrés automatiquement.'}
    </p>
  );

  const body = (withLead: boolean) => (
    <>
      {withLead && (
        <p className="agent-perm-lead">
          Contrôle ce que l’assistant peut appeler (en plus des règles de rôle). Les
          conversations peuvent être enregistrées — voir la politique de confidentialité.
        </p>
      )}

      {/* v0.7.7 — sélecteur segmenté lisible (remplace les 3 gros cartons sombres) */}
      <div className="agent-perm-seg" role="radiogroup" aria-label="Mode de permissions">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={`agent-perm-seg-opt${mode === m.id ? ' active' : ''}`}
            onClick={() => selectMode(m.id)}
          >
            <span className="agent-perm-seg-dot" aria-hidden />
            {m.label}
          </button>
        ))}
      </div>
      <p className="agent-perm-seg-desc">{MODES.find((m) => m.id === mode)?.desc}</p>

      {mode === 'custom' && (
        <div className="agent-perm-custom">
          {Object.keys(groups).length > 0 && (
            <div className="agent-perm-group-btns">
              {Object.keys(groups).map((k) => (
                <button key={k} type="button" className="secondary agent-perm-group-btn" onClick={() => selectGroup(k)}>
                  + {k}
                </button>
              ))}
            </div>
          )}
          <div className="agent-perm-tools">
            {available.map((name) => {
              const on = tools.includes(name);
              const d = descOf(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={`agent-perm-tool-switch${on ? ' on' : ''}`}
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleTool(name)}
                >
                  <span className="agent-perm-tool-label">
                    <code>{name}</code>
                    {d ? <span className="agent-perm-tool-desc">{d}</span> : null}
                  </span>
                  <span className="agent-perm-knob" aria-hidden />
                </button>
              );
            })}
            {available.length === 0 && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Aucun outil listé pour ce compte.
              </p>
            )}
          </div>
        </div>
      )}

      {!compact && orgAdmin && (
        <div className="agent-perm-org">
          <h3 className="agent-perm-org-title">Outils de l’organisation</h3>
          <p className="agent-perm-seg-desc">
            Activez ou coupez chaque outil disponible pour vos rôles (tous les utilisateurs).
          </p>
          <div className="agent-perm-org-list">
            {orgTools.map((t) => (
              <label key={t.name} className={`agent-perm-org-row${t.allowedForRole ? '' : ' is-locked'}`}>
                <input
                  type="checkbox"
                  checked={t.enabled}
                  disabled={!t.allowedForRole || orgBusy}
                  aria-label={`Activer l’outil ${t.name}`}
                  onChange={(e) => void toggleOrgTool(t.name, e.target.checked)}
                />
                <span>
                  <strong>{t.name}</strong>
                  <span>{t.description || (t.allowedForRole ? '' : 'non autorisé pour votre rôle')}</span>
                </span>
              </label>
            ))}
            {orgTools.length === 0 && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>Aucun outil côté organisation.</p>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (loading) {
    return (
      <div className={`agent-perm-panel${compact ? ' is-compact' : ''}`}>
        <p className="agent-perm-status muted">Chargement…</p>
      </div>
    );
  }

  /* ── Settings : carte résumé + popup façon « Appareils connectés » ── */
  if (asTrigger) {
    return (
      <>
        <div className="agent-perm-summary">
          <div className="agent-perm-summary-txt">
            <strong>Permissions Atlas Agent</strong>
            <span>
              Mode : {modeLabel}
              {mode === 'custom' ? ` · ${tools.length} outil(s) choisi(s)` : ''}
            </span>
          </div>
          <button type="button" className="secondary" onClick={() => setOpen(true)}>
            Gérer les permissions
          </button>
        </div>
        {open &&
          createPortal(
            <div className="modal-overlay" onClick={() => setOpen(false)}>
              <div className="modal agent-perm-modal" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-x modal-close" aria-label="Fermer" onClick={() => setOpen(false)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
                <h2>Permissions Atlas Agent</h2>
                <p className="muted" style={{ marginTop: 0 }}>
                  Outils et actions que l’agent peut exécuter en votre nom.
                </p>
                <div className="agent-perm-modal-body">
                  {body(true)}
                  {statusLine}
                </div>
                <div className="ac-modal-foot">
                  <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Fermer</button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  /* ── inline (drawer compact) ── */
  return (
    <div className={`agent-perm-panel${compact ? ' is-compact' : ''}`}>
      {compact && (
        <div className="agent-perm-compact-head">
          <strong>Permissions</strong>
          <span className={`agent-perm-badge agent-perm-badge-${status}`} aria-live="polite">
            {status === 'saving' && 'Enregistrement…'}
            {status === 'saved' && '✓ Enregistré'}
            {status === 'error' && 'Erreur'}
            {status === 'idle' && 'Auto-save'}
          </span>
        </div>
      )}
      {body(!compact)}
      {!compact && statusLine}
      {compact && err && <p className="agent-perm-status agent-perm-status-error">{err}</p>}
    </div>
  );
}
