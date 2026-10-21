/**
 * Atlas Agent permissions — auto-saving segmented modes + custom tool toggles.
 * Embeddable in the agent drawer (compact) or Settings (full).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { friendlyError } from '../lib/errors';

type Mode = 'full' | 'read_only' | 'custom';

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: 'full', label: 'Accès complet', desc: 'Tous les outils autorisés par le rôle' },
  { id: 'read_only', label: 'Lecture seule', desc: 'Pas de proposition d’ajustement stock' },
  { id: 'custom', label: 'Personnalisé', desc: 'Choisir les outils un par un' },
];

type Props = {
  /** Compact layout for Atlas Agent drawer popover */
  compact?: boolean;
  /** Called after a successful save */
  onSaved?: () => void;
};

export default function AgentPermissionsPanel({ compact = false, onSaved }: Props) {
  const [mode, setMode] = useState<Mode>('full');
  const [tools, setTools] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState('');
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

  useEffect(() => {
    void load();
  }, [load]);

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
    [load, onSaved]
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

  if (loading) {
    return (
      <div className={`agent-perm-panel${compact ? ' is-compact' : ''}`}>
        <p className="agent-perm-status muted">Chargement…</p>
      </div>
    );
  }

  return (
    <div className={`agent-perm-panel${compact ? ' is-compact' : ''}`}>
      {!compact && (
        <p className="agent-perm-lead">
          Contrôle ce que l’assistant peut appeler (en plus des règles de rôle). Les conversations
          peuvent être enregistrées — voir la politique de confidentialité.
        </p>
      )}
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

      <div className="agent-perm-modes" role="radiogroup" aria-label="Mode de permissions">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={`agent-perm-mode${mode === m.id ? ' active' : ''}`}
            onClick={() => selectMode(m.id)}
          >
            <strong>{m.label}</strong>
            <span>{m.desc}</span>
          </button>
        ))}
      </div>

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

      {!compact && (
        <p className={`agent-perm-status agent-perm-status-${status}`} aria-live="polite">
          {status === 'saving' && 'Enregistrement…'}
          {status === 'saved' && '✓ Enregistré'}
          {status === 'error' && (err || 'Erreur')}
          {status === 'idle' && 'Les changements sont enregistrés automatiquement.'}
        </p>
      )}
      {compact && err && <p className="agent-perm-status agent-perm-status-error">{err}</p>}
    </div>
  );
}
