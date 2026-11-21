import { parsePhoneApproval } from '../lib/desktopPhoneApproval';

/** Only desktop v2 approval references on this exact HTTPS origin are accepted. */
export function deviceApprovalPath(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/login/desktop-phone') return null;
    const context = parsePhoneApproval(url.hash, origin, url.search);
    return context ? `/login/desktop-phone#request_id=${context.request_id}` : null;
  } catch { return null; }
}
