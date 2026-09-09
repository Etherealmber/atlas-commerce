import { useState, useEffect, useRef } from 'react';
import AnimatedCharacters from '../components/login/AnimatedCharacters';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { openConsentSettings } from '../lib/cookieConsent';
import { setToken, clearToken, getToken, setProfileCache, isLoggedIn, isStockRole } from '../auth';

/** Desktop → home/dashboard. Mobile/native → /m/ */
function postLoginPath(): string {
  try {
    const ua = navigator.userAgent || '';
    const native = !!(window as any).Capacitor?.isNativePlatform?.();
    const phone =
      native ||
      new URLSearchParams(window.location.search).get('mode') === 'phone' ||
      window.matchMedia('(max-width: 900px)').matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    if (phone) return '/m/';
  } catch { /* */ }
  return '/';
}

import { APP_NAME, APP_VERSION, APP_CREATOR, APP_CREATOR_NAME, APP_PROFILE, APP_GITHUB } from '../version';
import { getApiBase } from '../config';
import { validateLoginForm, firstError } from '../lib/formValidate';
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

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [loading, setLoading] = useState(false);
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
  const turnstileWidgetId = useRef<string | undefined>(undefined);
  const [showPassword, setShowPassword] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
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
        // Phone / APK / mobile: never load Turnstile at all
        if (isNativeClient()) {
          setTurnstileSiteKey(null);
          setTurnstileToken('');
        } else {
          const tr = await fetch(`${getApiBase()}/api/auth/turnstile-config`, {
            headers: { 'X-Atlas-Client': 'web' },
          });
          const tj = await tr.json().catch(() => ({}));
          const key = tj?.data?.enabled && tj?.data?.site_key ? String(tj.data.site_key) : '';
          if (key && !isNativeClient()) {
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
        const fp = await getCachedFingerprint().catch(() => 'none');
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
          theme: 'light',
          size: 'flexible',
        });
        turnstileWidgetId.current = widgetId;
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
      window.setTimeout(() => navigate(postLoginPath(), { replace: true }), 900);
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
      const fp = await getCachedFingerprint().catch(() => 'none');
      const native = isNativeClient();
      // Web + Turnstile configured: require a token before hitting the API
      if (!native && turnstileSiteKey && !turnstileToken) {
        setError('Vérification anti-bot en cours. Attendez le captcha (ou rechargez la page).');
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
      const fp = await getCachedFingerprint().catch(() => 'none');
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
      const fp = await getCachedFingerprint().catch(() => 'none');
      const optRes = await fetch(`${getApiBase()}/api/auth/webauthn/login/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp },
        body: JSON.stringify({ fingerprint: fp }),
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

  const setupWebAuthn = async (deviceType: 'platform' | 'cross-platform') => {
    setLoading(true);
    setError('');
    try {
      const fp = await getCachedFingerprint().catch(() => 'none');
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
    <div className={`atlas-login${isNativeClient() ? ' atlas-login--phone' : ''}`}>
      {/* Left — characters (desktop) */}
      <div className="atlas-login-left">
        <div className="atlas-login-left-logo">
          <img src="/logo.svg" alt="" width={32} height={32} />
          <span>{APP_NAME}</span>
        </div>
        <div className="atlas-login-chars-wrap">
          <AnimatedCharacters
            isTyping={isTyping}
            showPassword={showPassword}
            passwordLength={password.length}
            loginFailed={loginFailed}
            loginSuccess={loginSuccess}
          />
        </div>
        <div className="atlas-login-left-foot">
          <Link to="/privacy">Confidentialité</Link>
          <Link to="/terms">Conditions</Link>
          <a href={APP_GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <div className="atlas-login-grid" aria-hidden />
        <div className="atlas-login-blur atlas-login-blur-1" aria-hidden />
        <div className="atlas-login-blur atlas-login-blur-2" aria-hidden />
      </div>

      {/* Right — form */}
      <div className="atlas-login-right">
        <div className="atlas-login-form-wrap">
          <div className="atlas-login-mobile-logo">
            <img src="/logo.svg" alt="" width={36} height={36} />
            <span>{APP_NAME}</span>
          </div>

          <div className="atlas-login-header">
            <h1>Bon retour !</h1>
            <p>Identifiant administrateur · Stock &amp; facturation</p>
          </div>

          {/* Mobile characters strip */}
          {!isNativeClient() && (
            <div className="atlas-login-chars-mobile">
              <AnimatedCharacters
                isTyping={isTyping}
                showPassword={showPassword}
                passwordLength={password.length}
                loginFailed={loginFailed}
                loginSuccess={loginSuccess}
              />
            </div>
          )}

          {error && <div className="atlas-login-alert" role="alert">{error}</div>}
          {info && !error && <div className="atlas-login-info" role="status">{info}</div>}

          {offerBioSetup ? (
            <div className="atlas-login-form">
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
            <form
              className="atlas-login-form"
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
              {hasCredentials && isWebAuthnAvailable() && (
                <button type="button" className="atlas-login-secondary" disabled={loading} onClick={loginWithWebAuthn}>
                  {loading ? 'Vérification…' : 'Biométrie / Clé de sécurité'}
                </button>
              )}

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
                <input type="checkbox" checked={remember30} onChange={(e) => setRemember30(e.target.checked)} />
                <span>Se souvenir 30 jours</span>
              </label>

              {turnstileSiteKey && !isNativeClient() ? (
                <div id="cf-turnstile" className="atlas-turnstile" />
              ) : null}

              <button type="submit" className="atlas-login-submit" disabled={loading || !passwordConfigured}>
                <span>{loading ? 'Vérification…' : deviceTrusted ? 'Se connecter' : 'Continuer'}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            </form>
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
                {loading ? 'Connexion…' : 'Se connecter'}
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
                  ? 'Nouvel appareil : mot de passe + OTP e-mail.'
                  : 'Code valable 10 min.'}
          </p>
          <p className="atlas-login-meta">v{APP_VERSION}</p>
        </div>
      </div>
    </div>
  );
}
