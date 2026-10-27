/**
 * v0.7 — stable server error messages in the three app languages.
 *
 * The Android app (and the web SPA) surface `error` strings to users. Until
 * now every stable message was French-only. Messages are picked from an
 * allowlist keyed by Accept-Language (OkHttp sends the device/app locale);
 * machine-readable `code` values are unchanged so existing clients keep
 * working. Unknown/absent header → French (historical default).
 */
export type UiLang = 'fr' | 'en' | 'ar';

const MESSAGES = {
  auth_required: {
    fr: 'Authentification requise.',
    en: 'Authentication required.',
    ar: 'المصادقة مطلوبة.',
  },
  message_empty: {
    fr: 'Message vide.',
    en: 'Empty message.',
    ar: 'الرسالة فارغة.',
  },
  agent_no_key: {
    fr: 'Assistant IA non configuré. Secret GROQ_API_KEY manquant.',
    en: 'AI assistant not configured. Missing GROQ_API_KEY secret.',
    ar: 'مساعد الذكاء الاصطناعي غير مهيأ. مفتاح GROQ_API_KEY مفقود.',
  },
  agent_upstream: {
    fr: 'Échec Atlas Agent',
    en: 'Atlas Agent request failed',
    ar: 'فشل طلب مساعد Atlas',
  },
  update_required: {
    fr: "Cette version de l'application Android n'est plus supportée. Mettez à jour pour continuer.",
    en: 'This Android app version is no longer supported. Please update to continue.',
    ar: 'هذا الإصدار من تطبيق Android لم يعد مدعومًا. يرجى التحديث للمتابعة.',
  },
  token_required: {
    fr: 'token requis',
    en: 'token required',
    ar: 'الرمز مطلوب',
  },
  token_store_error: {
    fr: 'Enregistrement du token impossible pour le moment.',
    en: 'Unable to register the token right now.',
    ar: 'تعذر تسجيل الرمز حاليًا.',
  },
} as const;

export type UiMessageKey = keyof typeof MESSAGES;

/**
 * Allowlist parse of Accept-Language, honoring q-values
 * ("ar-SA,ar;q=0.9,en;q=0.8" → ar). Anything outside fr/en/ar → 'fr'.
 */
export function pickUiLang(acceptLanguage?: string | null): UiLang {
  const raw = String(acceptLanguage || '');
  const scored: { tag: string; q: number }[] = [];
  for (const part of raw.split(',')) {
    const [tagPart, ...params] = part.split(';');
    const tag = String(tagPart || '').trim().toLowerCase().split('-')[0];
    if (!tag) continue;
    let q = 1;
    for (const prm of params) {
      const m = String(prm || '').trim().match(/^q=([0-9.]+)$/i);
      if (m) q = Number(m[1]);
    }
    if (Number.isFinite(q)) scored.push({ tag, q });
  }
  scored.sort((a, b) => b.q - a.q);
  for (const { tag } of scored) {
    if (tag === 'ar') return 'ar';
    if (tag === 'en') return 'en';
    if (tag === 'fr') return 'fr';
  }
  return 'fr';
}

/** Localized stable message. Never interpolates caller input. */
export function tr(lang: UiLang, key: UiMessageKey): string {
  return MESSAGES[key][lang];
}
