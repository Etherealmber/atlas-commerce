/** Cloudflare Worker bindings — shared type for Hono and helpers. */
export interface Env {
  DB: D1Database;
  /** Optional second D1 (migration target, e.g. atlas-db). Absent in prod until the binding is added. */
  DB_TARGET?: D1Database;
  ASSETS: Fetcher;
  /** Optional KV for short-lived read cache (dashboard, settings). Reduces D1 free-tier load. */
  CACHE?: KVNamespace;
  /** Free-tier Durable Object for mobile pending counts */
  MOBILE_HUB?: DurableObjectNamespace;
  AGENT_QUOTA_HUB?: DurableObjectNamespace;
  RESTORE_HUB?: DurableObjectNamespace;
  /** Atomic document number sequences */
  NUMBER_HUB?: DurableObjectNamespace;
  /** Demo sandboxes (« test / test »): one SQLite Durable Object per fingerprint. */
  DEMO_HUB?: DurableObjectNamespace;
  /** Set to '1' only inside a demo sandbox request. */
  ATLAS_DEMO?: string;
  /** R2 bucket for product/company images — company-stock-images */
  IMAGES?: R2Bucket;
  /** Optional private R2 shadow journal; never bind the public image bucket. */
  JOURNAL_ARCHIVE?: R2Bucket;
  JOURNAL_ARCHIVE_MODE?: string;
  SUPABASE_JOURNAL_URL?: string;
  /** Server-only Supabase secret; never expose to clients. */
  SUPABASE_JOURNAL_SECRET?: string;
  SUPABASE_JOURNAL_SECRET_KEY?: string;
  SUPABASE_JOURNAL_PUBLISHABLE_KEY?: string;
  SUPABASE_JOURNAL_JWKS_URL?: string;
  JOURNAL_BUFFER?: DurableObjectNamespace;
  /** Optional best-effort audit shadow, disabled unless explicitly enabled. */
  JOURNAL_AUDIT_SHADOW?: string;
  JOURNAL_AUDIT_NAMESPACE?: string;
  JOURNAL_AUDIT_TARGET_NAMESPACE?: string;
  /** Dedicated base64-encoded 32-byte secret, never stored in source. */
  JOURNAL_ENCRYPTION_KEY?: string;
  /** Cloudflare Secret — never commit */
  ADMIN_PASSWORD: string;
  /** Google Cloud Translation API key (Secret) */
  GOOGLE_TRANSLATE_API_KEY?: string;
  ADMIN_USERNAME?: string;
  /** Optional session signing secret (Secret). Falls back to ADMIN_PASSWORD-derived key if unset. */
  JWT_SECRET?: string;
  /** Optional report ticket lifetime, in seconds (1–1800). */
  REPORT_TICKET_TTL_SECONDS?: string;
  RESEND_API_KEY?: string;
  /** Crash/user reports from the native Android app → issues (Secret, fine-grained PAT « Issues: write »). */
  GITHUB_ISSUE_TOKEN?: string;
  /** owner/repo for Android reports (default Etherealmber/atlas-commerce-android). */
  GITHUB_ISSUE_REPO?: string;
  /** Crash/user reports from the WEB app → issues — separate PAT (Secret). */
  GITHUB_WEB_ISSUE_TOKEN?: string;
  /** owner/repo for web reports (default Etherealmber/atlas-commerce). */
  GITHUB_WEB_ISSUE_REPO?: string;
  /** Atlas Agent LLM key (Secret). Also used for issue triage unless GROQ_ISSUES_API_KEY is set. */
  GROQ_API_KEY?: string;
  /** Optional, separate provider credential for the public demo only. */
  DEMO_GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  /** Optional dedicated key for issue triage (keeps the Agent quota separate). */
  GROQ_ISSUES_API_KEY?: string;
  /** Issue triage model (default openai/gpt-oss-120b — free tier). */
  GROQ_ISSUES_MODEL?: string;
  /** Max triage calls per UTC day (default 40). */
  GROQ_ISSUES_DAILY_LIMIT?: string;
  /** 'false' disables issue triage. */
  GROQ_ISSUES_ENABLED?: string;
  /** Audit « Expliquer » (Groq free tier): max calls per UTC day (default 60). */
  GROQ_AUDIT_EXPLAIN_DAILY_LIMIT?: string;
  /** Audit « Expliquer » model (default openai/gpt-oss-20b). */
  GROQ_AUDIT_EXPLAIN_MODEL?: string;
  /** Max outbound GitHub/Groq fetches per report-queue drain (default 40, free plan = 50). */
  REPORTS_SUBREQUEST_BUDGET?: string;
  /** Optional AES-GCM key for encrypting mail bodies in R2 (Secret). */
  MAIL_BODY_ENCRYPTION_KEY?: string;
  RESEND_FROM?: string;
  ENVIRONMENT: string;
  EMAIL: {
    send: (msg: {
      to: string;
      from: string;
      subject: string;
      html?: string;
      text?: string;
    }) => Promise<{ messageId?: string }>;
  };
  OTP_FROM: string;
  OTP_TO: string;
  /** Public CDN origin for R2 objects. Example: https://cdn1.afmarbre.com */
  CDN_BASE?: string;
  /** CI secret (wrangler secret put ANDROID_RELEASE_TOKEN): Bearer token for POST /api/admin/android-release. */
  ANDROID_RELEASE_TOKEN?: string;
  /** Override of the public Android APK base on CDN1. */
  CDN1_PUBLIC_BASE_URL?: string;
  /** CI secret (wrangler secret put DESKTOP_RELEASE_TOKEN): Bearer token for POST /api/admin/desktop-release. */
  DESKTOP_RELEASE_TOKEN?: string;
  /** Override of the public Desktop updates base on CDN1. */
  DESKTOP_CDN1_PUBLIC_BASE_URL?: string;
  CACHE_TTL_SECONDS?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  SMS_API_URL?: string;
  SMS_API_KEY?: string;
  SMS_SENDER?: string;
  /** Opt in to desktop v2 discovery; phone approval also needs its own explicit flag. */
  DESKTOP_NATIVE_V2_DISCOVERY?: string;
  /** Require compiled Rust WASM finance core at runtime (fail closed if absent or invalid). */
  FINANCE_REQUIRE_WASM?: string;
  /** Optional explicit fallback mode ('ts-fallback') for non-WASM dev/test environments. */
  FINANCE_ENGINE_MODE?: string;
  /** Enable v2 phone approval in addition to discovery; use only after client/staging validation. */
  DESKTOP_NATIVE_V2_PHONE_APPROVAL?: string;
  /** Desktop v3 production auth gates — keep disabled until full protocol & clients are ready. */
  DESKTOP_NATIVE_V3_ENABLED?: string;
  DESKTOP_NATIVE_V3_PROD_APPROVED?: string;
  /** 'true' = allow browser-free native presentation (password+OTP, QR, passkey) on desktop v3. */
  DESKTOP_NATIVE_V3_NATIVE_LOGIN?: string;
  /** Comma-separated TEAMID.bundle.id list for /.well-known/apple-app-site-association webcredentials. */
  APPLE_WEBCREDENTIALS_APP_IDS?: string;
  DESKTOP_NATIVE_V3_OTP_KEY?: string;
  DESKTOP_NATIVE_MAIL_TRANSPORT?: string;
  DESKTOP_NATIVE_RESEND_API_KEY?: string;
  DESKTOP_NATIVE_MAIL_FROM?: string;
  DESKTOP_NATIVE_MAILBOX_MAC_KEY?: string;
  /** Staging-only challenge; native password additionally requires its own pilot flag and configuration. */
  DESKTOP_NATIVE_V2_PILOT_CHALLENGE?: string;
  DESKTOP_NATIVE_V2_PILOT_LOGIN?: string;
  DESKTOP_NATIVE_V2_PILOT_ORIGIN?: string;
  DESKTOP_NATIVE_V2_PILOT_USERNAME?: string;
  DESKTOP_NATIVE_V2_PILOT_OTP_TO?: string;
  DESKTOP_NATIVE_V2_PILOT_OTP_FROM?: string;
  DESKTOP_NATIVE_V2_PILOT_OTP_KEY?: string;
  /** Cloudflare Turnstile (optional). If unset, login skips captcha check. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Optional Moroccan DGI e-invoicing clearance credentials (when unset, StubDgiAdapter is used). */
  DGI_BASE_URL?: string;
  DGI_CLIENT_ID?: string;
  DGI_CLIENT_SECRET?: string;
}

