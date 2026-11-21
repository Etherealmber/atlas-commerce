import { useEffect, useRef, useState } from 'react';
import { parsePhoneApproval, type PhoneApprovalContext } from '../lib/desktopPhoneApproval';
import '../styles/login-auth.css';

type Challenge = {
  request_id: string; origin: string; device_label: string; pairing_code: string;
  site_key: string; action: string; cdata: string; expires_at: string;
};
const base = '/api/auth/desktop/v2/pilot/browser';

async function post(action: 'prepare' | 'decision', context: PhoneApprovalContext, extra: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${base}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...context, ...extra }), cache: 'no-store', credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    const json: any = await response.json().catch(() => null);
    if (!response.ok || json?.success !== true) throw new Error('FAILED');
    return json.data;
  } finally { window.clearTimeout(timer); }
}

/** Staging-only challenge experiment; never handles a password, OTP or session. */
export default function DesktopChallengePilot() {
  const [context] = useState(() => parsePhoneApproval(window.location.hash, window.location.origin, window.location.search));
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [message, setMessage] = useState('Vérification de la demande…');
  const [compared, setCompared] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const prepared = useRef<Promise<Challenge> | null>(null);
  const widget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    try { window.history.replaceState(null, '', '/login/desktop-challenge'); }
    catch { setMessage('Impossible de sécuriser la demande. Recommencez sur le desktop.'); return; }
    if (!context) { setMessage('Demande invalide. Recommencez sur le desktop.'); return; }
    if (!prepared.current) prepared.current = post('prepare', context);
    prepared.current!.then(data => {
      const expiry = Date.parse(data?.expires_at);
      if (data?.origin !== context.origin || data?.request_id !== context.request_id ||
          typeof data.device_label !== 'string' || !data.device_label || data.device_label.length > 60 ||
          !/^[A-Za-z0-9_-]{5}-[A-Za-z0-9_-]{5}$/.test(data.pairing_code || '') ||
          typeof data.site_key !== 'string' || !data.site_key || data.site_key.length > 255 ||
          data.action !== 'atlas_desktop_v2' || !/^[a-f0-9]{64}$/.test(data.cdata || '') ||
          !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 300_000) throw new Error('INVALID');
      if (!stopped) { setChallenge(data); setMessage('Comparez la demande avant de continuer.'); }
    }).catch(() => { if (!stopped) setMessage('Défi indisponible. Recommencez sur le desktop.'); });
    return () => { stopped = true; };
  }, [context]);

  useEffect(() => {
    if (!challenge || !widget.current) return;
    const box = widget.current;
    let cancelled = false; let id: string | undefined; let rendered = false;
    let script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
    if (!(window as any).turnstile?.render && !script) {
      script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.defer = true;
    }
    const unavailable = () => { if (!cancelled) { setToken(''); setMessage('Défi indisponible. Recommencez sur le desktop.'); } };
    const render = () => {
      if (cancelled || rendered || !(window as any).turnstile?.render) return;
      try {
        id = (window as any).turnstile.render(box, {
          sitekey: challenge.site_key, action: challenge.action, cData: challenge.cdata, size: 'compact',
          callback: (value: string) => { if (!cancelled) setToken(value); },
          'error-callback': unavailable, 'expired-callback': unavailable, 'timeout-callback': unavailable,
        });
        rendered = true;
      } catch { unavailable(); }
    };
    script?.addEventListener('load', render); script?.addEventListener('error', unavailable);
    if (script && !script.isConnected) document.head.appendChild(script);
    render();
    const watchdog = window.setTimeout(() => { if (!rendered) unavailable(); }, 10_000);
    return () => {
      cancelled = true; window.clearTimeout(watchdog);
      script?.removeEventListener('load', render); script?.removeEventListener('error', unavailable);
      try { if (id != null) (window as any).turnstile?.remove?.(id); } catch { /* */ }
      box.replaceChildren();
    };
  }, [challenge]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!context || !challenge || busy || (decision === 'approve' && (!compared || !token))) return;
    setBusy(true);
    try {
      const result = await post('decision', context, decision === 'approve'
        ? { decision, compare_confirmed: true, turnstile_token: token } : { decision });
      if (result?.status !== (decision === 'approve' ? 'verified' : 'denied')) throw new Error('INVALID');
      setMessage(decision === 'approve' ? 'Défi vérifié. Revenez sur le desktop ; aucune connexion n’a été créée.' : 'Demande refusée.');
    } catch { setMessage('Impossible de confirmer. Recommencez sur le desktop.'); }
    finally { setToken(''); setChallenge(null); setBusy(false); }
  };

  return <main className="login-qr-page"><section className="login-qr-card" aria-labelledby="pilot-title">
    <p className="login-qr-brand">Atlas Commerce</p><h1 id="pilot-title">Vérification desktop — pilote</h1>
    <p role="status">{message}</p>
    {challenge && <>
      <p>Serveur : <strong style={{ overflowWrap: 'anywhere' }}>{challenge.origin}</strong></p>
      <p>Appareil : <strong><bdi>{challenge.device_label}</bdi></strong> (nom déclaré, non vérifié)</p>
      <p>Code à comparer : <strong>{challenge.pairing_code}</strong></p>
      <p>N’acceptez que votre propre demande. Un code communiqué par une autre personne peut servir à un abus.</p>
      <div ref={widget} />
      <label><input type="checkbox" checked={compared} disabled={busy} onChange={e => setCompared(e.target.checked)} /> Le même code apparaît sur mon desktop.</label>
      <div className="login-qr-actions">
        <button type="button" disabled={!compared || !token || busy} onClick={() => void decide('approve')}>Confirmer la vérification</button>
        <button type="button" disabled={busy} onClick={() => void decide('deny')}>Refuser</button>
      </div>
    </>}
    <p>Cette page ne demande aucun mot de passe ni code OTP et ne crée pas de session.</p>
  </section></main>;
}
