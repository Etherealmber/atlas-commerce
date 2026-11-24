import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '../../auth';
import { getApiBase } from '../../config';

type DesktopManifest = {
  platform: 'windows';
  arch: string;
  channel: 'stable' | 'prerelease';
  version: string;
  mandatory: boolean;
  minimum_version: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
  latestUrl: string;
  cdn1Url: string;
  checksumsUrl: string | null;
  githubUrl: string | null;
  notes: string;
  publishedAt: string;
  filename?: string;
};

type DesktopRemoteState = {
  manifest: DesktopManifest;
  source: 'r2' | 'db' | null;
  json: { key: string; url: string; size: number | null; uploaded: string | null };
  installer: { key: string; url: string; size: number | null; uploaded: string | null };
  files: Array<{ key: string; size: number; uploaded: string | null }>;
  maxBytes: number;
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

export default function DesktopUpdateSection() {
  const [state, setState] = useState<DesktopRemoteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState<'stable' | 'prerelease'>('stable');
  const [minVersion, setMinVersion] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
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
      const res = await fetch(`${getApiBase()}/api/admin/desktop-update`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
      const d = data.data as DesktopRemoteState;
      setState(d);
      setVersion(String(d.manifest?.version || ''));
      setChannel(d.manifest?.channel === 'prerelease' ? 'prerelease' : 'stable');
      setMinVersion(String(d.manifest?.minimum_version || ''));
      setDownloadUrl(String(d.manifest?.downloadUrl || ''));
      setSha256(String(d.manifest?.sha256 || ''));
      setMandatory(!!d.manifest?.mandatory);
      setNotes(String(d.manifest?.notes || ''));
    } catch (e: any) {
      setLoadError(e?.message || 'Impossible de charger l’état Desktop R2');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const jsonPreview = useMemo(
    () =>
      JSON.stringify(
        {
          platform: 'windows',
          arch: 'universal-x86_64',
          channel,
          version: version.trim(),
          mandatory,
          minimum_version: minVersion.trim() || null,
          sha256: sha256.trim() || null,
          downloadUrl: downloadUrl.trim() || (state ? state.installer.url : ''),
          notes,
        },
        null,
        2,
      ),
    [channel, version, mandatory, minVersion, sha256, downloadUrl, notes, state],
  );

  const saveJson = async () => {
    if (!version.trim()) {
      flash('Version semver obligatoire (ex. 0.9.3)', 'error');
      return;
    }
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/admin/desktop-update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          version: version.trim(),
          channel,
          minimum_version: minVersion.trim() || null,
          downloadUrl: downloadUrl.trim(),
          sha256: sha256.trim() || null,
          mandatory,
          notes,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
      flash('app-updates/desktop/latest.json enregistré sur R2 ✓');
      await load();
    } catch (e: any) {
      flash(e?.message || 'Échec enregistrement latest.json Desktop', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadInstaller = (file: File) => {
    if (!state) return;
    if (file.size > state.maxBytes) {
      flash(`Installateur trop lourd (${fmtBytes(file.size)} — max ${fmtBytes(state.maxBytes)})`, 'error');
      return;
    }
    setUploading(true);
    setUploadPct(0);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `${getApiBase()}/api/admin/desktop-update/installer`);
    xhr.setRequestHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    if (version.trim()) xhr.setRequestHeader('X-Release-Version', version.trim());
    xhr.setRequestHeader('X-Release-Filename', file.name);
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
        const deleted = Array.isArray(data?.data?.deletedKeys) ? data.data.deletedKeys.length : 0;
        flash(`Installateur Desktop publié (${fmtBytes(file.size)}) · ${deleted} ancien(s) fichier(s) supprimé(s) ✓`);
        void load();
      } else {
        flash(data?.error || `Échec upload installateur (${xhr.status})`, 'error');
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      xhrRef.current = null;
      flash('Échec upload installateur (réseau)', 'error');
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
    return (
      <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }} aria-busy="true">
        <div className="skeleton" style={{ height: 18, width: '40%' }} />
        <div className="skeleton" style={{ height: 52, borderRadius: 12 }} />
      </div>
    );
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
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Mise à jour application Bureau (Windows · CDN1)</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Le manifeste <code>latest.json</code> et l&apos;installateur Windows universel/x86 vivent sur Cloudflare R2
          (<code>app-updates/desktop/</code>) et sont servis par CDN1. Chaque nouvelle publication supprime
          automatiquement les anciens binaires du dossier <code>app-updates/desktop/</code>.
        </p>
        {state && (
          <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            {[
              ['Source manifeste', state.source === 'r2' ? 'R2 ✓' : state.source === 'db' ? 'D1 (fallback)' : 'aucun'],
              [`latest.json · ${fmtBytes(state.json.size)}`, fmtDate(state.json.uploaded)],
              [`latest-setup.exe · ${fmtBytes(state.installer.size)}`, fmtDate(state.installer.uploaded)],
              ['Fichiers actifs dans app-updates/desktop/', String(state.files.length)],
            ].map(([k, v], i) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 12px',
                  fontSize: 13,
                  borderBottom: i < 3 ? '1px solid var(--line)' : 'none',
                }}
              >
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
        {state && state.files.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)' }}>
            {state.files.map((f) => (
              <li key={f.key}>
                <code>{f.key}</code> · {fmtBytes(f.size)}
              </li>
            ))}
          </ul>
        )}
        {state && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button type="button" className="secondary" onClick={() => void copy(state.json.url)}>Copier URL latest.json</button>
            <button type="button" className="secondary" onClick={() => void copy(state.installer.url)}>Copier URL latest-setup.exe</button>
            <a href={state.json.url} target="_blank" rel="noreferrer" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--muted, #64748b)' }}>Ouvrir latest.json</a>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Éditer app-updates/desktop/latest.json</h2>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="form-row">
            <label>Version (semver)</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.9.3" />
          </div>
          <div className="form-row">
            <label>Canal</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value === 'prerelease' ? 'prerelease' : 'stable')}>
              <option value="stable">stable</option>
              <option value="prerelease">prerelease</option>
            </select>
          </div>
          <div className="form-row">
            <label>Version minimale (optionnelle)</label>
            <input value={minVersion} onChange={(e) => setMinVersion(e.target.value)} placeholder="0.9.0" />
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label>downloadUrl (installateur Windows CDN1)</label>
          <input
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
            placeholder={state ? state.installer.url : 'https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe'}
          />
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label>SHA-256 (optionnel, 64 hex)</label>
          <input value={sha256} onChange={(e) => setSha256(e.target.value)} placeholder="64 caractères hexadécimaux" />
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} style={{ width: 'auto' }} />
            Mise à jour obligatoire (mandatory)
          </label>
        </div>
        <div className="form-row" style={{ marginTop: 8 }}>
          <label>Notes de version</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} />
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void saveJson()} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer latest.json Desktop'}
          </button>
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>Recharger</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Uploader l&apos;installateur Windows (.exe / .msi)</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Envoie le binaire vers R2 (<code>app-updates/desktop/</code>), met à jour <code>latest-setup.exe</code> et
          supprime automatiquement les anciens fichiers Desktop du bucket.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".exe,.msi,application/octet-stream"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadInstaller(f);
            e.target.value = '';
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? `Envoi… ${uploadPct}%` : 'Choisir un fichier .exe / .msi'}
          </button>
          {uploading && (
            <button type="button" className="secondary" onClick={() => { xhrRef.current?.abort(); setUploading(false); }}>
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
        <p role="status" style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: msgType === 'success' ? 'var(--ac-ok, #16a34a)' : 'var(--ac-danger, #dc2626)' }}>
          {msg}
        </p>
      )}
    </div>
  );
}
