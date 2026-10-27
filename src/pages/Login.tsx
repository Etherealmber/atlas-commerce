import { useState, useEffect, useRef } from 'react';
import '../styles/login-auth.css';
import AnimatedCharacters from '../components/login/AnimatedCharacters';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { openConsentSettings } from '../lib/cookieConsent';
import { setToken, clearToken, getToken, setProfileCache, isLoggedIn, isStockRole, sanitizeAvatarUrl } from '../auth';

/** Same home for phone and desktop — responsive shell. */
function postLoginPath(): string {
  return '/';
}

import { APP_BUILD_DATE, APP_NAME, APP_VERSION, APP_CREATOR, APP_CREATOR_NAME, APP_PROFILE, APP_GITHUB } from '../version';
import { getApiBase } from '../config';
import { validateLoginForm, firstError } from '../lib/formValidate';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';
import {
  getCachedFingerprint,
  isBiometricAvailable,
  isWebAuthnAvailable,
  registerWebAuthn,
  authenticateWebAuthn,
  setStoredBiometricCredentialId,
  getStoredBiometricCredentialId,
  getDeviceLabel,
  getDeviceMeta,
} from '../fingerprint';


/**
 * True only for embedded native shell (Capacitor) — NOT mobile browsers.
 * Chrome/Safari on phone must still show Turnstile.
 * The Gradle Android app never loads this page; it hits the Worker API with OkHttp.
 */
function isMobileLogin() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(max-width: 768px)').matches) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
  } catch { /* */ }
  return false;
}
/** Installed PWA / standalone display mode */
function isPwaLogin() {
  try {
    if (typeof window === 'undefined') return false;
    const mq = window.matchMedia('(display-mode: standalone)').matches;
    const ios = !!(navigator as any).standalone;
    return mq || ios;
  } catch {
    return false;
  }
}
/** Load Turnstile on web desktop, mobile browser, and PWA — not pure Capacitor shell */
function shouldLoadTurnstile() {
  return !isNativeClient();
}
function isNativeClient(): boolean {
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) return true;
    if (cap?.getPlatform) {
      const plat = String(cap.getPlatform() || '').toLowerCase();
      if (plat === 'android' || plat === 'ios') return true;
    }
    // Only treat as native if Capacitor bridge is present (not a normal mobile browser)
    if (cap && typeof cap.isNativePlatform === 'function') return true;
    const ua = navigator.userAgent || '';
    if (/Atlas-Android|Atlas-iOS/i.test(ua)) return true;
  } catch { /* */ }
  return false;
}

const REASON_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Reconnectez-vous pour continuer (session terminée ou compte mis à jour).',
  IP_CHANGED: 'Votre adresse IP a changé. Veuillez vous reconnecter.',
  DEVICE_CHANGED: 'Un appareil différent a été détecté. Veuillez vous reconnecter.',
  BAD_PASSWORD: 'Identifiant ou mot de passe incorrect.',
  RATE_LIMITED: 'Trop de tentatives. Attendez 15 minutes ou changez de réseau.',
  NO_PASSWORD_CONFIGURED: 'Connexion indisponible. Contactez l’administrateur.',
  OTP_DELIVERY_FAILED: 'Impossible d’envoyer le code. Réessayez plus tard.',
  BAD_OTP: 'Code incorrect. Veuillez réessayer.',
  OTP_EXPIRED: 'Code expiré. Veuillez recommencer la connexion.',
  OTP_REQUIRED: 'Veuillez saisir le code reçu par e-mail.',
  OTP_NOT_REQUESTED: 'Aucun code demandé. Veuillez d\'abord saisir votre mot de passe.',
  DEVICE_NOT_TRUSTED: 'Appareil non reconnu. Utilisez le mot de passe.',
  BIOMETRIC_MISMATCH: 'Biométrie / clé non reconnue. Utilisez le mot de passe.',
  NO_CREDENTIALS: 'Aucune biométrie enregistrée. Utilisez le mot de passe.',
  TURNSTILE_FAILED: 'Vérification anti-bot échouée. Rechargez la page.',
};


function LoginPcQrPanel({ onSuccessFlash }: { onSuccessFlash?: () => void }) {
  const [qrUrl, setQrUrl] = useState('');
  const [token, setTok] = useState('');
  const [left, setLeft] = useState(60);
  const [phase, setPhase] = useState<'wait' | 'claimed' | 'done' | 'denied'>('wait');
  const [who, setWho] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const navigate = useNavigate();
  const pausedRef = useRef(false);

  const refresh = async () => {
    try {
      const res = await api.qrPcSession();
      const d = res.data;
      if (d?.token && d?.qr_url) {
        setTok(d.token);
        setQrUrl(d.qr_url);
        setLeft(60);
        setPhase('wait');
        setWho('');
        setAvatarUrl('');
        pausedRef.current = false;
      }
    } catch { /* */ }
  };

  useEffect(() => {
    if (isMobileLogin()) return;
    void refresh();
  }, []);

  useEffect(() => {
    if (!token || isMobileLogin() || phase !== 'wait') return;
    const id = window.setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          if (!pausedRef.current) void refresh();
          return 60;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [token, phase]);

  useEffect(() => {
    if (!token || isMobileLogin()) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const st = await api.qrLoginStatus(token);
        const s = st.data?.status || '';
        if (st.data?.display_name || st.data?.username) {
          setWho(String(st.data.display_name || st.data.username));
        }
        if (st.data?.avatar_url) setAvatarUrl(sanitizeAvatarUrl(String(st.data.avatar_url)));
        if (s === 'claimed' || (st.data?.has_device && s !== 'denied' && s !== 'expired')) {
          if (phase !== 'done' && phase !== 'denied') {
            setPhase('claimed');
            pausedRef.current = true;
          }
        }
        if (s === 'approved') {
          const fp = (await getCachedFingerprint()) || 'none';
          const fin = await api.qrLoginComplete(token, { fingerprint: fp });
          if (fin.data?.token) {
            setToken(fin.data.token, undefined, fin.data.username, fin.data.role);
            setProfileCache({
              username: fin.data.username,
              role: fin.data.role,
              display_name: (fin.data as any).display_name || who || fin.data.username,
              avatar_url: (fin.data as any).avatar_url || avatarUrl || null,
            });
            // Warm full profile for topbar (photo + name)
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
            setPhase('done');
            onSuccessFlash?.();
            window.setTimeout(() => navigate(postLoginPath(), { replace: true }), 1100);
            return;
          }
        }
        if (s === 'denied') {
          setPhase('denied');
          pausedRef.current = true;
        }
        if (s === 'expired' && phase === 'wait') {
          void refresh();
        }
      } catch { /* */ }
      if (!stopped) window.setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [token, navigate, phase, onSuccessFlash]);

  if (isMobileLogin()) return null;

  return (
    <div className="atlas-login-qr-panel">
      <AnimatePresence mode="wait">
        {phase === 'wait' ? (
          <motion.div
            key="qr"
            className="atlas-login-qr-stage"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          >
            <div className="atlas-login-qr-frame">
              {qrUrl ? (
                <QRCodeSVG
                  value={qrUrl}
                  size={180}
                  level="H"
                  bgColor="#ffffff"
                  fgColor="#0a0a0a"
                  imageSettings={{
                    src: '/atlas-icon-light.png',
                    height: 40,
                    width: 40,
                    excavate: true,
                  }}
                />
              ) : (
                <span className="atlas-login-qr-loading">…</span>
              )}
            </div>
            <h2 className="atlas-login-qr-title">Connexion avec un QR</h2>
            <p className="atlas-login-qr-hint">
              Scannez avec l’<strong>app Atlas</strong> pour vous connecter instantanément.
            </p>
            {typeof window !== 'undefined' && window.PublicKeyCredential ? (
              <button
                type="button"
                className="atlas-login-passkey-link"
                onClick={() => window.dispatchEvent(new CustomEvent('atlas-login-passkey'))}
              >
                Ou se connecter avec une passkey
              </button>
            ) : null}
          </motion.div>
        ) : phase === 'claimed' ? (
          <motion.div
            key="claimed"
            className="atlas-login-qr-stage atlas-login-qr-waiting-block"
            initial={{ opacity: 0, scale: 0.7, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <motion.div
              className="atlas-login-qr-avatar-lg"
              initial={{ scale: 0.5, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}
              aria-hidden
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="atlas-login-qr-avatar-img"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.style.display = 'none';
                    const sib = el.parentElement?.querySelector('.atlas-login-qr-avatar-letter') as HTMLElement | null;
                    if (sib) sib.style.display = 'flex';
                  }}
                />
              ) : null}
              <span
                className="atlas-login-qr-avatar-letter"
                style={{ display: avatarUrl ? 'none' : 'flex' }}
              >
                {(who || '?').slice(0, 1).toUpperCase()}
              </span>
            </motion.div>
            <h2 className="atlas-login-qr-title">Vérifiez votre téléphone !</h2>
            <p className="atlas-login-qr-hint">
              Acceptez sur le téléphone pour <strong>{who || '…'}</strong>
            </p>
            <button type="button" className="atlas-login-passkey-link" onClick={() => void refresh()}>
              Ce n’est pas moi — recommencer
            </button>
          </motion.div>
        ) : phase === 'denied' ? (
          <motion.div
            key="denied"
            className="atlas-login-qr-stage atlas-login-qr-denied"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            <div className="atlas-login-qr-denied-icon" aria-hidden>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6M9 9l6 6" />
              </svg>
            </div>
            <h2 className="atlas-login-qr-title">Connexion refusée</h2>
            <p className="atlas-login-qr-hint">
              L’autorisation a été refusée sur le téléphone.
            </p>
            <button type="button" className="atlas-login-qr-retry" onClick={() => void refresh()}>
              Réessayer
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            className="atlas-login-qr-stage atlas-login-qr-waiting-block"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
          >
            <motion.div
              className="atlas-login-qr-avatar-lg atlas-login-qr-avatar-lg--ok"
              initial={{ scale: 0.85 }}
              animate={{ scale: [0.85, 1.06, 1] }}
              transition={{ duration: 0.55 }}
              aria-hidden
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="atlas-login-qr-avatar-img" referrerPolicy="no-referrer" />
              ) : (
                <span className="atlas-login-qr-avatar-letter" style={{ display: 'flex' }}>
                  {(who || '?').slice(0, 1).toUpperCase()}
                </span>
              )}
            </motion.div>
            <h2 className="atlas-login-qr-title">Connexion…</h2>
            <p className="atlas-login-qr-hint">
              Bienvenue <strong>{who || ''}</strong>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


export default function Login() {
  useEffect(() => {
    document.documentElement.classList.add('atlas-login-page');
    return () => document.documentElement.classList.remove('atlas-login-page');
  }, []);
  useEffect(() => {
    const onPk = () => { void loginWithWebAuthnRef.current?.(); };
    window.addEventListener('atlas-login-passkey', onPk);
    return () => window.removeEventListener('atlas-login-passkey', onPk);
  }, []);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // v0.7 — never prefill an identity: the field starts empty (placeholder only).
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [loading, setLoading] = useState(false);
  const loginWithWebAuthnRef = useRef<(() => void) | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState(
    params.get('reason') ? REASON_MESSAGES[params.get('reason')!] || 'Veuillez vous connecter pour continuer.' : ''
  );
  const [info, setInfo] = useState('');
  const [deviceTrusted, setDeviceTrusted] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [offerBioSetup, setOfferBioSetup] = useState(false);
  const [passwordConfigured, setPasswordConfigured] = useState(true);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileHint, setTurnstileHint] = useState(false);
  const turnstileWidgetId = useRef<string | undefined>(undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [pageExit, setPageExit] = useState(false);
  const [remember30, setRemember30] = useState(() => {
    try {
      return localStorage.getItem('atlas_remember_login') === '1';
    } catch {
      return false;
    }
  });
  const [focusField, setFocusField] = useState<'none' | 'username' | 'password'>('none');

  /** Huddle-style character mood from focus + password visibility */
  const loginMood: 'idle' | 'nosy' | 'shy' | 'exposed' = (() => {
    if (showPassword && password) return 'exposed';
    if (focusField === 'password') return 'shy';
    if (focusField === 'username') return 'nosy';
    return 'idle';
  })();

  useEffect(() => {
    try {
      const st = sessionStorage.getItem('atlas_session_toast');
      if (st) {
        sessionStorage.removeItem('atlas_session_toast');
        setError((prev) => prev || st);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    // Already signed in → leave login (do not clear session)
    const reason = params.get('reason');
    if (!reason && isLoggedIn()) {
      navigate(isStockRole() && postLoginPath() === '/' ? '/products' : postLoginPath(), { replace: true });
      return;
    }
    // Forced re-login (session expired, etc.)
    if (reason) {
      clearToken();
      try { window.history.replaceState({}, '', '/login'); } catch { /* */ }
    }
    (async () => {
      try {
        // Capacitor native APK: skip widget. Mobile browser + PWA + desktop: load Turnstile.
        if (!shouldLoadTurnstile()) {
          setTurnstileSiteKey(null);
          setTurnstileToken('');
        } else {
          const client =
            isPwaLogin() ? 'pwa' : isMobileLogin() ? 'mobile-web' : 'web';
          const tr = await fetch(`${getApiBase()}/api/auth/turnstile-config`, {
            headers: { 'X-Atlas-Client': client },
          });
          const tj = await tr.json().catch(() => ({}));
          const key = tj?.data?.enabled && tj?.data?.site_key ? String(tj.data.site_key) : '';
          if (key) {
            setTurnstileSiteKey(key);
            if (!(window as any).turnstile) {
              const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
              if (!existing) {
                const s = document.createElement('script');
                s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                s.async = true;
                s.defer = true;
                document.head.appendChild(s);
              }
            }
          }
        }
      } catch { /* optional */ }
      try {
        const fp = await Promise.race([
        getCachedFingerprint().catch(() => 'none'),
        new Promise<string>((r) => setTimeout(() => r('none'), 8000)),
      ]);
        const bio = await isBiometricAvailable().catch(() => false);
        setBioAvailable(bio && isWebAuthnAvailable());
        const res = await fetch(`${getApiBase()}/api/auth/device-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
          body: JSON.stringify({ fingerprint: fp }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.trusted) setDeviceTrusted(true);
        if (data.biometric_registered || data.credential_count > 0) setHasCredentials(true);
        if (data.password_configured === false) {
          setPasswordConfigured(false);
          setError('Connexion indisponible. Contactez l’administrateur.');
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    let widgetId: string | undefined;
    let cancelled = false;
    setTurnstileToken('');
    const tryRender = () => {
      if (cancelled) return true;
      const el = document.getElementById('cf-turnstile');
      const ts = (window as any).turnstile;
      if (!el || !ts) return false;
      // Avoid double-render if already mounted
      if (el.childElementCount > 0) return true;
      try {
        widgetId = ts.render(el, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => setTurnstileToken(token),
          'expired-callback': () => setTurnstileToken(''),
          'error-callback': () => setTurnstileToken(''),
          theme: 'auto',
          size: 'flexible',
        });
        turnstileWidgetId.current = widgetId;
        // v0.7 — watchdog: widget invisible (réseau filtré, WebView ancien) →
        // un seul retry, puis un message lisible au lieu d'un trou silencieux.
        window.setTimeout(() => {
          const box = document.getElementById('cf-turnstile');
          if (box && !box.querySelector('iframe')) {
            try { if (widgetId != null && (window as any).turnstile?.remove) (window as any).turnstile.remove(widgetId); } catch { /* */ }
            try {
              const el2 = document.getElementById('cf-turnstile');
              if (el2) turnstileWidgetId.current = ts.render(el2, {
                sitekey: turnstileSiteKey,
                callback: (token: string) => setTurnstileToken(token),
                'expired-callback': () => setTurnstileToken(''),
                'error-callback': () => setTurnstileToken(''),
                theme: 'auto',
                size: 'flexible',
              });
            } catch { /* */ }
            window.setTimeout(() => {
              const b2 = document.getElementById('cf-turnstile');
              if (b2 && !b2.querySelector('iframe')) setTurnstileHint(true);
            }, 6000);
          }
        }, 6500);
      } catch { /* */ }
      return true;
    };
    if (!tryRender()) {
      const id = window.setInterval(() => {
        if (tryRender()) window.clearInterval(id);
      }, 200);
      return () => {
        cancelled = true;
        window.clearInterval(id);
        try {
          if (widgetId != null && (window as any).turnstile?.remove) {
            (window as any).turnstile.remove(widgetId);
          }
        } catch { /* */ }
      };
    }
    return () => {
      cancelled = true;
      try {
        if (widgetId != null && (window as any).turnstile?.remove) {
          (window as any).turnstile.remove(widgetId);
        }
      } catch { /* */ }
    };
  }, [turnstileSiteKey]);

  const afterToken = (data: any, justTrusted?: boolean) => {
    setToken(data.token, data.ip, (data.username || username).trim().toLowerCase(), data.role || 'user');
    if (data.display_name != null || data.avatar_url != null) {
      setProfileCache({
        display_name: data.display_name,
        avatar_url: data.avatar_url,
        username: data.username,
        role: data.role,
      });
    }
    // Warm profile (avatar + display name) for sidebar / phone
    void fetch(`${getApiBase()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` },
    })
      .then((r) => r.json())
      .then((j) => {
        const m = j?.data || {};
        setProfileCache({
          display_name: m.display_name,
          avatar_url: m.avatar_url,
          username: m.username,
          role: m.role,
        });
      })
      .catch(() => {});
    if ((justTrusted || data.trusted_device) && isWebAuthnAvailable() && !getStoredBiometricCredentialId() && !hasCredentials) {
      setOfferBioSetup(true);
      setInfo(
        justTrusted
          ? 'Appareil de confiance enregistré. Activez biométrie ou clé de sécurité ?'
          : 'Connexion réussie. Activez biométrie ou clé de sécurité pour la prochaine fois ?'
      );
      return;
    }
    setLoginSuccess(true);
      setPageExit(true);
      window.setTimeout(() => navigate(postLoginPath(), { replace: true }), 1100);
  };


  const resetTurnstile = () => {
    setTurnstileToken('');
    try {
      const ts = (window as any).turnstile;
      const id = turnstileWidgetId.current;
      if (ts?.reset && id != null) ts.reset(id);
    } catch { /* */ }
  };

  const submitPassword = async (e: React.FormEvent) => {
    const fe = validateLoginForm({ username, password });
    setFieldErrors(fe);
    if (Object.keys(fe).length) { setError(firstError(fe) || 'Identifiants manquants.'); return; }
    e.preventDefault();
    if (!password) {
      setError('Veuillez saisir votre mot de passe.');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const fp = await Promise.race([
        getCachedFingerprint().catch(() => 'none'),
        new Promise<string>((r) => setTimeout(() => r('none'), 8000)),
      ]);
      const native = isNativeClient();
      // Web + Turnstile configured: require a token before hitting the API
      if (!native && turnstileSiteKey && !turnstileToken) {
        setError('Vérification anti-bot (Turnstile) non prête. Attendez la case « Je ne suis pas un robot », ou rechargez. Sur mobile/PWA le captcha est désactivé.');
        setLoading(false);
        return;
      }
      const res = await fetch(`${getApiBase()}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': fp,
          'X-Atlas-Client': native ? 'native' : 'web',
        },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          password,
          fingerprint: fp,
          turnstile_token: native ? '' : turnstileToken,
          client: native ? 'native' : 'web',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(REASON_MESSAGES[data.code] || data.error || 'Échec de la connexion.');
        setLoginFailed(true);
        window.setTimeout(() => setLoginFailed(false), 3000);
        resetTurnstile();
        return;
      }
      if (data.needs_otp) {
        setStep('otp');
        setInfo(data.message || 'Un code de vérification a été envoyé.');
        return;
      }
      if (data.token) {
        setDeviceTrusted(true);
        afterToken(data, false);
        return;
      }
      setError('Réponse invalide du serveur.');
      setLoginFailed(true);
      window.setTimeout(() => setLoginFailed(false), 3000);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
      setLoginFailed(true);
      window.setTimeout(() => setLoginFailed(false), 3000);
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      setError('Veuillez saisir le code reçu par e-mail.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const fp = await Promise.race([
        getCachedFingerprint().catch(() => 'none'),
        new Promise<string>((r) => setTimeout(() => r('none'), 8000)),
      ]);
      const res = await fetch(`${getApiBase()}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password, otp: otp.trim(), fingerprint: fp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(REASON_MESSAGES[data.code] || data.error || 'Code incorrect.');
        if (data.code === 'OTP_EXPIRED' || data.code === 'OTP_NOT_REQUESTED') {
          setStep('password');
          setOtp('');
          // fallback otp cleared
        }
        return;
      }
      if (data.token) {
        setDeviceTrusted(true);
        afterToken(data, true);
      } else {
        setError('Réponse invalide du serveur.');
      }
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  };

  const loginWithWebAuthn = async () => {
    setLoading(true);
    setError('');
    try {
      const fp = await Promise.race([
        getCachedFingerprint().catch(() => 'none'),
        new Promise<string>((r) => setTimeout(() => r('none'), 8000)),
      ]);
      const optRes = await fetch(`${getApiBase()}/api/auth/webauthn/login/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
        body: JSON.stringify({ fingerprint: fp, username: username.trim() || undefined }),
      });
      const optData = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        setError(REASON_MESSAGES[optData.code] || optData.error || 'WebAuthn indisponible.');
        return;
      }
      const assertion = await authenticateWebAuthn(optData.options);
      const verRes = await fetch(`${getApiBase()}/api/auth/webauthn/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
        body: JSON.stringify({
          fingerprint: fp,
          credential_id: assertion.credentialId,
          challenge: assertion.challenge,
        }),
      });
      const verData = await verRes.json().catch(() => ({}));
      if (!verRes.ok) {
        setError(REASON_MESSAGES[verData.code] || verData.error || 'Échec WebAuthn.');
        return;
      }
      if (verData.token) {
        afterToken(verData);
      }
    } catch (e: any) {
      setError(e?.message || 'Authentification annulée ou échouée.');
    } finally {
      setLoading(false);
    }
  };

  loginWithWebAuthnRef.current = () => { void loginWithWebAuthn(); };

  const setupWebAuthn = async (deviceType: 'platform' | 'cross-platform') => {
    setLoading(true);
    setError('');
    try {
      const fp = await Promise.race([
        getCachedFingerprint().catch(() => 'none'),
        new Promise<string>((r) => setTimeout(() => r('none'), 8000)),
      ]);
      const token = getToken();
      const optRes = await fetch(`${getApiBase()}/api/auth/webauthn/register/options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': fp,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fingerprint: fp, device_type: deviceType }),
      });
      const optData = await optRes.json().catch(() => ({}));
      if (!optRes.ok) {
        setError(optData.error || 'Impossible de démarrer l\'enregistrement.');
        return;
      }
      const reg = await registerWebAuthn(optData.options, deviceType);
      const verRes = await fetch(`${getApiBase()}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': fp,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fingerprint: fp,
          credential_id: reg.credentialId,
          challenge: reg.challenge,
          device_type: deviceType,
          transports: reg.transports,
          device_label: getDeviceLabel(),
          label: getDeviceLabel(),
          device_info: getDeviceMeta(),
        }),
      });
      const verData = await verRes.json().catch(() => ({}));
      if (!verRes.ok) {
        setError(verData.error || 'Échec de l\'enregistrement.');
        return;
      }
      setStoredBiometricCredentialId(reg.credentialId);
      setHasCredentials(true);
      setOfferBioSetup(false);
      navigate(postLoginPath(), { replace: true });
    } catch (e: any) {
      setError(e?.message || 'Enregistrement annulé.');
    } finally {
      setLoading(false);
    }
  };

  const skipBioSetup = () => {
    setOfferBioSetup(false);
    navigate(postLoginPath(), { replace: true });
  };

  return (
    <div className={`atlas-login atlas-login--auth7${(isNativeClient() || isMobileLogin() || isPwaLogin()) ? ' atlas-login--phone' : ''}`}>
      {/* Form column */}
      <div className="atlas-login-card">
        <div className="atlas-login-form-wrap">
          <motion.div
            className="atlas-login-header"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26, bounce: 0, delay: 0.05 }}
          >
            {/* v0.7 — the lockup lives INSIDE the card, above the title */}
            <div className="atlas-login-brand atlas-login-brand--in-card">
              <img src="/atlas-logo-light.png" alt={APP_NAME} className="brand-img brand-img--light" height={64} width={197} />
              <img src="/atlas-logo-dark.png" alt={APP_NAME} className="brand-img brand-img--dark" height={64} width={197} />
            </div>
            <h1>Bon retour</h1>
            <p>Connectez-vous pour gérer stock, caisse et facturation</p>
          </motion.div>

          {error && <div className="atlas-login-alert" role="alert">{error}</div>}
          {info && !error && <div className="atlas-login-info" role="status">{info}</div>}

          {offerBioSetup ? (
            <div className="atlas-login-form atlas-login-auth7-form atlas-login-swap">
              <p className="atlas-login-note">
                Choisissez une méthode rapide pour les prochaines connexions. Le mot de passe reste disponible.
              </p>
              {bioAvailable && (
                <button type="button" className="atlas-login-submit" disabled={loading} onClick={() => setupWebAuthn('platform')}>
                  {loading ? 'Configuration…' : 'Biométrie (Face ID / Touch ID / Windows Hello)'}
                </button>
              )}
              <button type="button" className="atlas-login-secondary" disabled={loading} onClick={() => setupWebAuthn('cross-platform')}>
                {loading ? 'Configuration…' : 'Clé de sécurité (YubiKey, etc.)'}
              </button>
              <button type="button" className="atlas-login-ghost" disabled={loading} onClick={skipBioSetup}>
                Continuer avec le mot de passe uniquement
              </button>
            </div>
          ) : step === 'password' ? (
            <motion.form
              className="atlas-login-form atlas-login-auth7-form"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 28, bounce: 0, delay: 0.1 }}
              onSubmit={async (e) => {
                try {
                  localStorage.setItem('atlas_remember_login', remember30 ? '1' : '0');
                } catch { /* */ }
                setLoginFailed(false);
                setLoginSuccess(false);
                try {
                  await submitPassword(e);
                } catch {
                  setLoginFailed(true);
                  window.setTimeout(() => setLoginFailed(false), 3000);
                }
              }}
            >
              <div className="atlas-field">
                <label htmlFor="username">Identifiant</label>
                <input
                  id="username"
                  type="text"
                  className={fieldErrors.username ? 'is-error' : undefined}
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setFieldErrors((x) => ({ ...x, username: '' })); }}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                  placeholder="Votre identifiant"
                  autoFocus
                  autoComplete="username"
                  disabled={loading || !passwordConfigured}
                />
              </div>

              <div className="atlas-field">
                <label htmlFor="password">
                  Mot de passe{deviceTrusted ? ' (appareil de confiance)' : ''}
                </label>
                <div className="atlas-password-wrap">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className={fieldErrors.password ? 'is-error' : undefined}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setFieldErrors((x) => ({ ...x, password: '' })); }}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={loading || !passwordConfigured}
                  />
                  <button
                    type="button"
                    className="atlas-password-toggle"
                    aria-label={showPassword ? 'Masquer' : 'Afficher'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>

              <label className="atlas-remember">
                <input
                  type="checkbox"
                  className="atlas-remember-input"
                  checked={remember30}
                  onChange={(e) => setRemember30(e.target.checked)}
                />
                <span className="atlas-remember-box" aria-hidden>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span className="atlas-remember-label">Se souvenir 30 jours</span>
              </label>

              {turnstileSiteKey && shouldLoadTurnstile() ? (
                <div id="cf-turnstile" className="atlas-turnstile" />
              ) : null}
              {turnstileHint ? (
                <p className="atlas-turnstile-hint">
                  Vérification Cloudflare indisponible sur cette connexion — actualisez la page
                  ou réessayez depuis un autre réseau.
                </p>
              ) : null}

              <button type="submit" className="atlas-login-submit" disabled={loading || !passwordConfigured}>
                <span>{loading ? 'Un instant…' : deviceTrusted ? 'Entrer dans Atlas' : 'Continuer'}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            </motion.form>
          ) : (
            <form className="atlas-login-form" onSubmit={submitOtp}>
              <div className="atlas-field">
                <label htmlFor="otp">Code de vérification (OTP)</label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="Code reçu par e-mail"
                  autoFocus
                  autoComplete="one-time-code"
                  disabled={loading}
                />
              </div>
              <button type="submit" className="atlas-login-submit" disabled={loading}>
                {loading ? 'Un instant…' : 'Entrer dans Atlas'}
              </button>
              <button
                type="button"
                className="atlas-login-ghost"
                disabled={loading}
                onClick={() => {
                  setStep('password');
                  setOtp('');
                  setError('');
                  setInfo('');
                  // fallback otp cleared
                }}
              >
                ← Retour
              </button>
            </form>
          )}

          <p className="atlas-login-hint">
            {!passwordConfigured
              ? 'Configurez ADMIN_PASSWORD dans Cloudflare Workers.'
              : deviceTrusted
                ? hasCredentials
                  ? 'Appareil de confiance · biométrie ou mot de passe.'
                  : 'Appareil de confiance : mot de passe (pas d\'OTP).'
                : step === 'password'
                  ? null
                  : 'Code valable 10 min.'}
          </p>
          <p className="atlas-login-meta">
            v{APP_VERSION} · {APP_BUILD_DATE}
            <span aria-hidden> · </span>
            <Link to="/whats-new" className="atlas-login-meta-link">Nouveautés</Link>
          </p>
        </div>
        <div className="atlas-login-qr-side" aria-label="Connexion par QR">
          <LoginPcQrPanel onSuccessFlash={() => { setLoginSuccess(true); setPageExit(true); }} />
        </div>
      </div>

      <div className="atlas-login-page-foot">
        <span>© {new Date().getFullYear()} {APP_NAME}</span>
        <Link to="/privacy">Confidentialité</Link>
        <Link to="/terms">Conditions</Link>
        <a href={APP_GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        <span aria-hidden>·</span>
        <span>v{APP_VERSION} · {APP_BUILD_DATE}</span>
        <Link to="/whats-new">Nouveautés</Link>
      </div>
    </div>
  );
}
