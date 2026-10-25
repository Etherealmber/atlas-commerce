/**
 * Device fingerprint + WebAuthn (platform biometrics & hardware security keys).
 * Browsers cannot expose MAC address — install ID + fingerprint is the stable equivalent.
 */

const FP_KEY = 'stock_device_fp';
const INSTALL_KEY = 'stock_install_id';
const BIO_CRED_KEY = 'stock_bio_credential_id';

function getOrCreateInstallId(): string {
  try {
    let id = localStorage.getItem(INSTALL_KEY);
    if (id && id.length >= 16) return id;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(INSTALL_KEY, id);
    return id;
  } catch {
    return 'no-install-id';
  }
}

async function sha256Hex(input: string): Promise<string> {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  return 'fb' + Math.abs(h).toString(16).padStart(8, '0');
}

function canvasFingerprint(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 50;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px "Arial"';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('AtlasCommerce·fp', 4, 12);
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.arc(120, 25, 18, 0, Math.PI * 2);
    ctx.stroke();
    return c.toDataURL().slice(-96);
  } catch {
    return '';
  }
}

function webglFingerprint(): string {
  try {
    const c = document.createElement('canvas');
    const gl =
      (c.getContext('webgl') as WebGLRenderingContext | null) ||
      (c.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : '';
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    return `${vendor}|${renderer}`;
  } catch {
    return '';
  }
}

export async function getDeviceFingerprint(): Promise<string> {
  const installId = getOrCreateInstallId();
  const parts = [
    installId,
    navigator.userAgent,
    navigator.language,
    (navigator.languages || []).join(','),
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(window.devicePixelRatio || 1),
    String(new Date().getTimezoneOffset()),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(navigator.hardwareConcurrency || 0),
    String((navigator as any).deviceMemory || 0),
    navigator.platform || '',
    String(navigator.maxTouchPoints || 0),
    canvasFingerprint(),
    webglFingerprint(),
  ];
  const hash = await sha256Hex(parts.join('||'));
  return hash.slice(0, 64);
}

export async function getCachedFingerprint(): Promise<string> {
  try {
    const cached = localStorage.getItem(FP_KEY);
    if (cached && cached.length >= 16) return cached;
  } catch { /* private mode */ }
  const fp = await getDeviceFingerprint();
  try {
    localStorage.setItem(FP_KEY, fp);
    sessionStorage.setItem(FP_KEY, fp);
  } catch {
    try { sessionStorage.setItem(FP_KEY, fp); } catch { /* ignore */ }
  }
  return fp;
}


/** Human-readable device name for passkey labels (Windows / macOS / iPhone / Android browser). */
export function getDeviceLabel(): string {
  const ua = navigator.userAgent || '';
  const plat = navigator.platform || '';
  // iPhone / iPad
  if (/iPhone/i.test(ua)) {
    const m = ua.match(/OS (\d+)[._](\d+)/);
    const ver = m ? `${m[1]}.${m[2]}` : '';
    return ver ? `iPhone · iOS ${ver}` : 'iPhone · iOS';
  }
  if (/iPad/i.test(ua)) {
    const m = ua.match(/OS (\d+)[._](\d+)/);
    const ver = m ? `${m[1]}.${m[2]}` : '';
    return ver ? `iPad · iPadOS ${ver}` : 'iPad · iPadOS';
  }
  // Android browser
  if (/Android/i.test(ua)) {
    const v = ua.match(/Android (\d+(?:\.\d+)?)/);
    const model = ua.match(/;\s*([^;)]+)\s*Build\//);
    const name = model ? model[1].trim() : 'Android';
    return v ? `${name} · Android ${v[1]}` : `${name} · Android`;
  }
  // Windows
  if (/Windows NT 10\.0/i.test(ua)) {
    // Win 11 often still reports NT 10.0 — refine via userAgentData if available
    const uaData = (navigator as any).userAgentData;
    const isWin11 = uaData?.platform === 'Windows' && uaData?.getHighEntropyValues;
    return 'PC Windows · Windows 10/11';
  }
  if (/Windows NT 6\.3/i.test(ua)) return 'PC Windows · Windows 8.1';
  if (/Windows NT 6\.1/i.test(ua)) return 'PC Windows · Windows 7';
  if (/Windows/i.test(ua)) return 'PC Windows';
  // macOS
  if (/Mac OS X/i.test(ua) || /Macintosh/i.test(plat)) {
    const m = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/);
    const ver = m ? m[1].replace(/_/g, '.') : '';
    return ver ? `Mac · macOS ${ver}` : 'Mac · macOS';
  }
  // Linux
  if (/Linux/i.test(ua)) return 'PC Linux';
  return plat || 'Navigateur web';
}

export function getDeviceMeta(): Record<string, string> {
  const ua = navigator.userAgent || '';
  return {
    platform: 'web',
    user_agent: ua.slice(0, 240),
    language: navigator.language || '',
    screen: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    label: getDeviceLabel(),
  };
}

/* ─── WebAuthn helpers ─── */

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encode challenge string (base64url) to ArrayBuffer for WebAuthn API */
function challengeToBuffer(challenge: string): ArrayBuffer {
  // Server sends base64url challenge
  try {
    return b64urlToBuf(challenge);
  } catch {
    return new TextEncoder().encode(challenge).buffer;
  }
}

export function isWebAuthnAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    if (typeof (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch { /* ignore */ }
  return true;
}

export async function isSecurityKeyLikelyAvailable(): Promise<boolean> {
  return isWebAuthnAvailable();
}

/**
 * Register platform biometric OR cross-platform security key.
 * deviceType: 'platform' | 'cross-platform'
 */
export async function registerWebAuthn(
  options: any,
  deviceType: 'platform' | 'cross-platform' = 'platform',
): Promise<{ credentialId: string; challenge: string; transports?: string[] }> {
  if (!isWebAuthnAvailable()) throw new Error('WebAuthn non disponible sur cet appareil.');

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: challengeToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: new TextEncoder().encode(String(options.user.id)),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    authenticatorSelection: {
      authenticatorAttachment: deviceType,
      userVerification: options.authenticatorSelection?.userVerification || 'preferred',
      residentKey: options.authenticatorSelection?.residentKey || 'preferred',
    },
    timeout: options.timeout || 120000,
    attestation: 'none',
    excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({
      type: 'public-key' as const,
      id: b64urlToBuf(c.id),
    })),
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Enregistrement annulé.');

  const att = cred.response as AuthenticatorAttestationResponse;
  const transports = (att as any).getTransports?.() as string[] | undefined;

  try {
    // Persist WebAuthn user id (base64url of user.id bytes) for signalAllAcceptedCredentials
    const uidBytes = new TextEncoder().encode(String(options.user?.id || ''));
    let bin = '';
    uidBytes.forEach((b) => { bin += String.fromCharCode(b); });
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('atlas_webauthn_user_id', b64);
  } catch { /* */ }

  return {
    credentialId: bufToB64url(cred.rawId),
    challenge: options.challenge,
    transports,
  };
}

/** Authenticate with any registered credential (biometric or security key) */
export async function authenticateWebAuthn(options: any): Promise<{ credentialId: string; challenge: string }> {
  if (!isWebAuthnAvailable()) throw new Error('WebAuthn non disponible sur cet appareil.');

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: challengeToBuffer(options.challenge),
    timeout: options.timeout || 120000,
    userVerification: options.userVerification || 'preferred',
    rpId: options.rpId,
    allowCredentials: (options.allowCredentials || []).map((c: any) => ({
      type: 'public-key' as const,
      id: b64urlToBuf(c.id),
      transports: c.transports,
    })),
  };

  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Authentification annulée.');

  return {
    credentialId: bufToB64url(assertion.rawId),
    challenge: options.challenge,
  };
}

export function getStoredBiometricCredentialId(): string | null {
  try {
    return localStorage.getItem(BIO_CRED_KEY);
  } catch {
    return null;
  }
}

export function setStoredBiometricCredentialId(id: string | null) {
  try {
    if (id) localStorage.setItem(BIO_CRED_KEY, id);
    else localStorage.removeItem(BIO_CRED_KEY);
  } catch { /* ignore */ }
}


/** base64url id variants for browser signal APIs */
function credIdVariants(raw: string): string[] {
  const id = String(raw || '').trim();
  if (!id) return [];
  const set = new Set<string>([id]);
  set.add(id.replace(/-/g, '+').replace(/_/g, '/'));
  set.add(id.replace(/\+/g, '-').replace(/\//g, '_'));
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot on purpose: variants are ADDED to the set during the loop
  for (const v of [...set]) {
    set.add(v.replace(/=+$/, ''));
    if (v.length % 4) set.add(v + '='.repeat((4 - (v.length % 4)) % 4));
  }
  return [...set];
}

/**
 * Clear local storage + ask the browser/OS to drop the passkey when supported
 * (WebAuthn Level 3 signalUnknownCredential / signalAllAcceptedCredentials).
 * Not all devices honor this — user may still need OS password settings.
 */
export async function removePasskeyLocally(
  credentialId: string | null | undefined,
  remainingAcceptedIds?: string[],
): Promise<{ signaled: boolean; method: string }> {
  const id = credentialId || getStoredBiometricCredentialId();
  if (id && getStoredBiometricCredentialId() === id) {
    setStoredBiometricCredentialId(null);
  } else if (!credentialId) {
    setStoredBiometricCredentialId(null);
  }
  // Always clear local marker for this id
  try {
    if (id && getStoredBiometricCredentialId() === id) setStoredBiometricCredentialId(null);
  } catch { /* */ }

  const PK = typeof window !== 'undefined' ? (window as any).PublicKeyCredential : null;
  if (!PK || !id) return { signaled: false, method: 'local-only' };

  const rpCandidates = Array.from(
    new Set(
      [
        window.location.hostname,
        window.location.hostname.replace(/^www\./, ''),
        // eTLD+1 heuristic: last two labels when possible
        (() => {
          const p = window.location.hostname.split('.');
          return p.length >= 2 ? p.slice(-2).join('.') : window.location.hostname;
        })(),
      ].filter(Boolean),
    ),
  );

  let signaled = false;
  let method = 'none';

  // 1) signalUnknownCredential — mark this credential invalid for the RP
  if (typeof PK.signalUnknownCredential === 'function') {
    for (const rpId of rpCandidates) {
      for (const cred of credIdVariants(id)) {
        try {
          await PK.signalUnknownCredential({ rpId, credentialId: cred });
          signaled = true;
          method = 'signalUnknownCredential';
          break;
        } catch {
          /* try next */
        }
      }
      if (signaled) break;
    }
  }

  // 2) signalAllAcceptedCredentials — remaining keys only (drops removed from autofill)
  if (typeof PK.signalAllAcceptedCredentials === 'function' && Array.isArray(remainingAcceptedIds)) {
    const userId = localStorage.getItem('atlas_webauthn_user_id') || '';
    for (const rpId of rpCandidates) {
      try {
        const payload: any = {
          rpId,
          allAcceptedCredentialIds: remainingAcceptedIds.filter((x) => x && x !== id),
        };
        if (userId) payload.userId = userId;
        await PK.signalAllAcceptedCredentials(payload);
        signaled = true;
        method = method === 'none' ? 'signalAllAcceptedCredentials' : method + '+allAccepted';
        break;
      } catch {
        /* try next rp */
      }
    }
  }

  return { signaled, method };
}
