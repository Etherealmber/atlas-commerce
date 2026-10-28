/**
 * Download — landing publique de téléchargement de l'APK Android.
 * Lit le manifeste `latest.json` servi par le CDN (même source que le
 * panneau de mise à jour owner) et présente le produit : hero, stats,
 * fonctionnalités, données techniques et liens — sans compte.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME, APP_VERSION, APP_BUILD_DATE, APP_GITHUB } from '../version';

const LATEST_JSON = 'https://cdn1.afmarbre.com/app-updates/android/latest.json';

type Manifest = {
  versionName?: string;
  versionCode?: number;
  apkUrl?: string;
  buildDate?: string;
  notes?: string;
  mandatory?: boolean;
};

const FEATURES: { title: string; text: string }[] = [
  { title: 'Synchronisation offline', text: 'Le catalogue et les ventes continuent sans réseau, puis se synchronisent automatiquement.' },
  { title: 'Connexion QR & passkey', text: 'Scan depuis le web ou biométrie appareil — sans retaper mot de passe ni OTP à chaque fois.' },
  { title: 'Factures & PDF', text: 'Factures, devis, reçus et avoirs en PDF prêts à imprimer, avec QR de vérification.' },
  { title: 'Stock & caisse', text: 'Entrées/sorties, stock bas, ventes du jour et trésorerie suivis en temps réel.' },
  { title: 'Notifications & mises à jour', text: 'Mises à jour applicatives servies par CDN, avec plancher de version piloté depuis le web.' },
  { title: 'Sécurité de bout en bout', text: 'OTP e-mail, appareils de confiance révocables, WebAuthn et empreinte de signature contrôlée.' },
];

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

  /* v0.7.1 — SEO / partage : titre, description, Open Graph et Schema.org. */
  useEffect(() => {
    const prevTitle = document.title;
    document.title = `Télécharger ${APP_NAME} — APK Android officielle`;
    const upsert = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      return el;
    };
    const metas = [
      upsert('name', 'description', `${APP_NAME} — application Android de gestion (stock, caisse, facturation) pour le commerce. APK officielle, gratuite, sans compte requis pour cette page.`),
      upsert('property', 'og:type', 'website'),
      upsert('property', 'og:title', `Télécharger ${APP_NAME} — APK Android`),
      upsert('property', 'og:description', 'Gérez stock, caisse et facturation depuis votre Android. APK officielle servie par CDN.'),
      upsert('property', 'og:url', 'https://stock.afmarbre.com/download'),
      upsert('property', 'og:image', 'https://stock.afmarbre.com/atlas-logo-light.png'),
    ];
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'MobileApplication',
      name: APP_NAME,
      description: 'Application Android de gestion commerciale : stock, caisse, facturation, QR et passkeys.',
      operatingSystem: 'ANDROID',
      applicationCategory: 'BusinessApplication',
      inLanguage: 'fr',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      url: 'https://stock.afmarbre.com/download',
    });
    document.head.appendChild(ld);
    return () => {
      document.title = prevTitle;
      metas.forEach((el) => el.remove());
      ld.remove();
    };
  }, []);

  return (
    <div className="download-landing">
      {/* ── Hero ─ */}
      <section className="dl-hero">
        <div className="dl-hero-bg" aria-hidden />
        <div className="dl-hero-grid" aria-hidden />
        <div className="dl-hero-content">
          <p className="dl-eyebrow">Appli Android officielle</p>
          <h1 className="dl-h1">
            Gérez votre commerce<br />
            <span>depuis votre poche</span>
          </h1>
          <p className="dl-desc">
            {APP_NAME} — stock, caisse, facturation et trésorerie dans une seule application
            Android : synchronisation offline, connexion QR et passkey, PDF prêts à imprimer.
          </p>
          <div className="dl-ctas">
            {state === 'ok' && m ? (
              <a className="public-whats-new-cta dl-cta-main" href={String(m.apkUrl)} target="_blank" rel="noopener noreferrer">
                Télécharger l&apos;APK
              </a>
            ) : (
              <span className="public-whats-new-cta dl-cta-main dl-cta-wait" aria-disabled="true">
                {state === 'loading' ? 'Lecture du manifeste…' : 'Manifeste injoignable'}
              </span>
            )}
            <a className="dl-cta-ghost" href={APP_GITHUB} target="_blank" rel="noopener noreferrer">
              Voir sur GitHub
            </a>
          </div>
          <p className="dl-note">
            <span className="dl-note-dot" aria-hidden />
            Disponible maintenant — gratuit, sans compte pour cette page
          </p>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="dl-stats" aria-label="Informations de version">
        <div className="dl-stat">
          <strong>{state === 'ok' && m ? `v${m.versionName || APP_VERSION}` : `v${APP_VERSION}`}</strong>
          <span>Version</span>
        </div>
        <div className="dl-stat">
          <strong>{state === 'ok' && m?.versionCode ? `#${m.versionCode}` : '—'}</strong>
          <span>Build</span>
        </div>
        <div className="dl-stat">
          <strong>{m?.buildDate || APP_BUILD_DATE}</strong>
          <span>Publiée le</span>
        </div>
        <div className="dl-stat">
          <strong>0 MAD</strong>
          <span>Prix</span>
        </div>
      </section>

      {/* ── Notes de version ── */}
      {state === 'ok' && m?.notes ? (
        <section className="card dl-section">
          <h2>Notes de version</h2>
          <p className="dl-notes">{m.notes}</p>
          {m.mandatory ? <p className="dl-mandatory">Mise à jour obligatoire pour les versions antérieures.</p> : null}
        </section>
      ) : null}
      {state === 'error' ? (
        <section className="card dl-section">
          <h2>Manifeste injoignable</h2>
          <p className="dl-notes">
            Le fichier de mise à jour ne répond pas pour le moment. Réessayez dans un instant.
          </p>
          <button type="button" className="secondary" onClick={load} style={{ borderRadius: 12, minHeight: 44, padding: '0 20px' }}>
            Réessayer
          </button>
        </section>
      ) : null}

      {/* ── Fonctionnalités ── */}
      <section className="dl-section">
        <h2 className="dl-sec-title">Ce que l&apos;app sait faire</h2>
        <div className="dl-feats">
          {FEATURES.map((f) => (
            <div key={f.title} className="card dl-feat">
              <strong>{f.title}</strong>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Données techniques ── */}
      <section className="card dl-section">
        <h2>Données techniques</h2>
        <ul className="dl-tech">
          <li>
            Manifeste de mise à jour :{' '}
            <a href={LATEST_JSON} target="_blank" rel="noopener noreferrer">latest.json</a>{' '}
            <span className="dl-muted">(CDN cdn1.afmarbre.com)</span>
          </li>
          <li>
            Dépôt du projet :{' '}
            <a href={APP_GITHUB} target="_blank" rel="noopener noreferrer">Etherealmber/atlas-commerce</a>{' '}
            <span className="dl-muted">· builds Android : atlas-commerce-android</span>
          </li>
          <li>
            Canal : <span className="dl-muted">beta (0.x)</span> · Licence :{' '}
            <span className="dl-muted">MIT © 2026 loxdpsy / Etherealmber</span>
          </li>
          <li>
            Install : <span className="dl-muted">ouvrez l&apos;APK téléchargée depuis ce lien officiel uniquement</span>
          </li>
        </ul>
      </section>

      {/* ── Footer ── */}
      <footer className="dl-foot">
        <nav aria-label="Liens produit">
          <Link to="/whats-new">Nouveautés</Link>
          <span aria-hidden>·</span>
          <Link to="/about">À propos</Link>
          <span aria-hidden>·</span>
          <Link to="/privacy">Confidentialité</Link>
          <span aria-hidden>·</span>
          <Link to="/terms">Conditions</Link>
          <span aria-hidden>·</span>
          <a href={APP_GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
        <p>
          v{APP_VERSION} · {APP_BUILD_DATE} — © {new Date().getFullYear()} {APP_NAME}
        </p>
      </footer>
    </div>
  );
}
