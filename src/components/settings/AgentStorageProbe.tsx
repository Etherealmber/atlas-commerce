import { useState } from 'react';
import { api } from '../../api';

export default function AgentStorageProbe() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const run = async () => {
    setBusy(true); setResult('');
    try {
      const { data } = await api.probeAgentStorage();
      if (data?.key_self_test === 'pass' && data.read_rpc === 'pass') setResult('Clé : autotest réussi. Lecture RPC : réussie. Cela ne vérifie pas les écritures, les images ou une clé antérieure.');
      else if (data?.key_self_test === 'fail') setResult('Autotest de la clé impossible. Vérifiez la configuration serveur sans remplacer une clé existante.');
      else setResult('Clé : autotest réussi. Lecture RPC indisponible ; vérifiez le projet Supabase et les accès serveur.');
    } catch { setResult('Diagnostic indisponible. Vérifiez la connexion et vos droits.'); }
    finally { setBusy(false); }
  };
  return <section><h2>Diagnostic du stockage Agent</h2><p>Teste la clé et une lecture Supabase sans écrire de conversation ni activer le stockage.</p><button type="button" disabled={busy} onClick={() => void run()}>{busy ? 'Vérification…' : 'Vérifier la connexion Agent'}</button>{result && <p role="status">{result}</p>}</section>;
}
