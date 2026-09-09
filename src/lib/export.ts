import { getToken } from '../auth';
import { getCachedFingerprint } from '../fingerprint';
import { BASE } from '../api';
import { uiToast } from '../components/AppDialogs';

/** Download a CSV export (Excel-friendly: UTF-8 BOM + ; separator from API). */
export async function downloadExport(path: string, filename: string) {
  const token = getToken();
  if (!token) {
    uiToast('Session expirée. Reconnectez-vous.', 'error');
    return;
  }
  const fp = await getCachedFingerprint();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Device-Fingerprint': fp,
        Accept: 'text/csv, application/json',
      },
    });
  } catch {
    uiToast('Réseau indisponible. Réessayez.', 'error');
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    uiToast((err as any).error || `Export impossible (${res.status})`, 'error');
    return;
  }
  // Prefer server filename (with date) when present
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^";]+)"?/i);
  const finalName = (m?.[1] || filename || 'export.csv').trim();

  const blob = await res.blob();
  if (!blob || blob.size < 3) {
    uiToast('Export vide — aucun produit à exporter.', 'error');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  uiToast(`Fichier téléchargé : ${finalName}`, 'success');
}
