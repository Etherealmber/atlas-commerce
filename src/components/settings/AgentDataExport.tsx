import { useRef, useState } from 'react';
import Select from '../ui/Select';
import { api, getBase } from '../../api';
import { getToken, getUsername } from '../../auth';
import { downloadAgentConversation, type ExportMessage } from '../../lib/agentConversationExport';

type Thread = { id: string; title: string };

/** Explicitly limited to a text copy of one saved server snapshot. */
export default function AgentDataExport() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [selected, setSelected] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const account = useRef<{ username: string; token: string | null; base: string } | null>(null);
  const identity = () => ({ username: getUsername(), token: getToken(), base: getBase() });
  const sameAccount = () => {
    const current = identity(); const initial = account.current;
    return !!initial && current.username === initial.username && current.token === initial.token && current.base === initial.base;
  };
  const load = async () => {
    setBusy(true); setNotice(''); setThreads(null); setSelected(''); account.current = identity();
    try {
      const result = await api.listAgentThreads();
      if (!sameAccount()) throw new Error('La session a changé. Rechargez la liste.');
      if (!Array.isArray(result?.data)) throw new Error('Réponse de l’historique invalide.');
      const rows = result.data.filter(t => t && typeof t.id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(t.id)).slice(0, 20).map(t => ({ id: t.id, title: typeof t.title === 'string' && t.title.trim() ? t.title.slice(0, 100) : 'Conversation' }));
      setThreads(rows); setSelected(rows[0]?.id || '');
      if (result.meta?.unreadable_count || result.meta?.pending_count) setNotice('Certains titres sont indisponibles ou encore en cours de chargement.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Historique indisponible.'); }
    finally { setBusy(false); }
  };
  const download = async () => {
    if (!selected || !threads?.some(t => t.id === selected)) return;
    if (!sameAccount()) { setThreads(null); setSelected(''); setNotice('La session a changé. Rechargez la liste.'); return; }
    setBusy(true); setNotice('');
    try {
      const result = await api.getAgentThread(selected);
      if (!sameAccount()) throw new Error('La session a changé. Rechargez la liste.');
      if (result?.meta?.empty || !Array.isArray(result?.data?.messages)) throw new Error('Conversation indisponible ou supprimée.');
      const messages: ExportMessage[] = result.data.messages.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
      downloadAgentConversation(messages);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Téléchargement impossible.'); }
    finally { setBusy(false); }
  };
  return <div className="agent-data-export">
    <h2>Mes données Agent</h2>
    <p>Choisissez une conversation récente enregistrée sur le serveur pour télécharger son texte. Les pièces jointes, le contexte interne, les modifications locales non synchronisées et les autres données du compte ne sont pas inclus.</p>
    <p>La liste est limitée à 20 conversations récentes : ce n’est pas une exportation complète du compte.</p>
    <button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Chargement…' : 'Charger les conversations récentes'}</button>
    {threads && (threads.length ? <div><label htmlFor="agent-export-thread">Conversation</label> <Select id="agent-export-thread" value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>{threads.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</Select> <button type="button" disabled={busy || !selected} onClick={() => void download()}>Télécharger le texte</button></div> : <p>Aucune conversation récente enregistrée.</p>)}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
