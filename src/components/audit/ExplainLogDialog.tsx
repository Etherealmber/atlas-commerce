import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { api } from '../../api';

type Result = { summary: string; risk: 'normal' | 'à surveiller' | 'suspect'; advice: string; source: string; model?: string };

/** Small « Expliquer » trigger. */
export function ExplainButton({ onClick, label = 'Expliquer' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="ac-explain-btn"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Expliquer cette ligne (IA)"
    >
      <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Explanation sheet. Groq answers in about 1 s; the answer is cached
 * server-side for 30 days, so reopening it is instant and free.
 */
export default function ExplainLogDialog({ target, onClose }: { target: { kind: 'audit' | 'api'; id: number; title?: string } | null; onClose: () => void }) {
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setRes(null);
    setErr('');
    api.explainLogLine(target.kind, target.id)
      .then((r) => { if (alive) setRes(r.data); })
      .catch((e: unknown) => { if (alive) setErr((e as Error)?.message || 'Explication indisponible.'); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
  }, [target, onClose]);
  if (!target) return null;
  const tone = res?.risk === 'suspect' ? 'danger' : res?.risk === 'à surveiller' ? 'warn' : 'ok';
  return createPortal(
    <div className="audit-detail-modal-backdrop ac-explain-backdrop" role="presentation" onClick={onClose}>
      <div className="audit-detail-modal card ac-explain-modal" role="dialog" aria-modal="true" aria-labelledby="ac-explain-title" onClick={(e) => e.stopPropagation()}>
        <div className="ac-explain-head">
          <span className="ac-explain-ico" aria-hidden="true"><Sparkles size={16} strokeWidth={2.2} /></span>
          <div>
            <h3 id="ac-explain-title">Explication</h3>
            {target.title ? <p className="ac-explain-sub">{target.title}</p> : null}
          </div>
          <button type="button" className="ac-explain-close" aria-label="Fermer" onClick={onClose}><X size={16} /></button>
        </div>
        {!res && !err ? (
          <div className="ac-explain-loading" aria-live="polite">
            <span className="ac-explain-dot" /><span className="ac-explain-dot" /><span className="ac-explain-dot" />
            <span>Analyse en cours…</span>
          </div>
        ) : err ? (
          <p className="ac-explain-error" role="alert">{err}</p>
        ) : res ? (
          <div className="ac-explain-body" aria-live="polite">
            <span className={`ac-explain-risk ac-explain-risk--${tone}`}>
              {res.risk === 'normal' ? 'Normal' : res.risk === 'suspect' ? 'Suspect' : 'À surveiller'}
            </span>
            <p className="ac-explain-summary">{res.summary}</p>
            <p className="ac-explain-advice"><b>Conseil :</b> {res.advice}</p>
            <p className="ac-explain-src">
              {res.source === 'rules' ? 'Explication automatique (IA indisponible ou quota du jour atteint).' : `Généré par IA${res.model ? ` (${res.model})` : ''}${res.source === 'cache' ? ' · déjà analysé' : ''} — à vérifier.`}
            </p>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
