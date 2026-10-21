import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { setToken, setProfileCache, isLoggedIn, getToken, sanitizeAvatarUrl } from '../auth';
import { getCachedFingerprint } from '../fingerprint';
import '../styles/login-auth.css';

/**
 * Phone / mobile-web handler for QR codes.
 * - mode=pc: must be logged in → claim → Accept/Refuse → approve PC
 * - default (settings): phone claims → PC approves → phone receives token
 */
export default function LoginQr() {
  const [params] = useSearchParams();
  const token = (params.get('t') || '').trim();
  const mode = (params.get('mode') || '').trim();
  const [status, setStatus] = useState<'loading' | 'confirm' | 'ok' | 'wait' | 'err'>('loading');
  const [msg, setMsg] = useState('Traitement du QR…');
  const [account, setAccount] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const fpRef = useRef('none');

  useEffect(() => {
    if (!token) {
      setStatus('err');
      setMsg('Lien QR invalide.');
      return;
    }
    let stopped = false;
    let timer: number | undefined;

    const run = async () => {
      try {
        const fp = (await getCachedFingerprint()) || 'none';
        fpRef.current = fp;

        // PC authorization: claim then wait for Accept on this phone (native or mobile web)
        if (mode === 'pc') {
          if (!isLoggedIn() || !getToken()) {
            setStatus('err');
            setMsg('Connectez-vous d’abord sur ce téléphone (app ou navigateur), puis rescannnez le QR du PC.');
            return;
          }
          const res = await api.qrPhoneBind(token, {
            fingerprint: fp,
            user_agent: navigator.userAgent,
            confirm: false,
          });
          if (stopped) return;
          setAccount(res.data?.display_name || res.data?.username || '');
          if (res.data?.avatar_url) setAvatarUrl(sanitizeAvatarUrl(String(res.data.avatar_url)));
          if (res.data?.needs_confirm || res.data?.status === 'claimed') {
            setStatus('confirm');
            setMsg('Autoriser la connexion de cet ordinateur avec votre compte ?');
            return;
          }
          // Already approved (legacy)
          setStatus('ok');
          setMsg(res.data?.message || 'Ordinateur autorisé. Revenez sur le PC.');
          return;
        }

        // Settings flow: phone logs in after PC approves
        await api.qrLoginClaim(token, {
          fingerprint: fp,
          user_agent: navigator.userAgent,
        });
        if (stopped) return;
        setStatus('wait');
        setMsg('Scanné — validez sur l’ordinateur (Accepter).');

        const poll = async () => {
          if (stopped || done.current) return;
          try {
            const st = await api.qrLoginStatus(token);
            const s = st.data?.status || '';
            if (st.data?.display_name || st.data?.username) {
              setAccount(String(st.data.display_name || st.data.username));
            }
            if (st.data?.avatar_url) setAvatarUrl(sanitizeAvatarUrl(String(st.data.avatar_url)));
            if (s === 'denied' || s === 'expired') {
              setStatus('err');
              setMsg(s === 'denied' ? 'Connexion refusée sur l’ordinateur.' : 'QR expiré.');
              return;
            }
            if (s === 'approved' || s === 'consumed') {
              const fin = await api.qrLoginComplete(token, { fingerprint: fp });
              if (fin.data?.token) {
                done.current = true;
                setToken(fin.data.token, undefined, fin.data.username, fin.data.role);
                setProfileCache({
                  username: fin.data.username,
                  role: fin.data.role,
                  display_name: (fin.data as any).display_name || fin.data.username,
                  avatar_url: (fin.data as any).avatar_url || null,
                });
                try {
                  const me = await api.getMe();
                  const m = (me as any)?.data || me;
                  if (m) {
                    setProfileCache({
                      username: m.username || fin.data.username,
                      role: m.role || fin.data.role,
                      display_name: m.display_name,
                      avatar_url: m.avatar_url,
                    });
                  }
                } catch { /* */ }
                setStatus('ok');
                setMsg('Connecté. Redirection…');
                window.setTimeout(() => window.location.replace('/'), 500);
                return;
              }
            }
            setStatus('wait');
            setMsg('En attente de validation sur l’ordinateur…');
          } catch (e: any) {
            if (e?.code === 'USED') {
              setStatus('err');
              setMsg('Ce QR a déjà été utilisé.');
              return;
            }
          }
          timer = window.setTimeout(poll, 2000) as unknown as number;
        };
        void poll();
      } catch (e: any) {
        setStatus('err');
        setMsg(e?.message || 'Impossible d’utiliser ce QR.');
      }
    };
    void run();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [token, mode]);

  const onAccept = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      const res = await api.qrPhoneBind(token, {
        fingerprint: fpRef.current,
        user_agent: navigator.userAgent,
        confirm: true,
      });
      setStatus('ok');
      setMsg(res.data?.message || 'Ordinateur autorisé. Revenez sur le PC — connexion en cours.');
      if (res.data?.display_name || res.data?.username) {
        setAccount(String(res.data.display_name || res.data.username));
      }
    } catch (e: any) {
      setStatus('err');
      setMsg(e?.message || 'Échec de la confirmation.');
    } finally {
      setBusy(false);
    }
  };

  const onRefuse = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      await api.qrLoginDeny(token);
      setStatus('err');
      setMsg('Connexion refusée. L’ordinateur ne sera pas connecté.');
    } catch (e: any) {
      setStatus('err');
      setMsg(e?.message || 'Impossible de refuser.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-qr-page">
      <div className="login-qr-card">
        <p className="login-qr-brand">Atlas Commerce</p>
        <h1>{mode === 'pc' ? 'Autoriser l’ordinateur' : 'Connexion par QR'}</h1>

        {(account || avatarUrl) && (
          <div className="login-qr-identity">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="login-qr-avatar" width={72} height={72} />
            ) : account ? (
              <div className="login-qr-avatar login-qr-avatar--letter" aria-hidden>
                {account.slice(0, 1).toUpperCase()}
              </div>
            ) : null}
            {account ? (
              <p className="login-qr-account">
                Compte : <strong>{account}</strong>
              </p>
            ) : null}
          </div>
        )}

        <p className={`login-qr-msg login-qr-msg--${status}`}>{msg}</p>

        {status === 'confirm' ? (
          <div className="login-qr-actions">
            <button type="button" className="login-qr-btn login-qr-btn--ok" disabled={busy} onClick={() => void onAccept()}>
              {busy ? '…' : 'Accepter'}
            </button>
            <button type="button" className="login-qr-btn login-qr-btn--no" disabled={busy} onClick={() => void onRefuse()}>
              Refuser
            </button>
          </div>
        ) : null}

        {status === 'err' ? (
          <Link className="login-qr-link" to="/login">
            Aller à la connexion
          </Link>
        ) : null}
        {status === 'ok' && mode === 'pc' ? (
          <p className="login-qr-hint">Vous pouvez fermer cette page et revenir sur le PC.</p>
        ) : null}
      </div>
    </div>
  );
}
