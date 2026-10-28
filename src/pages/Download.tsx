/**
 * Download — landing sombre PLEINEMENT autonome de l'APK Android.
 * Ni topbar, ni sidebar, ni FAB, ni Agent : connecté ou non, la page se
 * suffit (directive user). Manifeste `latest.json` du CDN pour le binaire,
 * notes de version depuis les GitHub Releases du dépôt android.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME, APP_BUILD_DATE, APP_GITHUB } from '../version';

const LATEST_JSON = 'https://cdn1.afmarbre.com/app-updates/android/latest.json';
const GH_RELEASE = 'https://api.github.com/repos/Etherealmber/atlas-commerce-android/releases/latest';
const ANDROID_REPO = 'https://github.com/Etherealmber/atlas-commerce-android';

type Manifest = {
  versionName?: string;
  versionCode?: number;
  apkUrl?: string;
  buildDate?: string;
  notes?: string;
  mandatory?: boolean;
};

type GhRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
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
  const [rel, setRel] = useState<GhRelease | null>(null);

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
    // Notes de version : la dernière GitHub Release du dépôt android.
    fetch(GH_RELEASE, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: any) => setRel(j as GhRelease))
      .catch(() => setRel(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  /* SEO / partage : titre, description, Open Graph et Schema.org (sans prix). */
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
      upsert('name', 'description', `${APP_NAME} — application Android de gestion (stock, caisse, facturation) pour le commerce. APK officielle servie par CDN.`),
      upsert('property', 'og:type', 'website'),
      upsert('property', 'og:title', `Télécharger ${APP_NAME} — APK Android`),
      upsert('property', 'og:description', 'Gérez stock, caisse et facturation depuis votre Android. APK officielle servie par CDN.'),
      upsert('property', 'og:url', 'https://stock.afmarbre.com/download'),
      upsert('property', 'og:image', 'https://stock.afmarbre.com/atlas-logo-dark.png'),
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
      url: 'https://stock.afmarbre.com/download',
    });
    document.head.appendChild(ld);
    return () => {
      document.title = prevTitle;
      metas.forEach((el) => el.remove());
      ld.remove();
    };
  }, []);

  const apkHref = state === 'ok' && m ? String(m.apkUrl) : '';
  const relBody = String(rel?.body || '').trim();
  const notesBody = relBody || String(m?.notes || '').trim();
  const relTitle = rel?.name || rel?.tag_name || (m ? `v${m.versionName}` : APP_NAME);
  const relDate = rel?.published_at ? String(rel.published_at).slice(0, 10) : m?.buildDate || APP_BUILD_DATE;

  return (
    <div className="download-landing">
      {/* ── Hero plein écran ─ */}
      <section className="dl-hero">
        <div className="dl-hero-bg" aria-hidden />
        <div className="dl-hero-grid" aria-hidden />
        <div className="dl-container">
          <div className="dl-hero-content">
            <p className="dl-eyebrow">Appli Android officielle</p>
            <h1 className="dl-h1">
              Gérez votre commerce<br />
              <span>depuis votre poche</span>
            </h1>
            <p className="dl-desc">
              {APP_NAME} — stock, caisse, facturation et trésorerie dans une seule
              application Android : synchronisation offline, connexion QR et passkey,
              PDF prêts à imprimer.
            </p>
            <div className="dl-ctas">
              {apkHref ? (
                <a className="dl-cta-main" href={apkHref} target="_blank" rel="noopener noreferrer">
                  Télécharger l&apos;APK
                </a>
              ) : (
                <span className="dl-cta-main dl-cta-wait" aria-disabled="true">
                  {state === 'loading' ? 'Lecture du manifeste…' : 'Manifeste injoignable'}
                </span>
              )}
              <a className="dl-cta-ghost" href={ANDROID_REPO} target="_blank" rel="noopener noreferrer">
                Voir sur GitHub
              </a>
            </div>
            <p className="dl-note">
              <span className="dl-note-dot" aria-hidden />
              Disponible maintenant — sans compte pour cette page
            </p>
          </div>
        </div>
      </section>

      {/* ── Stats + fonctionnalités + release ─ */}
      <section className="dl-band">
        <div className="dl-container">
          <div className="dl-stats" aria-label="Informations de version">
            <div className="dl-stat">
              <strong>{m ? `v${m.versionName || APP_NAME}` : '…'}</strong>
              <span>Version</span>
            </div>
            <div className="dl-stat">
              <strong>{m?.versionCode ? `#${m.versionCode}` : '…'}</strong>
              <span>Build</span>
            </div>
            <div className="dl-stat">
              <strong>{m?.buildDate || APP_BUILD_DATE}</strong>
              <span>Publiée le</span>
            </div>
          </div>

          <h2 className="dl-sec-title">Ce que l&apos;app sait faire</h2>
          <p className="dl-sec-sub">
            Une seule application de terrain, pensée pour le commerce : rapide, sûre,
            utilisable d&apos;une main.
          </p>
          <div className="dl-feats">
            {FEATURES.map((f) => (
              <div key={f.title} className="dl-feat">
                <strong>{f.title}</strong>
                <p>{f.text}</p>
              </div>
            ))}
          </div>

          <h2 className="dl-sec-title" style={{ marginTop: 56 }}>Notes de version</h2>
          <p className="dl-sec-sub">
            {relBody
              ? 'Dernière publication du dépôt Android sur GitHub Releases.'
              : 'Dernières notes publiées avec le binaire.'}
          </p>
          <div className="dl-release">
            <h3>{relTitle}</h3>
            <p className="dl-release-date">{relDate}</p>
            {notesBody ? (
              <p className="dl-release-body">{notesBody}</p>
            ) : (
              <p className="dl-release-body">Notes de version non publiées pour ce binaire.</p>
            )}
            {rel?.html_url ? (
              <a className="dl-release-link" href={rel.html_url} target="_blank" rel="noopener noreferrer">
                Voir la release sur GitHub
              </a>
            ) : null}
          </div>

          <ul className="dl-tech">
            <li>
              Manifeste de mise à jour :{' '}
              <a href={LATEST_JSON} target="_blank" rel="noopener noreferrer">latest.json</a>{' '}
              <span className="dl-muted">· CDN cdn1.afmarbre.com</span>
            </li>
            <li>
              Dépôts :{' '}
              <a href={APP_GITHUB} target="_blank" rel="noopener noreferrer">atlas-commerce</a>{' '}
              <span className="dl-muted">·</span>{' '}
              <a href={ANDROID_REPO} target="_blank" rel="noopener noreferrer">atlas-commerce-android</a>
            </li>
            <li>
              Licence : <span className="dl-muted">MIT © 2026 loxdpsy / Etherealmber</span>
            </li>
            <li>
              Installation : <span className="dl-muted">ouvrez l&apos;APK téléchargée depuis ce lien officiel uniquement</span>
            </li>
          </ul>
        </div>
      </section>

      {/* ── CTA final ─ */}
      <section className="dl-cta-sec">
        <div className="dl-container" style={{ position: 'relative', zIndex: 2 }}>
          <h2>Prêt à encaisser partout ?</h2>
          <p>Installez l&apos;APK officielle, connectez-vous en scannant le QR du web, et reprenez la caisse en deux minutes.</p>
          <div className="dl-ctas" style={{ justifyContent: 'center' }}>
            {apkHref ? (
              <a className="dl-cta-main" href={apkHref} target="_blank" rel="noopener noreferrer">
                Télécharger l&apos;APK
              </a>
            ) : (
              <span className="dl-cta-main dl-cta-wait" aria-disabled="true">Manifeste injoignable</span>
            )}
            <Link className="dl-cta-ghost" to="/whats-new">Nouveautés</Link>
          </div>
        </div>
      </section>

      {/* ── Footer deux colonnes ─ */}
      <footer className="dl-foot">
        <div className="dl-foot-inner">
          <div className="dl-foot-brand">
            <img src="/atlas-logo-dark.png" alt={APP_NAME} />
            <p>Application Android de gestion commerciale : stock, caisse, facturation et trésorerie, même offline.</p>
          </div>
          <nav aria-label="Liens produit">
            <Link to="/whats-new">Nouveautés</Link>
            <Link to="/about">À propos</Link>
            <Link to="/privacy">Confidentialité</Link>
            <Link to="/terms">Conditions</Link>
            <a href={APP_GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
            <Link to="/login">Se connecter</Link>
          </nav>
        </div>
        <div className="dl-foot-bottom">
          <span>© {new Date().getFullYear()} {APP_NAME} — tous droits réservés</span>
          <span>{m ? `v${m.versionName} · ${m.buildDate || APP_BUILD_DATE}` : APP_BUILD_DATE}</span>
        </div>
      </footer>
    </div>
  );
}
