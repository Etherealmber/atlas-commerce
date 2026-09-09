import { getToken } from '../auth';
import { uiToast } from '../components/AppDialogs';
import { getApiBase } from '../config';
import { isDemoMode, openDemoReport, openDemoInvoicePrint } from './demoMode';

/**
 * Encode session token for query string (safe for + / = in base64).
 */
function tokenForQuery(token: string): string {
  try {
    const urlSafe = token.replace(/\+/g, '-').replace(/\//g, '_');
    return encodeURIComponent(urlSafe);
  } catch {
    return encodeURIComponent(token);
  }
}

function buildAuthedUrl(path: string, params?: Record<string, string | undefined>): string | null {
  const token = getToken() || '';
  if (!token) {
    uiToast('Session expirée. Veuillez vous reconnecter.', 'error');
    return null;
  }
  const parts: string[] = [`token=${tokenForQuery(token)}`];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
  }
  const base = getApiBase();
  const fullPath = path.startsWith('http') ? path : `${base}${path}`;
  return `${fullPath}?${parts.join('&')}`;
}

function openInNewTab(url: string): boolean {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) {
    uiToast(
      'Le navigateur a bloqué la nouvelle fenêtre. Autorisez les pop-ups pour ce site, puis réessayez.',
      'error'
    );
    return false;
  }
  try {
    w.opener = null;
  } catch {
    /* ignore */
  }
  return true;
}

export function openReport(
  path: string,
  params?: Record<string, string | undefined>,
) {
  if (isDemoMode()) {
    openDemoReport(path);
    return;
  }
  const url = buildAuthedUrl(path, params);
  if (!url) return;
  openInNewTab(url);
}

export function openPrintDoc(path: string, params?: Record<string, string | undefined>) {
  if (isDemoMode()) {
    // Invoice/quote print paths → demo HTML; reports → demo report
    const m = path.match(/\/invoices\/(\d+)\//);
    if (m) {
      openDemoInvoicePrint(Number(m[1]));
      return;
    }
    openDemoReport(path);
    return;
  }
  const url = buildAuthedUrl(path, params);
  if (!url) return;
  openInNewTab(url);
}
