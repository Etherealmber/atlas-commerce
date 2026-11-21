import { useEffect, useRef, useState } from 'react';
import { getToken } from '../auth';
import { getCachedFingerprint } from '../fingerprint';
import { parsePhoneApproval, phoneApprovalPost, validPhoneConsent, type PhoneConsent } from '../lib/desktopPhoneApproval';
import '../styles/login-auth.css';

/** New, isolated mobile-web consent page; no change to existing QR flows. */
export default function LoginDesktopPhone() {
  const [context] = useState(() => parsePhoneApproval(window.location.hash, window.location.origin, window.location.search));
  const [consent, setConsent] = useState<PhoneConsent | null>(null);
  const [message, setMessage] = useState('Vérification de la demande…');
  const [compared, setCompared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const request = useRef<Promise<{ consent: PhoneConsent; token: string; fingerprint: string }> | null>(null);
  const actor = useRef<{ token: string; fingerprint: string } | null>(null);

  useEffect(() => {
    let stopped = false;
    // Remove all fragment/query input immediately. Reload requires scanning again.
    try { window.history.replaceState(null, '', '/login/desktop-phone'); }
    catch { setMessage('Impossible de sécuriser la demande. Recommencez sur le desktop.'); return; }
    if (!context) { setMessage('Demande invalide. Recommencez sur le desktop.'); return; }
    if (!request.current) request.current = (async () => {
      const token = getToken();
      if (!token) throw new Error('LOGIN_REQUIRED');
      const fingerprint = await getCachedFingerprint();
      const result = await phoneApprovalPost<PhoneConsent>('prepare', context, token, fingerprint);
      if (!validPhoneConsent(result, context) || getToken() !== token) throw new Error('INVALID');
      return { consent: result, token, fingerprint };
    })();
    request.current.then(result => {
      if (stopped) return;
      actor.current = { token: result.token, fingerprint: result.fingerprint };
      setConsent(result.consent);
      setMessage('Vérifiez la demande avant de décider.');
    }).catch(() => {
      if (!stopped) setMessage('Connexion ou demande indisponible. Connectez-vous sur ce téléphone puis scannez à nouveau.');
    });
    return () => { stopped = true; };
  }, [context]);

  useEffect(() => {
    if (!consent || done) return;
    const timer = window.setTimeout(() => { setConsent(null); actor.current = null; setMessage('Confirmation expirée. Recommencez sur le desktop.'); },
      Math.max(0, Math.min(Date.parse(consent.expires_at), Date.parse(consent.consent_expires_at)) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [consent, done]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!context || !consent || !actor.current || busy || done || (decision === 'approve' && !compared)) return;
    const current = actor.current;
    if (getToken() !== current.token) { setConsent(null); actor.current = null; setMessage('Le compte a changé. Scannez une nouvelle demande.'); return; }
    setBusy(true);
    try {
      const result = await phoneApprovalPost<{ status: string }>('decision', context, current.token, current.fingerprint,
        { consent_nonce: consent.consent_nonce, decision, compare_confirmed: decision === 'approve' && compared });
      if (result?.status !== (decision === 'approve' ? 'approved' : 'denied')) throw new Error('INVALID');
      setDone(true);
      setMessage(decision === 'approve' ? 'Desktop autorisé. Revenez sur l’ordinateur.' : 'Connexion refusée. Le desktop ne sera pas connecté.');
    } catch { setMessage('Impossible de confirmer. Recommencez sur le desktop.'); }
    finally { actor.current = null; setConsent(null); setBusy(false); }
  };

  return <main className="login-qr-page"><section className="login-qr-card" aria-labelledby="desktop-phone-title">
    <p className="login-qr-brand">Atlas Commerce</p><h1 id="desktop-phone-title">Autoriser le desktop</h1>
    <p role="status" className="login-qr-msg">{message}</p>
    {consent && !done ? <>
      <p>Compte : <strong><bdi>{consent.username}</bdi></strong></p>
      <p>Serveur : <strong style={{ overflowWrap: 'anywhere' }}>{consent.origin}</strong></p>
      <p>Appareil : <strong><bdi>{consent.device_label}</bdi></strong> (nom déclaré, non vérifié)</p>
      <p>Code à comparer : <strong>{consent.pairing_code}</strong></p>
      <p>Autorisez uniquement une demande que vous venez de lancer. N’acceptez jamais un code envoyé par une autre personne.</p>
      <label><input type="checkbox" checked={compared} disabled={busy} onChange={e => setCompared(e.target.checked)} /> Le même code apparaît sur mon desktop.</label>
      <div className="login-qr-actions">
        <button type="button" className="login-qr-btn login-qr-btn--ok" disabled={!compared || busy} onClick={() => void decide('approve')}>Autoriser ce desktop</button>
        <button type="button" className="login-qr-btn login-qr-btn--no" disabled={busy} onClick={() => void decide('deny')}>Refuser</button>
      </div>
    </> : null}
    <p className="login-qr-hint">La lecture du QR n’autorise rien. Aucun jeton n’est transmis au téléphone pour cette demande.</p>
  </section></main>;
}
