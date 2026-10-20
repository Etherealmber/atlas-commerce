import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '../../auth';
import { getApiBase } from '../../config';

/**
 * Mise à jour application Android — gestion du manifeste `latest.json` et du
 * binaire `latest.apk` stockés sur Cloudflare R2 (bucket `company-stock-images`,
 * préfixe `app-updates/android/`), servis par le domaine CDN `cdn1.afmarbre.com`.
 *
 * Worker : GET/PUT /api/admin/app-update · POST /api/admin/app-update/apk
 * (owner/admin uniquement — voir gateAppUpdateAdmin côté worker).
 */

type Manifest = {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  mandatory: boolean;
  notes: string;
};

type RemoteState = {
  manifest: Manifest;
  source: 'r2' | 'db' | null;
  json: { key: string; url: string; size: number | null; uploaded: string | null };
  apk: { key: string; url: string; size: number | null; uploaded: string | null };
  maxApkBytes: number;
};

const fmtBytes = (n: number | null | undefined): string => {
  if (n == null) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(2)} Mo`;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function AppUpdatePanel() {
  const [state, setState] = useState<RemoteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<Manifest>({ versionCode: 0, versionName: '', apkUrl: '', mandatory: false, notes: '' });
  const [savingJson, setSavingJson] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const flash = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg(text);
    setMsgType(type);
    window.setTimeout(() => setMsg((m) => (m === text ? '' : m)), 5000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/admin/app-update`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
      const d = data.data as RemoteState;
      setState(d);
      setForm({
        versionCode: Number(d.manifest?.versionCode || 0),
        versionName: String(d.manifest?.versionName || ''),
        apkUrl: String(d.manifest?.apkUrl || ''),
        mandatory: !!d.manifest?.mandatory,
        notes: String(d.manifest?.notes || ''),
      });
    } catch (e: any) {
      setLoadError(e?.message || 'Impossible de charger l’état R2');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    if (!state) return false;
    const m = state.manifest;
    return (
      Number(form.versionCode || 0) !== Number(m.versionCode || 0) ||
      form.versionName !== String(m.versionName || '') ||
      form.apkUrl !== String(m.apkUrl || '') ||
      form.mandatory !== !!m.mandatory ||
      form.notes !== String(m.notes || '')
    );
  }, [form, state]);

  const jsonPreview = useMemo(
    () =>
      JSON.stringify(
        {
          versionCode: Number(form.versionCode || 0),
          versionName: form.versionName,
          apkUrl: form.apkUrl || (state ? state.apk.url : ''),
          mandatory: !!form.mandatory,
          notes: form.notes,
        },
        null,
        2,
      ),
    [form, state],
  );

  const saveJson = async () => {
    if (!Number.isFinite(Number(form.versionCode)) || Number(form.versionCode) < 1) {
      flash('versionCode invalide (entier ≥ 1)', 'error');
      return;
    }
    if (!form.versionName.trim()) {
      flash('versionName obligatoire', 'error');
      return;
    }
    setSavingJson(true);
    try {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/admin/app-update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          versionCode: Math.floor(Number(form.versionCode)),
          versionName: form.versionName.trim(),
          apkUrl: form.apkUrl.trim(),
          mandatory: !!form.mandatory,
          notes: form.notes,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
      flash('latest.json enregistré sur R2 ✓');
      await load();
    } catch (e: any) {
      flash(e?.message || 'Échec enregistrement latest.json', 'error');
    } finally {
      setSavingJson(false);
    }
  };

  const uploadApk = (file: File) => {
    if (!state) return;
    if (file.size > state.maxApkBytes) {
      flash(`APK trop lourd (${fmtBytes(file.size)} — max ${fmtBytes(state.maxApkBytes)})`, 'error');
      return;
    }
    setUploading(true);
    setUploadPct(0);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `${getApiBase()}/api/admin/app-update/apk`);
    xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setUploadPct(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      xhrRef.current = null;
      let data: any = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.success) {
        flash(`latest.apk uploadé (${fmtBytes(file.size)}) ✓`);
        void load();
      } else {
        flash(data?.error || `Échec upload APK (${xhr.status})`, 'error');
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      xhrRef.current = null;
      flash('Échec upload APK (réseau)', 'error');
    };
    xhr.send(file);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash('URL copiée ✓');
    } catch {
      flash('Copie impossible', 'error');
    }
  };

  if (loading && !state) {
    return <div className="card" style={{ padding: 16, color: 'var(--muted)' }}>Chargement de l’état R2…</div>;
  }
  if (loadError && !state) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <p style={{ color: 'var(--ac-danger)', marginTop: 0 }}>{loadError}</p>
        <button type="button" className="secondary" onClick={() => void load()}>Réessayer</button>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Mise à jour application Android</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Le manifeste <code>latest.json</code> et le binaire <code>latest.apk</code> vivent sur Cloudflare R2
          (<code>app-updates/android/</code>) et sont servis par le CDN. L&apos;APK installée vérifie{' '}
          <code>GET /api/app/android-update?versionCode=…</code> au démarrage.
        </p>
        {state && (
          <div
            style={{
              marginTop: 12,
              border: '1px solid var(--line)',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {[
              ['Source manifeste', state.source === 'r2' ? 'R2 ✓' : state.source === 'db' ? 'D1 (fallback)' : 'aucun'],
              [`latest.json · ${fmtBytes(state.json.size)}`, fmtDate(state.json.uploaded)],
              [`latest.apk · ${fmtBytes(state.apk.size)}`, fmtDate(state.apk.uploaded)],
            ].map(([k, v], i) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 12px',
                  fontSize: 13,
                  borderBottom: i < 2 ? '1px solid var(--line)' : 'none',
                }}
              >
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
        {state && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button type="button" className="secondary" onClick={() => void copy(state.json.url)}>Copier URL latest.json</button>
            <button type="button" className="secondary" onClick={() => void copy(state.apk.url)}>Copier URL latest.apk</button>
            <a href={state.json.url} target="_blank" rel="noreferrer" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--muted, #64748b)' }}>Ouvrir latest.json</a>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Éditer latest.json</h2>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="form-row">
            <label>versionCode</label>
            <input
              type="number"
              min={1}
              step={1}
              value={form.versionCode}
              onChange={(e) => setForm((f) => ({ ...f, versionCode: Number(e.target.value) }))}
            />
          </div>
          <div className="form-row">
            <label>versionName</label>
            <input
              value={form.versionName}
              onChange={(e) => setForm((f) => ({ ...f, versionName: e.target.value }))}
              placeholder="1.0.3"
            />
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label>apkUrl (lien de téléchargement)</label>
          <input
            value={form.apkUrl}
            onChange={(e) => setForm((f) => ({ ...f, apkUrl: e.target.value }))}
            placeholder={state ? state.apk.url : 'https://cdn1.afmarbre.com/app-updates/android/latest.apk'}
          />
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.mandatory}
              onChange={(e) => setForm((f) => ({ ...f, mandatory: e.target.checked }))}
              style={{ width: 'auto' }}
            />
            Mise à jour obligatoire (mandatory)
          </label>
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label>notes (affichées dans l’app)</label>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Thème sombre, menu compte, corrections scan et profil"
            style={{ width: '100%' }}
          />
        </div>
        <pre
          style={{
            background: 'var(--ac-nav-hover, #f1f5f9)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 12,
            fontSize: 12,
            overflowX: 'auto',
            lineHeight: 1.5,
          }}
        >
          {jsonPreview}
        </pre>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void saveJson()} disabled={savingJson}>
            {savingJson ? 'Enregistrement…' : 'Enregistrer latest.json'}
          </button>
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
            Recharger
          </button>
          {dirty && <span style={{ fontSize: 12, color: 'var(--ac-warn, #d97706)' }}>Modifications non enregistrées</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Uploader latest.apk</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Envoie le binaire vers R2 (<code>app-updates/android/latest.apk</code>), servi par le CDN.
          Pensez à incrémenter <code>versionCode</code> dans latest.json ensuite.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".apk,application/vnd.android.package-archive,application/octet-stream"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadApk(f);
            e.target.value = '';
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? `Envoi… ${uploadPct}%` : 'Choisir un fichier .apk'}
          </button>
          {uploading && (
            <button
              type="button"
              className="secondary"
              onClick={() => { xhrRef.current?.abort(); setUploading(false); }}
            >
              Annuler
            </button>
          )}
        </div>
        {uploading && (
          <div style={{ marginTop: 10, height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${uploadPct}%`, height: '100%', background: 'var(--ac-primary, #0a0a0a)', transition: 'width .2s ease' }} />
          </div>
        )}
      </div>

      {msg && (
        <p
          role="status"
          style={{
            marginTop: 12,
            fontSize: 13,
            fontWeight: 600,
            color: msgType === 'success' ? 'var(--ac-ok, #16a34a)' : 'var(--ac-danger, #dc2626)',
          }}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
