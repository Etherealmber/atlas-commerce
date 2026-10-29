/**
 * /verify — one-tap e-mail verification (OTP deep link).
 *
 * The OTP e-mail button lands here with ?user&code&sig&exp. The page:
 *  1. detects the environment: installed PWA (standalone display-mode),
 *     native Android app (via an `atlascommerce://verify` intent handoff —
 *     the Kotlin app verifies the link itself and falls back to this page
 *     when not installed), or plain browser;
 *  2. submits the signed link to POST /api/auth/verify-link — the user never
 *     types the code;
 *  3. stores the session exactly like the login page and opens the app.
 *
 * Visual language mirrors the e-mail template — which follows the server
 * theme (dark zinc canvas, terracotta action, saffron accents) — so the tap
 * feels continuous.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { setToken, setProfileCache } from '../auth';
import { getApiBase } from '../config';
import { getCachedFingerprint } from '../fingerprint';

type Status = 'detect' | 'verifying' | 'ok' | 'error';

const ORANGE = '#c45c26'; /* terracotta Atlas */
const SALMON = '#d4a017'; /* saffron Atlas */
const CANVAS = '#09090b'; /* zinc-950 — thème serveur */
const CARD = '#18181b'; /* zinc-900 */
const LINE = '#27272a'; /* zinc-800 */
const INK = '#fafafa'; /* zinc-50 */
const GREY = '#a1a1aa'; /* zinc-400 */

export default function EmailVerify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = params.get('user') || '';
  const code = params.get('code') || '';
  const sig = params.get('sig') || '';
  const exp = params.get('exp') || '';

  const [status, setStatus] = useState<Status>('detect');
  const [error, setError] = useState('');
  const [env, setEnv] = useState<{ pwa: boolean; android: boolean; handedOff: boolean }>({
    pwa: false,
    android: false,
    handedOff: false,
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const pwa =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    const android = /android/i.test(navigator.userAgent || '');
    setEnv({ pwa, android, handedOff: false });

    const run = async () => {
      // Native handoff (Android browsers only, once per tab): if the Kotlin
      // app is installed it opens straight on its verification screen; if
      // not, Chrome reloads this very URL as the fallback and we continue
      // in the web/PWA path (the sessionStorage flag prevents a loop).
      if (android && !pwa && !sessionStorage.getItem('verify-handoff-tried')) {
        sessionStorage.setItem('verify-handoff-tried', '1');
        const fallback = encodeURIComponent(window.location.href);
        const intent =
          `intent://verify?user=${encodeURIComponent(user)}&code=${encodeURIComponent(code)}` +
          `&sig=${encodeURIComponent(sig)}&exp=${encodeURIComponent(exp)}` +
          `#Intent;scheme=atlascommerce;package=ma.etherealmber.atlascommerce;` +
          `S.browser_fallback_url=${fallback};end`;
        setEnv((e) => ({ ...e, handedOff: true }));
        window.location.replace(intent);
        // If the intent did not navigate (app absent → fallback reloads),
        // the line below resumes the web verification on the reloaded page.
        await new Promise((r) => setTimeout(r, 1200));
      }
      setStatus('verifying');
      try {
        const fp = await Promise.race([
          getCachedFingerprint().catch(() => 'none'),
          new Promise<string>((r) => setTimeout(() => r('none'), 8000)),
        ]);
        const res = await fetch(`${getApiBase()}/api/auth/verify-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
          body: JSON.stringify({ username: user, otp: code, sig, exp: Number(exp), fingerprint: fp }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (!res.ok || !data.token) {
          setError(
            data.code === 'LINK_EXPIRED' || data.code === 'OTP_EXPIRED'
              ? 'Ce lien a expiré (10 minutes). Relancez une connexion pour recevoir un nouveau code.'
              : data.code === 'BAD_OTP'
                ? 'Ce code a déjà été utilisé ou est invalide.'
                : data.error || 'Vérification impossible sur cet appareil.',
          );
          setStatus('error');
          return;
        }
        setToken(data.token, data.ip, String(data.username || user).toLowerCase(), data.role || 'user');
        setProfileCache({
          display_name: data.display_name ?? null,
          avatar_url: data.avatar_url ?? null,
          username: data.username,
          role: data.role,
        });
        setStatus('ok');
        window.setTimeout(() => navigate('/', { replace: true }), 1400);
      } catch {
        setError('Erreur réseau. Vérifiez votre connexion puis rouvrez le lien du mail.');
        setStatus('error');
      }
    };
    void run();
  }, [user, code, sig, exp, navigate]);

  const chip = (on: boolean, label: string) =>
    on ? (
      <span
        style={{
          display: 'inline-block',
          margin: '3px 4px',
          padding: '5px 12px',
          borderRadius: 999,
          background: CARD,
          border: `1px solid ${LINE}`,
          fontSize: 12,
          fontWeight: 600,
          color: '#e4e4e7',
        }}
      >
        {label}
      </span>
    ) : null;

  return (
    <div style={{ minHeight: '100vh', background: CANVAS, display: 'grid', placeItems: 'center', padding: 22 }}>
      <div style={{ width: '100%', maxWidth: 460, textAlign: 'center' }}>
        <img src="/atlas-logo-dark.png" alt="Atlas" style={{ display: 'block', height: 42, width: 'auto', maxWidth: '100%', margin: '0 auto' }} />
        <div style={{ height: 26 }} />
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: SALMON, textTransform: 'uppercase' }}>
          Vérification de l’appareil
        </div>
        <h1 style={{ margin: '12px 0 0', fontSize: 28, lineHeight: 1.2, fontWeight: 800, color: INK }}>
          {status === 'ok' ? (
            <>
              Appareil vérifié <em style={{ fontFamily: "Georgia,'Times New Roman',serif", fontStyle: 'italic', fontWeight: 600, color: SALMON }}>✓</em>
            </>
          ) : status === 'error' ? (
            <>
              Vérification <em style={{ fontFamily: "Georgia,'Times New Roman',serif", fontStyle: 'italic', fontWeight: 600, color: SALMON }}>interrompue</em>
            </>
          ) : (
            <>
              Un instant, nous sécurisons votre <em style={{ fontFamily: "Georgia,'Times New Roman',serif", fontStyle: 'italic', fontWeight: 600, color: SALMON }}>compte</em>
            </>
          )}
        </h1>
        <p style={{ margin: '14px auto 0', maxWidth: 380, fontSize: 14, lineHeight: 1.65, color: GREY }}>
          {status === 'ok'
            ? 'Session ouverte sur cet appareil. Ouverture de l’application…'
            : status === 'error'
              ? error
              : 'Le code du mail est transmis automatiquement — rien à saisir.'}
        </p>

        <div style={{ margin: '24px 0 0', background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: '22px 16px' }}>
          {status === 'ok' ? (
            <div style={{ fontSize: 34, fontWeight: 800, color: '#16a34a' }}>✓</div>
          ) : status === 'error' ? (
            <div style={{ fontSize: 30, fontWeight: 800, color: '#dc2626' }}>!</div>
          ) : (
            <div
              aria-label="vérification en cours"
              style={{
                width: 34,
                height: 34,
                margin: '0 auto',
                borderRadius: '50%',
                border: `3px solid ${LINE}`,
                borderTopColor: ORANGE,
                animation: 'emailverify-spin 0.9s linear infinite',
              }}
            />
          )}
          <style>{'@keyframes emailverify-spin{to{transform:rotate(360deg)}}'}</style>
        </div>

        <div style={{ marginTop: 16 }}>
          {chip(env.pwa, 'App PWA installée')}
          {chip(env.android && !env.pwa, 'Android')}
          {chip(env.handedOff, 'Ouverture de l’app native tentée')}
          {!env.pwa && !env.android ? chip(true, 'Navigateur') : null}
        </div>

        {status === 'error' && (
          <div style={{ marginTop: 22 }}>
            <Link
              to={`/login?user=${encodeURIComponent(user)}&hint=otp`}
              style={{
                display: 'block',
                background: ORANGE,
                borderRadius: 10,
                padding: '15px 12px',
                color: '#fff',
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}
            >
              Saisir le code manuellement
            </Link>
          </div>
        )}
        <p style={{ margin: '22px auto 0', maxWidth: 360, fontSize: 12, lineHeight: 1.6, color: '#71717a' }}>
          Vous n’êtes pas à l’origine de cette demande ? Fermez cette page et changez votre mot de passe.
        </p>
      </div>
    </div>
  );
}
