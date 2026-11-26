import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../../api';
import { useLang } from '../../i18n/core';

type Result = Awaited<ReturnType<typeof api.explainLogLine>>['data'];

/** Only requests an explanation after an explicit click; never sends raw row data from the browser. */
export function AuditAgentExplanation({ id, kind = 'audit' }: { id: number; kind?: 'audit' | 'api' }) {
  const lang = useLang();
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const generation = useRef(0);
  useEffect(() => {
    setResult(null); setStatus('idle');
    return () => { generation.current += 1; };
  }, [id, kind, lang]);
  async function explain() {
    const current = ++generation.current;
    setStatus('loading');
    try {
      const response = await api.explainLogLine(kind, id, lang);
      if (current === generation.current) { setResult(response.data); setStatus('idle'); }
    } catch { if (current === generation.current) setStatus('error'); }
  }
  return <section className="audit-agent-explanation" aria-labelledby="audit-agent-title">
    <div className="audit-agent-heading"><Sparkles size={18} aria-hidden="true" /><h4 id="audit-agent-title">Explication avec Atlas Agent</h4></div>
    <p>Sur demande, des catégories d’événement et indicateurs agrégés peuvent être envoyés au fournisseur IA. Aucun nom, adresse IP ou détail brut n’est envoyé.</p>
    <button type="button" className="secondary" onClick={() => void explain()} disabled={status === 'loading'}>
      {status === 'loading' ? 'Analyse en cours…' : result ? 'Analyser à nouveau' : 'Expliquer avec Atlas Agent'}
    </button>
    {status === 'error' && <p role="alert">Explication indisponible. Réessayez.</p>}
    {result && <div className="audit-agent-result" aria-live="polite">
      <strong>{result.risk === 'suspect' ? 'Suspect' : result.risk === 'à surveiller' ? 'À surveiller' : 'Normal'}</strong>
      <p className="audit-agent-summary" dir="auto">{result.summary}</p><p className="audit-agent-advice" dir="auto">{result.advice}</p>
      <small>{result.source === 'rules' ? 'Explication automatique sans IA.' : 'Explication générée par IA.'} Vérifiez les faits avant toute action.</small>
    </div>}
  </section>;
}
