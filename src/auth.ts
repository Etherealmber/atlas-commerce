import { getCachedFingerprint } from './fingerprint';
import { getApiBase } from './config';

const TOKEN_KEY = 'stock_auth_token';
const SESSION_IP_KEY = 'stock_session_ip';
const ROLE_KEY = 'stock_role';
const USER_KEY = 'stock_auth_user';
const DISPLAY_NAME_KEY = 'stock_display_name';
const AVATAR_URL_KEY = 'stock_avatar_url';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, ip?: string, username?: string, role?: string) {
  localStorage.setItem(TOKEN_KEY, token);
  if (ip) localStorage.setItem(SESSION_IP_KEY, ip);
  if (username) localStorage.setItem(USER_KEY, username);
  if (role) localStorage.setItem(ROLE_KEY, role);
}

export function getUsername(): string {
  return localStorage.getItem(USER_KEY) || 'admin';
}

export function getDisplayName(): string {
  return localStorage.getItem(DISPLAY_NAME_KEY) || getUsername();
}

function sanitizeAvatarUrl(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';

  // Allow safe image data URLs (used by local file upload preview/save flow).
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;

  try {
    const u = new URL(value, window.location.origin);
    const protocol = u.protocol.toLowerCase();
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'blob:') return u.href;
  } catch {
    // invalid URL
  }
  return '';
}

export function getAvatarUrl(): string {
  return sanitizeAvatarUrl(localStorage.getItem(AVATAR_URL_KEY) || '');
}

/** Cache profile fields used in sidebar / phone avatar (local only). */
export function setProfileCache( partial: { display_name?: string | null; avatar_url?: string | null; username?: string | null; role?: string | null } ) {
  if (partial.display_name != null) {
    localStorage.setItem(DISPLAY_NAME_KEY, String(partial.display_name).trim());
  }
  if (partial.avatar_url != null) {
    const a = sanitizeAvatarUrl(String(partial.avatar_url).trim());
    if (a) localStorage.setItem(AVATAR_URL_KEY, a);
    else localStorage.removeItem(AVATAR_URL_KEY);
  }
  if (partial.username) localStorage.setItem(USER_KEY, String(partial.username));
  if (partial.role) localStorage.setItem(ROLE_KEY, String(partial.role));
}

export function getDisplayInitials(): string {
  const name = (getDisplayName() || getUsername() || '').trim();
  if (!name) return 'A';
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  // Single token: use first letter only for long labels (e.g. "Administrateur" → "A" not "AD")
  if (parts[0].length > 3) return parts[0][0].toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_IP_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(DISPLAY_NAME_KEY);
  localStorage.removeItem(AVATAR_URL_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function startSessionGuard(): () => void {
  let stopped = false;

  const check = async () => {
    if (stopped) return;
    const token = getToken();
    if (!token) return;
    try {
      const fp = await Promise.race([
        getCachedFingerprint().catch(() => 'none'),
        new Promise<string>((r) => setTimeout(() => r('none'), 2500)),
      ]);
      const res = await fetch(`${getApiBase()}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Device-Fingerprint': fp || 'none',
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearToken();
        const code = data.code || 'UNAUTHORIZED';
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login?reason=' + encodeURIComponent(code);
        }
      } else {
        const m = data?.data || data || {};
        if (m.username) localStorage.setItem(USER_KEY, String(m.username));
        if (m.role) localStorage.setItem(ROLE_KEY, String(m.role));
        if (m.display_name != null) localStorage.setItem(DISPLAY_NAME_KEY, String(m.display_name));
        if (m.avatar_url != null) {
          const a = String(m.avatar_url).trim();
          if (a) localStorage.setItem(AVATAR_URL_KEY, a);
          else localStorage.removeItem(AVATAR_URL_KEY);
        }
      }
    } catch {
      /* ignore network */
    }
  };

  check();
  const interval = window.setInterval(check, 20_000);
  const onFocus = () => check();
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener('focus', onFocus);
  };
}

export function getRole(): string {
  return localStorage.getItem(ROLE_KEY) || 'user';
}
export function isOwnerRole(): boolean {
  return getRole() === 'owner';
}
/** Floor scan / products list (includes magasinier). */
export function canManageStock(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'admin' || r === 'secretaire' || r === 'stock';
}

/**
 * Ops stock (InventoryOps web): locations, transfers UI, valuation rules.
 * Owner / admin / secrétaire only — not stock or generic user.
 */
export function canAccessInventoryOps(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}

/** Magasinier: scan + produits, pas de caisse ni argent */
export function isStockRole(): boolean {
  return getRole() === 'stock';
}

/** Vente / factures / argent */
export function canSell(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}
export function canOfficeWork(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}
export function canViewReports(): boolean {
  return canOfficeWork();
}
/** Server / users / audit — principal admin (owner) only. Legacy role 'admin' treated as owner for access. */
export function canAccessAdminSettings(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'admin';
}
/** Company / legal / banking / warehouse settings — office roles only */
export function canAccessCompanySettings(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}


/** Any logged-in user may open Settings (profile at minimum). */
export function canAccessSettings(): boolean {
  return !!getRole();
}

/** Company+ tabs in Settings (not profile). */
export function canAccessSettingsBeyondProfile(): boolean {
  return canAccessCompanySettings();
}
