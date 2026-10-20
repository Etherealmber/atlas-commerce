import { getToken } from '../auth';
import { uiToast } from '../components/AppDialogs';
import { getApiBase } from '../config';

function qsFromParams(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? s : '';
}

/**
 * Open printable HTML report in a real navigable URL (with short-lived rt ticket)
 * so the browser Refresh button keeps working.
 * JWT is never put in the URL — only a 30‑minute HMAC report ticket.
 */
export function openReport(
  path: string,
  params?: Record<string, string | undefined>,
) {
  const token = getToken() || '';
  if (!token) {
    uiToast('Session expirée. Veuillez vous reconnecter.', 'error');
    return;
  }

  // Open synchronously on the user gesture (avoids popup blockers)
  const tab = window.open('about:blank', '_blank');
  if (!tab) {
    uiToast(
      'Le navigateur a bloqué la nouvelle fenêtre. Autorisez les pop-ups pour ce site, puis réessayez.',
      'error',
    );
    return;
  }
  try {
    tab.opener = null;
  } catch {
    /* ignore */
  }
  try {
    tab.document.write(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Chargement…</title>
      <style>body{font-family:system-ui,sans-serif;padding:48px;color:#334;background:#fafafa}
      .s{width:28px;height:28px;border:3px solid #ccc;border-top-color:#71717a;border-radius:50%;animation:r .7s linear infinite;margin:0 auto 16px}
      @keyframes r{to{transform:rotate(360deg)}} p{text-align:center}</style></head>
      <body><div class="s"></div><p>Ouverture du rapport…</p></body></html>`,
    );
    tab.document.close();
  } catch {
    /* */
  }

  void (async () => {
    try {
      const { getCachedFingerprint } = await import('../fingerprint');
      const fp = await getCachedFingerprint();
      const base = getApiBase();

      // Mint short-lived report ticket (not the session JWT)
      let rt = '';
      try {
        const tr = await fetch(`${base}/api/reports/link-ticket`, {
          credentials: 'same-origin',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Device-Fingerprint': fp || '',
            Accept: 'application/json',
          },
        });
        const tj = await tr.json().catch(() => null);
        if (tr.ok && tj?.data?.rt) rt = String(tj.data.rt);
      } catch {
        /* fall through — still try header-based fetch */
      }

      const fullPath = path.startsWith('http') ? path : `${base}${path}`;
      const q = new URLSearchParams();
      if (rt) q.set('rt', rt);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v != null && v !== '') q.set(k, v);
        }
      }
      const qs = q.toString();
      const navUrl = qs ? `${fullPath}?${qs}` : fullPath;

      if (rt) {
        // Real URL → refresh / share within 30 min works
        tab.location.href = navUrl;
        return;
      }

      // Fallback: fetch with Authorization and write HTML (refresh won't work on about:blank)
      const res = await fetch(navUrl, {
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Device-Fingerprint': fp || '',
          Accept: 'text/html, application/xhtml+xml',
        },
      });
      const html = await res.text();
      if (!res.ok) {
        let msg = `Impossible d’ouvrir le rapport (${res.status})`;
        try {
          const j = JSON.parse(html);
          if (j?.error) msg = String(j.error);
        } catch {
          /* */
        }
        throw new Error(msg);
      }
      if (!html || html.length < 40) throw new Error('Rapport vide');
      try {
        tab.document.open();
        tab.document.write(html);
        tab.document.close();
      } catch {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const u = URL.createObjectURL(blob);
        tab.location.href = u;
        setTimeout(() => URL.revokeObjectURL(u), 120_000);
      }
    } catch (e: any) {
      const msg = e?.message || 'Impossible d’ouvrir le rapport';
      try {
        tab.document.open();
        tab.document.write(
          `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Erreur</title></head>
          <body style="font-family:system-ui;padding:40px;max-width:480px;margin:auto">
          <h1 style="font-size:1.2rem">Rapport indisponible</h1>
          <p>${String(msg).replace(/</g, '&lt;')}</p>
          </body></html>`,
        );
        tab.document.close();
      } catch {
        try {
          tab.close();
        } catch {
          /* */
        }
      }
      uiToast(msg, 'error');
    }
  })();
}

export function openPrintDoc(path: string, params?: Record<string, string | undefined>) {
  openReport(path, params);
}
