/** GDPR cookie / local-storage consent (Atlas Commerce). */

export const CONSENT_VERSION = 1;
const STORAGE_KEY = 'atlas_cookie_consent_v1';

export type ConsentCategories = {
  /** Always true — auth session, security, load balancing. */
  necessary: true;
  /** Theme, density, onboarding flags stored locally. */
  preferences: boolean;
  /** Reserved — no third-party analytics today. */
  analytics: boolean;
};

export type ConsentRecord = {
  version: number;
  necessary: true;
  preferences: boolean;
  analytics: boolean;
  decidedAt: string; // ISO
  method: 'accept_all' | 'necessary_only' | 'custom';
};

export function getConsent(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (!parsed || parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasDecidedConsent(): boolean {
  return getConsent() != null;
}

export function saveConsent(
  partial: Pick<ConsentCategories, 'preferences' | 'analytics'>,
  method: ConsentRecord['method'],
): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    necessary: true,
    preferences: !!partial.preferences,
    analytics: !!partial.analytics,
    decidedAt: new Date().toISOString(),
    method,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* private mode */
  }
  try {
    window.dispatchEvent(new CustomEvent('atlas-consent-updated', { detail: record }));
  } catch {
    /* */
  }
  return record;
}

export function acceptAll(): ConsentRecord {
  return saveConsent({ preferences: true, analytics: true }, 'accept_all');
}

export function acceptNecessaryOnly(): ConsentRecord {
  return saveConsent({ preferences: false, analytics: false }, 'necessary_only');
}

/** Prefer preferences category for UI chrome (theme/density). If undecided, allow (first paint). */
export function canUsePreferences(): boolean {
  const c = getConsent();
  if (!c) return true;
  return c.preferences;
}

export function canUseAnalytics(): boolean {
  const c = getConsent();
  return !!(c && c.analytics);
}

export function openConsentSettings() {
  try {
    window.dispatchEvent(new CustomEvent('atlas-consent-open'));
  } catch {
    /* */
  }
}
