/** Dedicated native mailbox delivery; never uses the website's shared inbox fallback.
 * A configured sender is an infrastructure adapter, not approval of enrollment.
 * No route instantiates it until an authorization/recovery policy is implemented. */
import { createMailboxEnrollment, type MailboxEnrollmentAdapters } from './desktop-mailbox-enrollment';

type Config = { DESKTOP_NATIVE_MAIL_TRANSPORT?: string; DESKTOP_NATIVE_RESEND_API_KEY?: string; DESKTOP_NATIVE_MAIL_FROM?: string; DESKTOP_NATIVE_MAILBOX_MAC_KEY?: string };
const mailbox = /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;

function validateNativeMailConfig(config: Config): { key: string; from: string } | null {
  const key = config.DESKTOP_NATIVE_RESEND_API_KEY;
  const from = config.DESKTOP_NATIVE_MAIL_FROM;
  if (
    config.DESKTOP_NATIVE_MAIL_TRANSPORT !== 'resend-v1' ||
    typeof key !== 'string' ||
    !/^re_[A-Za-z0-9_-]{8,200}$/.test(key) ||
    typeof from !== 'string' ||
    from.length > 254 ||
    !mailbox.test(from)
  ) {
    return null;
  }
  return { key, from };
}

export function createNativeMailTransport(config: Config, fetcher: typeof fetch = fetch): MailboxEnrollmentAdapters['send'] | null {
  const validated = validateNativeMailConfig(config);
  if (!validated) return null;
  const { key, from } = validated;
  return async (message, signal) => {
    if (signal.aborted || !mailbox.test(message.to) || message.to.length > 254 || !/^\d{6}$/.test(message.code) ||
        !['new_mailbox', 'old_mailbox_change'].includes(message.purpose)) return false;
    const text = message.purpose === 'old_mailbox_change'
      ? `A request was made to change your desktop authentication mailbox. If this was you, your confirmation code is ${message.code}. If not, do not share it and contact your administrator. The code expires in 10 minutes.`
      : `Your desktop authentication mailbox verification code is ${message.code}. Do not share this code. It expires in 10 minutes.`;
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [message.to], subject: 'Desktop authentication verification', text }),
      });
      // Acceptance is not delivery or proof of ownership. Never expose provider body.
      return response.ok;
    } catch { return false; }
  };
}

/** Explicit policy injection is required; configuration alone cannot expose enrollment. */
export function createConfiguredNativeMailbox(db: D1Database, config: Config, authorize?: MailboxEnrollmentAdapters['authorize'], fetcher?: typeof fetch) {
  const send = createNativeMailTransport(config, fetcher);
  if (!send || !authorize) return null;
  return createMailboxEnrollment(db, config.DESKTOP_NATIVE_MAILBOX_MAC_KEY || '', { authorize, send });
}

/** Dedicated per-account login OTP sender; uses only the verified mailbox address. */
export function createNativeOtpSender(config: Config, fetcher: typeof fetch = fetch): ((to: string, otp: string) => Promise<boolean>) | null {
  const validated = validateNativeMailConfig(config);
  if (!validated) return null;
  const { key, from } = validated;
  return async (to, otp) => {
    if (!mailbox.test(to) || to.length > 254 || !/^\d{6}$/.test(otp)) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}.logo-dark{display:none!important}.logo-light{display:block!important}@media (prefers-color-scheme:dark){body,.wrap{background:#09090b!important;color:#fafafa!important}.card{background:#18181b!important;border-color:#27272a!important}.otp{color:#fafafa!important}.muted{color:#a1a1aa!important}.logo-pill{background:#18181b!important;background-image:none!important;border-color:#27272a!important}.logo-light{display:none!important}.logo-dark{display:block!important}}</style></head><body style="margin:0;padding:0;background:#f4f4f5;color:#09090b;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Votre code Atlas Desktop : ${otp}</div><div class="wrap" style="padding:28px 16px;text-align:center"><div class="logo-pill" style="display:inline-block;padding:10px 18px;border-radius:14px;background:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border:1px solid #e4e4e7"><img src="https://stock.afmarbre.com/atlas-logo-light.png" alt="Atlas" class="logo-light" height="34" style="display:block;height:34px;width:auto" /><img src="https://stock.afmarbre.com/atlas-logo-dark.png" alt="Atlas" class="logo-dark" height="34" style="display:none;height:34px;width:auto" /></div><div class="card" style="max-width:460px;margin:22px auto 0;background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:24px 16px"><div class="muted" style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#52525b">Atlas Desktop</div><p class="muted" style="margin:12px 0 16px;font-size:14px;color:#52525b">Votre code de vérification est :</p><code class="otp" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:36px;font-weight:800;letter-spacing:6px;font-variant-numeric:tabular-nums;color:#09090b">${otp}</code><p class="muted" style="margin:16px 0 0;font-size:12px;color:#71717a">Valable pendant 5 minutes. Ne le partagez jamais.</p></div></div></body></html>`;
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `${otp} — Atlas Desktop — code de connexion`,
          html,
          text: `Code de vérification Atlas Desktop : ${otp}\n\nValable pendant 5 minutes. Ne le partagez jamais.`,
        }),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
