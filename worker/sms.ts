/**
 * SMS / messaging helpers for Morocco.
 *
 * Supported backends (optional secrets):
 *   - TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM  → Twilio SMS
 *   - SMS_API_URL + SMS_API_KEY                            → generic REST (AdaSMS / EnvoiSMS style)
 *
 * WhatsApp deep-link (no API key) is always available for manual share.
 * Full WhatsApp Business API requires a BSP (360Dialog, Infobip, Orange Smart Message…).
 */

export type SmsResult = {
  sent: boolean;
  provider?: string;
  error?: string;
  whatsapp_url?: string;
};

function normalizeMaPhone(raw: string): string | null {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  d = d.replace(/^\+/, '');
  if (d.startsWith('0') && d.length === 10) d = '212' + d.slice(1);
  if (d.startsWith('212') && d.length >= 12) return d;
  if (d.length >= 9 && d.length <= 15) return d;
  return null;
}

export function whatsappDeepLink(phone: string, message: string): string | undefined {
  const digits = normalizeMaPhone(phone);
  if (!digits) return undefined;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

type EnvLike = {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  SMS_API_URL?: string;
  SMS_API_KEY?: string;
  SMS_SENDER?: string;
};

/** Send transactional SMS. Returns without throwing. */
export async function sendSms(
  env: EnvLike,
  to: string,
  body: string,
): Promise<SmsResult> {
  const digits = normalizeMaPhone(to);
  if (!digits) return { sent: false, error: 'Numero invalide' };

  // 1) Twilio
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const form = new URLSearchParams({
        To: `+${digits}`,
        From: env.TWILIO_FROM,
        Body: body.slice(0, 600),
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      if (res.ok) return { sent: true, provider: 'twilio' };
      const err = await res.text();
      return { sent: false, provider: 'twilio', error: err.slice(0, 200) };
    } catch (e: any) {
      return { sent: false, provider: 'twilio', error: String(e?.message || e) };
    }
  }

  // 2) Generic Moroccan SMS gateway (AdaSMS / EnvoiSMS style)
  if (env.SMS_API_URL && env.SMS_API_KEY) {
    try {
      const res = await fetch(env.SMS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SMS_API_KEY}`,
          'X-Api-Key': env.SMS_API_KEY,
        },
        body: JSON.stringify({
          to: `+${digits}`,
          message: body.slice(0, 600),
          sender: env.SMS_SENDER || 'INFO',
        }),
      });
      if (res.ok) return { sent: true, provider: 'sms_gateway' };
      const err = await res.text();
      return { sent: false, provider: 'sms_gateway', error: err.slice(0, 200) };
    } catch (e: any) {
      return { sent: false, provider: 'sms_gateway', error: String(e?.message || e) };
    }
  }

  return {
    sent: false,
    error: 'SMS non configure (TWILIO_* ou SMS_API_URL + SMS_API_KEY)',
  };
}

/** Compose short SMS for document link (keep under ~160 chars when possible). */
export function documentSmsBody(opts: {
  company: string;
  docLabel: string;
  number: string;
  link: string;
}): string {
  const co = (opts.company || 'Societe').slice(0, 28);
  return `${co}: votre ${opts.docLabel} ${opts.number} — ${opts.link}`;
}
