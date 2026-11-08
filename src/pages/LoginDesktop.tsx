import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearToken, getToken, isLoggedIn } from '../auth';
import { getCachedFingerprint } from '../fingerprint';
import {
  clearDesktopApproval, DesktopApprovalError, desktopBrowserPost, loadDesktopApproval,
  parseDesktopApproval, saveDesktopApproval, type DesktopConsent,
} from '../lib/desktopApproval';
import '../styles/login-auth.css';

/** Loading this page only prepares consent. Only a user click can authorize. */
export default function LoginDesktop() {
  const navigate = useNavigate();
  const [context] = useState(() => {
    if (window.location.search) { clearDesktopApproval(); return null; }
    if (!window.location.hash) return loadDesktopApproval();
    const parsed = parseDesktopApproval(window.location.hash, window.location.origin);
    clearDesktopApproval();
    if (!parsed || !saveDesktopApproval(parsed)) return null;
    window.history.replaceState(null, '', '/login/desktop');
    return parsed;
  });
  const [consent, setConsent] = useState<DesktopConsent | null>(null);
  const [compared, setCompared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState(context ? 'Vérification de la demande…' : 'Demande invalide ou expirée. Recommencez depuis le desktop.');

  useEffect(() => {
    if (!context) return;
    let stopped = false;
    if (!isLoggedIn()) { navigate('/login', { replace: true }); return; }
    void (async () => {
      try {
        const fp = await getCachedFingerprint();
        if (stopped) return;
        if (!/^[A-Za-z0-9._:-]{16,128}$/.test(fp)) throw new DesktopApprovalError('DEVICE_REQUIRED');
        const result = await desktopBrowserPost<DesktopConsent>('prepare', context, getToken() || '', fp);
        if (stopped) return;
        if (result.request_id !== context.request_id || result.origin !== context.origin) throw new DesktopApprovalError('INVALID_PROOF');
        setConsent(result);
        setMessage('Cette action connectera le desktop à votre compte.');
        saveDesktopApproval({ ...context, expiresAt: Math.min(context.expiresAt, Date.parse(result.expires_at)) });
      } catch (e) {
        if (stopped) return;
        if (e instanceof DesktopApprovalError && ['UNAUTHORIZED', 'IP_CHANGED', 'DEVICE_CHANGED', 'DEVICE_REVOKED'].includes(e.code)) {
          clearToken();
          navigate('/login', { replace: true });
          return;
        }
        setMessage(e instanceof DesktopApprovalError ? e.message : 'Connexion indisponible. Recommencez depuis le desktop.');
        clearDesktopApproval();
      }
    })();
    return () => { stopped = true; };
  }, [context, navigate]);

  useEffect(() => {
    if (!consent || done) return;
    const timer = window.setTimeout(() => {
      setConsent(null);
      setMessage('Confirmation expirée. Recommencez depuis le desktop.');
      clearDesktopApproval();
    }, Math.max(0, Math.min(Date.parse(consent.expires_at), Date.parse(consent.consent_expires_at)) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [consent, done]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!context || !consent || busy || done || (decision === 'approve' && !compared)) return;
    setBusy(true);
    try {
      const fp = await getCachedFingerprint();
      await desktopBrowserPost('authorize', context, getToken() || '', fp, { csrf_token: consent.csrf_token, decision });
      setDone(true);
      setMessage(decision === 'approve' ? 'Desktop autorisé. Revenez dans l’application desktop pour terminer la connexion.' : 'Connexion refusée. Le desktop ne sera pas connecté.');
      clearDesktopApproval();
    } catch (e) {
      setMessage(e instanceof DesktopApprovalError ? e.message : 'Impossible de confirmer. Recommencez depuis le desktop.');
      setConsent(null);
      clearDesktopApproval();
    } finally { setBusy(false); }
  };

  return <main className="login-qr-page">
    <section className="login-qr-card" aria-labelledby="desktop-auth-title">
      <p className="login-qr-brand">Atlas Commerce</p>
      <h1 id="desktop-auth-title">Autoriser le desktop</h1>
      <p role="status" className="login-qr-msg">{message}</p>
      {consent && !done ? <>
        <p className="login-qr-account">Compte : <strong><bdi>{consent.username}</bdi></strong></p>
        <p>Serveur : <strong style={{ overflowWrap: 'anywhere' }}>{consent.origin}</strong></p>
        <p>Appareil : <strong><bdi>{consent.device_label}</bdi></strong> (nom déclaré par le client)</p>
        <p>Code à comparer : <strong>{consent.pairing_code}</strong></p>
        <p>Autorisez uniquement une demande que vous venez de lancer dans votre application desktop, sur ce serveur. N’acceptez jamais un code envoyé par une autre personne.</p>
        <label><input type="checkbox" checked={compared} disabled={busy} onChange={e => setCompared(e.target.checked)} /> Le même code apparaît dans mon application desktop.</label>
        <div className="login-qr-actions">
          <button type="button" className="login-qr-btn login-qr-btn--ok" disabled={!compared || busy} onClick={() => void decide('approve')}>Autoriser ce desktop</button>
          <button type="button" className="login-qr-btn login-qr-btn--no" disabled={busy} onClick={() => void decide('deny')}>Refuser</button>
        </div>
      </> : null}
      <p className="login-qr-hint">Aucun jeton de session n’est transmis dans un lien ou à un callback. Vous pouvez fermer cette page après votre décision.</p>
      {!consent && !done ? <Link to="/login" onClick={clearDesktopApproval}>Retour à la connexion</Link> : null}
    </section>
  </main>;
}
