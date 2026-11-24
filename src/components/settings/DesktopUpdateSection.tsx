import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '../../auth';
import { getApiBase } from '../../config';

export type DesktopOsTab = 'windows' | 'macos' | 'linux';

export type DesktopAssetEntry = {
  platform: DesktopOsTab;
  arch: 'universal' | 'x86_64' | 'arm64';
  kind: string;
  filename: string;
  key: string;
  aliasKey: string | null;
  downloadUrl: string;
  latestUrl: string | null;
  sha256: string | null;
  sizeBytes: number;
};

export type DesktopManifest = {
  platform: DesktopOsTab;
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
  assets?: DesktopAssetEntry[];
};

export type DesktopRemoteState = {
  manifest: DesktopManifest;
  source: 'r2' | 'db' | null;
  json: { key: string; url: string; size: number | null; uploaded: string | null };
  installer: { key: string; url: string; size: number | null; uploaded: string | null };
  files: Array<{ key: string; size: number; uploaded: string | null }>;
  maxBytes: number;
};

const OS_META: Record<DesktopOsTab, {
  label: string;
  formats: string;
  accept: string;
  aliasFile: string;
  defaultArch: 'universal' | 'x86_64' | 'arm64';
  arches: Array<{ value: 'universal' | 'x86_64' | 'arm64'; label: string }>;
}> = {
  windows: {
    label: 'Windows',
    formats: '.exe (universel x64 + ARM64), .msi ou .zip',
    accept: '.exe,.msi,.zip,application/octet-stream',
    aliasFile: 'latest-setup.exe',
    defaultArch: 'universal',
    arches: [
      { value: 'universal', label: 'universal (x64 + ARM64)' },
      { value: 'x86_64', label: 'x86_64 (64-bit)' },
      { value: 'arm64', label: 'arm64' },
    ],
  },
  macos: {
    label: 'macOS',
    formats: '.dmg universel (Apple Silicon + Intel) ou .tar.gz',
    accept: '.dmg,.tar.gz,.zip,application/octet-stream',
    aliasFile: 'latest-macos.dmg',
    defaultArch: 'universal',
    arches: [
      { value: 'universal', label: 'universal (arm64 + x86_64)' },
      { value: 'arm64', label: 'arm64 (Apple Silicon)' },
      { value: 'x86_64', label: 'x86_64 (Intel)' },
    ],
  },
  linux: {
    label: 'Linux',
    formats: '.AppImage, .AppImage.zsync, .tar.gz, .deb ou .rpm',
    accept: '.AppImage,.zsync,.tar.gz,.deb,.rpm,application/octet-stream',
    aliasFile: 'latest-linux-x86_64.AppImage',
    defaultArch: 'x86_64',
    arches: [
      { value: 'x86_64', label: 'x86_64 (amd64)' },
      { value: 'arm64', label: 'arm64 (aarch64)' },
    ],
  },
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

type Props = {
  os: DesktopOsTab;
  sharedState: DesktopRemoteState | null;
  loading: boolean;
  loadError: string;
  onReload: () => Promise<void>;
};

export default function DesktopUpdateSection({ os, sharedState, loading, loadError, onReload }: Props) {
  const meta = OS_META[os];
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState<'stable' | 'prerelease'>('stable');
  const [minVersion, setMinVersion] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [notes, setNotes] = useState('');
  const [uploadArch, setUploadArch] = useState<'universal' | 'x86_64' | 'arm64'>(meta.defaultArch);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    setUploadArch(OS_META[os].defaultArch);
  }, [os]);

  const osAssets = useMemo(
    () => (sharedState?.manifest?.assets || []).filter((a) => a.platform === os),
    [sharedState, os],
  );
  const primaryOsAsset = useMemo(
    () =>
      osAssets.find((a) => a.kind !== 'zsync' && a.arch === meta.defaultArch) ||
      osAssets.find((a) => a.kind !== 'zsync') ||
      null,
    [osAssets, meta.defaultArch],
  );

  useEffect(() => {
    if (!sharedState?.manifest) return;
    const m = sharedState.manifest;
    setVersion(String(m.version || ''));
    setChannel(m.channel === 'prerelease' ? 'prerelease' : 'stable');
    setMinVersion(String(m.minimum_version || ''));
    setDownloadUrl(String(primaryOsAsset?.downloadUrl || m.downloadUrl || ''));
    setSha256(String(primaryOsAsset?.sha256 || m.sha256 || ''));
    setMandatory(!!m.mandatory);
    setNotes(String(m.notes || ''));
  }, [sharedState, primaryOsAsset]);

  const flash = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMsg(text);
    setMsgType(type);
    window.setTimeout(() => setMsg((m) => (m === text ? '' : m)), 5000);
  }, []);

  const cdnBase = sharedState
    ? sharedState.json.url.replace(/\/latest\.json$/, '')
    : 'https://cdn1.afmarbre.com/app-updates/desktop';
  const aliasUrl = `${cdnBase}/${meta.aliasFile}`;

  const jsonPreview = useMemo(
    () =>
      JSON.stringify(
        {
          platform: os,
          channel,
          version: version.trim(),
          mandatory,
          minimum_version: minVersion.trim() || null,
          sha256: sha256.trim() || null,
          downloadUrl: downloadUrl.trim() || aliasUrl,
          notes,
          assetsForOs: osAssets.length,
        },
        null,
        2,
      ),
    [os, channel, version, mandatory, minVersion, sha256, downloadUrl, aliasUrl, notes, osAssets.length],
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
          downloadUrl: downloadUrl.trim() || aliasUrl,
          sha256: sha256.trim() || null,
          mandatory,
          notes,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || `Erreur ${res.status}`);
      flash(`app-updates/desktop/latest.json enregistré pour ${meta.label} ✓`);
      await onReload();
    } catch (e: any) {
      flash(e?.message || 'Échec enregistrement latest.json Desktop', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadInstaller = (file: File) => {
    const maxBytes = sharedState?.maxBytes || 350 * 1024 * 1024;
    if (file.size > maxBytes) {
      flash(`Fichier trop lourd (${fmtBytes(file.size)} — max ${fmtBytes(maxBytes)})`, 'error');
      return;
    }
    setUploading(true);
    setUploadPct(0);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', `${getApiBase()}/api/admin/desktop-update/installer`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (version.trim()) xhr.setRequestHeader('X-Release-Version', version.trim());
    xhr.setRequestHeader('X-Release-Platform', os);
    xhr.setRequestHeader('X-Release-Arch', uploadArch);
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
        flash(`${meta.label} (${uploadArch}) publié (${fmtBytes(file.size)}) · ${deleted} ancien(s) fichier(s) purgé(s) ✓`);
        void onReload();
      } else {
        flash(data?.error || `Échec upload ${meta.label} (${xhr.status})`, 'error');
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      xhrRef.current = null;
      flash(`Échec upload ${meta.label} (réseau)`, 'error');
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

  return (
    <div>
      {loadError && (
        <div className="card" style={{ marginBottom: 16, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--ac-danger)', fontSize: 13 }}>{loadError}</span>
          <button type="button" className="secondary" onClick={() => void onReload()}>Réessayer</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Mise à jour application {meta.label} (CDN1)</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Le manifeste <code>latest.json</code> et les installateurs {meta.label} ({meta.formats}) vivent sur Cloudflare R2
          (<code>app-updates/desktop/</code>) et sont servis par CDN1. L’application {meta.label} vérifie{' '}
          <code>GET /api/app/desktop-update?platform={os}</code> au démarrage.
        </p>
        <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          {[
            [
              'Source manifeste',
              loading && !sharedState
                ? 'Chargement…'
                : sharedState?.source === 'r2'
                  ? 'R2 ✓'
                  : sharedState?.source === 'db'
                    ? 'D1 (fallback)'
                    : 'Non publié',
            ],
            [`latest.json · ${fmtBytes(sharedState?.json.size)}`, fmtDate(sharedState?.json.uploaded)],
            [
              `${meta.aliasFile} · ${fmtBytes(primaryOsAsset?.sizeBytes)}`,
              primaryOsAsset ? `${primaryOsAsset.filename} (${primaryOsAsset.arch})` : 'Aucun binaire publié',
            ],
            ['Fichiers actifs dans app-updates/desktop/', sharedState ? String(sharedState.files.length) : '—'],
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

        {osAssets.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {osAssets.map((a) => (
              <div
                key={a.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 12.5,
                }}
              >
                <span>
                  <strong>{a.arch}</strong> · {a.kind} · <code>{a.filename}</code>
                </span>
                <span style={{ color: 'var(--muted)' }}>{fmtBytes(a.sizeBytes)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button type="button" className="secondary" onClick={() => void copy(`${cdnBase}/latest.json`)}>Copier URL latest.json</button>
          <button type="button" className="secondary" onClick={() => void copy(aliasUrl)}>Copier URL {meta.aliasFile}</button>
          <a href={`${cdnBase}/latest.json`} target="_blank" rel="noreferrer" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--muted, #64748b)' }}>Ouvrir latest.json</a>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Éditer latest.json ({meta.label})</h2>
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
          <label>downloadUrl ({meta.label} · CDN1)</label>
          <input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} placeholder={aliasUrl} />
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
            {saving ? 'Enregistrement…' : 'Enregistrer latest.json'}
          </button>
          <button type="button" className="secondary" onClick={() => void onReload()} disabled={loading}>
            Recharger
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Uploader un installateur {meta.label}</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginTop: 4 }}>
          Envoie le binaire {meta.label} ({meta.formats}) vers R2 (<code>app-updates/desktop/</code>) et met à jour{' '}
          <code>{meta.aliasFile}</code>. Une nouvelle version purge automatiquement les anciens binaires.
        </p>
        <div className="form-row" style={{ maxWidth: 260, marginBottom: 12 }}>
          <label>Architecture</label>
          <select value={uploadArch} onChange={(e) => setUploadArch(e.target.value as 'universal' | 'x86_64' | 'arm64')}>
            {meta.arches.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={meta.accept}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadInstaller(f);
            e.target.value = '';
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? `Envoi… ${uploadPct}%` : `Choisir un fichier ${meta.label}`}
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
