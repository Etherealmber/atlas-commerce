interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional KV for short-lived read cache (dashboard, settings). Reduces D1 free-tier load. */
  CACHE?: KVNamespace;
  /** Free-tier Durable Object for mobile pending counts */
  MOBILE_HUB?: DurableObjectNamespace;
  RESTORE_HUB?: DurableObjectNamespace;
  /** R2 bucket for product/company images — company-stock-images */
  IMAGES?: R2Bucket;
  ANDROID_RELEASE_TOKEN?: string;
  CDN1_PUBLIC_BASE_URL?: string;
  /** Cloudflare Secret — never commit to GitHub */
  ADMIN_PASSWORD: string;
  /** Google Cloud Translation API key (Secret) */
  GOOGLE_TRANSLATE_API_KEY?: string;
  /** Optional. Default: "admin". Owner username for the original administrator. */
  ADMIN_USERNAME?: string;
  /** Optional session signing (Secret). */
  JWT_SECRET?: string;
  RESEND_API_KEY?: string;
  /** Optional AES-GCM key for encrypting mail bodies in R2 (Secret). */
  MAIL_BODY_ENCRYPTION_KEY?: string;
  RESEND_FROM?: string;
  ENVIRONMENT: string;
  EMAIL: { send: (msg: { to: string; from: string; subject: string; html?: string; text?: string }) => Promise<{ messageId?: string }> };
  /** Secrets: OTP_FROM, OTP_TO, CDN_BASE */
  OTP_FROM: string;
  OTP_TO: string;
  /** Public CDN origin for R2 objects (custom domain). Example: https://cdn1.afmarbre.com */
  CDN_BASE?: string;
  /** Default KV cache TTL in seconds (string from plain vars). */
  CACHE_TTL_SECONDS?: string;
  /** Twilio SMS (optional Secrets) */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  /** Generic Moroccan SMS gateway (AdaSMS / EnvoiSMS style) */
  SMS_API_URL?: string;
  SMS_API_KEY?: string;
  SMS_SENDER?: string;
}
