/** Dedicated native mailbox delivery; never uses the website's shared inbox fallback.
 * A configured sender is an infrastructure adapter, not approval of enrollment.
 * No route instantiates it until an authorization/recovery policy is implemented. */
import { createMailboxEnrollment, type MailboxEnrollmentAdapters } from './desktop-mailbox-enrollment';

type Config = { DESKTOP_NATIVE_MAIL_TRANSPORT?: string; DESKTOP_NATIVE_RESEND_API_KEY?: string; DESKTOP_NATIVE_MAIL_FROM?: string; DESKTOP_NATIVE_MAILBOX_MAC_KEY?: string };
const mailbox = /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
export function createNativeMailTransport(config: Config, fetcher: typeof fetch = fetch): MailboxEnrollmentAdapters['send'] | null {
  const key = config.DESKTOP_NATIVE_RESEND_API_KEY;
  const from = config.DESKTOP_NATIVE_MAIL_FROM;
  if (config.DESKTOP_NATIVE_MAIL_TRANSPORT !== 'resend-v1' || typeof key !== 'string' || !/^re_[A-Za-z0-9_-]{8,200}$/.test(key) ||
      typeof from !== 'string' || from.length > 254 || !mailbox.test(from)) return null;
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
