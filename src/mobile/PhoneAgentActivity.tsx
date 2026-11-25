import { useEffect, useRef, useState } from 'react';
import { api, type WorkStatusSource } from '../api';
import PhoneDialog from './PhoneDialog';
import { AtlasLoader } from '../components/brand/AtlasLoader';

type Snapshot = { inApp: WorkStatusSource; reports: WorkStatusSource };
type SourceKey = 'inApp' | 'reports';

/** Read-only, account-scoped activity from the same endpoint used by the native app. */
export default function PhoneAgentActivity({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const load = async (key?: SourceKey, cursor?: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setError('');
    try {
      const data = await api.mobileWorkStatus(key && cursor ? { source: key === 'inApp' ? 'in_app' : 'github', value: cursor } : undefined);
      if (!mounted.current) return;
      if (!data.in_app || !data.trackers?.github || !Array.isArray(data.in_app.items) || !Array.isArray(data.trackers.github.items)) throw new Error('Réponse incomplète');
      if (key && (key === 'inApp' ? data.in_app : data.trackers.github).availability !== 'available') throw new Error('Source indisponible');
      const next = { inApp: data.in_app, reports: data.trackers.github };
      setSnapshot(previous => {
        if (!key || !previous) return next;
        const incoming = next[key];
        const seen = new Set(previous[key].items.map(item => item.id));
        return { ...previous, [key]: { ...incoming, items: [...previous[key].items, ...incoming.items.filter(item => !seen.has(item.id))] } };
      });
    } catch { if (mounted.current) setError('Impossible de charger votre activité. Réessayez.'); }
    finally { inFlight.current = false; if (mounted.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);

  const section = (key: SourceKey, title: string) => {
    const source = snapshot?.[key];
    if (!source) return null;
    return <section className="ph-agent-activity-section"><h3>{title}</h3>
      {source.availability !== 'available' ? <p>Source indisponible pour le moment.</p> : source.items.length === 0 ? <p>Aucun élément disponible.</p> : <ul>{source.items.map(item => <li key={item.id}><strong>{item.title || `#${item.id}`}</strong><span>{item.status}</span></li>)}</ul>}
      {source.availability === 'available' && source.next_cursor && <button type="button" disabled={loading} onClick={() => void load(key, source.next_cursor!)}>Afficher plus</button>}
    </section>;
  };
  return <PhoneDialog titleId="ph-agent-activity-title" onClose={onClose}>
    <h2 id="ph-agent-activity-title">Mon activité</h2>
    <p>Statuts personnels fournis par le serveur, en lecture seule.</p>
    {loading && <p role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AtlasLoader size={16} label="" /> Chargement…</p>}{error && <p role="alert">{error}</p>}
    <div className="ph-agent-activity-scroll">{section('inApp', 'Demandes de stock')}{section('reports', 'Signalements')}</div>
    <div className="ph-native-dialog-actions"><button type="button" disabled={loading} onClick={() => void load()}>Actualiser</button><button type="button" onClick={onClose}>Fermer</button></div>
  </PhoneDialog>;
}
