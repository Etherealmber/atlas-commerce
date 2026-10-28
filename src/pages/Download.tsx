/**
 * Download — page publique de téléchargement de l'APK Android.
 * Lit le manifeste `latest.json` servi par le CDN (même source que le
 * panneau de mise à jour owner) et propose le lien en nouvel onglet.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME, APP_VERSION, APP_BUILD_DATE } from '../version';

const LATEST_JSON = 'https://cdn1.afmarbre.com/app-updates/android/latest.json';

type Manifest = {
  versionName?: string;
  versionCode?: number;
  apkUrl?: string;
  buildDate?: string;
  notes?: string;
  mandatory?: boolean;
};

export default function Download() {
  const [m, setM] = useState<Manifest | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  const load = useCallback(() => {
    setState('loading');
    fetch(LATEST_JSON, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j: any) => {
        const man = (j && (j.manifest || j)) as Manifest;
        if (!man || !String(man.apkUrl || '')) throw new Error('empty');
        setM(man);
        setState('ok');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="atlas-page about-page atlas-crm download-page">
      <p className="about-meta-line">
        v{APP_VERSION} · {APP_BUILD_DATE}
        <span aria-hidden> · </span>
        <Link to="/whats-new">Nouveautés</Link>
      </p>
      <header className="about-hero">
        <div className="about-hero-brand">
          <img src="/atlas-icon-light.png" alt="" width={48} height={48} className="about-logo brand-img brand-img--light" loading="lazy" decoding="async" />
          <img src="/atlas-icon-dark.png" alt="" width={48} height={48} className="about-logo brand-img brand-img--dark" loading="lazy" decoding="async" />
          <div>
            <p className="atlas-eyebrow" style={{ margin: 0 }}>App Android</p>
            <h1 style={{ margin: 0 }}>Télécharger {APP_NAME}</h1>
          </div>
        </div>
      </header>

      <section className="card about-section">
        {state === 'loading' && <p className="about-muted">Lecture du manifeste de mise à jour…</p>}
        {state === 'error' && (
          <div>
            <p className="about-muted" style={{ marginTop: 0 }}>
              Le manifeste de mise à jour est momentanément injoignable. Réessayez dans un instant.
            </p>
            <button type="button" className="secondary" onClick={load} style={{ borderRadius: 12, minHeight: 44, padding: '0 20px' }}>
              Réessayer
            </button>
          </div>
        )}
        {state === 'ok' && m && (
          <div className="download-body">
            <p className="download-version">
              <span className="ac-device-chip">v{m.versionName || APP_VERSION}</span>
              {m.buildDate ? <span className="about-muted"> · build {m.buildDate}</span> : null}
              {m.mandatory ? <span className="ac-device-chip">mise à jour obligatoire</span> : null}
            </p>
            {m.notes ? <p className="about-muted download-notes">{m.notes}</p> : null}
            <a
              className="public-whats-new-cta download-cta"
              href={String(m.apkUrl)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Télécharger l&apos;APK
            </a>
            <p className="about-muted" style={{ marginTop: 10, fontSize: 12.5 }}>
              Le lien s&apos;ouvre dans un nouvel onglet. Installez uniquement depuis ce lien officiel.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
