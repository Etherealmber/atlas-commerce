import DownloadPreview from '../components/DownloadPreview';
import DownloadHeroVisual from '../components/DownloadHeroVisual';
/**
 * Download — page publique de l'APK Android, avec navigation Atlas partagée.
 * Manifeste `latest.json` du CDN pour le binaire,
 * notes de version depuis les GitHub Releases du dépôt android.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLandingMotion } from '../hooks/useLandingMotion';
import { Link } from 'react-router-dom';
import { PublicNav, PublicSessionCta } from '../components/PublicChrome';
import { APP_NAME, APP_BUILD_DATE, APP_GITHUB } from '../version';
import { publicationDate, sameReleaseVersion } from '../lib/releaseDate';

const LATEST_JSON = 'https://cdn1.afmarbre.com/app-updates/android/latest.json';
const GH_RELEASES = 'https://api.github.com/repos/Etherealmber/atlas-commerce-android/releases?per_page=50';
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

/* ── Mini-rendu Markdown sûr : escape HTML d'abord, puis titres, listes,
      gras, italique, code inline et liens http(s) uniquement. ── */
function escMd(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inlineMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}
function mdToHtml(src: string): string {
  const out: string[] = [];
  let inUl = false;
  const closeUl = () => { if (inUl) { out.push('</ul>'); inUl = false; } };
  for (const raw of escMd(src).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { closeUl(); continue; }
    const bullet = t.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inlineMd(bullet[1])}</li>`);
      continue;
    }
    closeUl();
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(h[1].length + 2, 6);
      out.push(`<h${lvl}>${inlineMd(h[2])}</h${lvl}>`);
      continue;
    }
    out.push(`<p>${inlineMd(t)}</p>`);
  }
  closeUl();
  return out.join('');
}

export default function Download() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingMotion(pageRef, '.dl-ed-facts, .dl-ed-section, .dl-preview', '.dl-ed-visual-inner');
  const [m, setM] = useState<Manifest | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [rels, setRels] = useState<GhRelease[]>([]);

  const load = useCallback(() => {
    setState('loading');
    // v0.7.1 — lecture same-origin d'abord (le Worker lit R2 : aucun CORS),
    // repli sur le CDN si la voie interne échoue.
    const fromApi = fetch('/api/app/android-update?versionCode=0', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j: any) => {
        const man = (j && (j.manifest || j)) as Manifest;
        if (!man || !String(man.apkUrl || '')) throw new Error('empty');
        return man;
      });
    const fromCdn = () => fetch(LATEST_JSON, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j: any) => {
        const man = (j && (j.manifest || j)) as Manifest;
        if (!man || !String(man.apkUrl || '')) throw new Error('empty');
        return man;
      });
    fromApi
      .catch(() => fromCdn())
      .then((man) => { setM(man); setState('ok'); })
      .catch(() => setState('error'));
    // Toutes les versions : GitHub Releases du dépôt android (auto-update).
    fetch(GH_RELEASES, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: any) => setRels(Array.isArray(j) ? (j as GhRelease[]) : []))
      .catch(() => setRels([]));
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
  const rel = rels[0] || null;
  const relBody = String(rel?.body || '').trim();
  const notesBody = relBody || String(m?.notes || '').trim();
  const relTitle = rel?.name || rel?.tag_name || (m ? `v${m.versionName}` : APP_NAME);
  const relDate = publicationDate(rel?.published_at);
  const manifestRelease = rels.find(r => sameReleaseVersion(r.tag_name, m?.versionName));
  const manifestPublished = publicationDate(manifestRelease?.published_at);

  return (
    <div className="download-landing android-landing" ref={pageRef}>
      {/* ── Navbar visible par tous : accueil, légal, contact → À propos ── */}
      <PublicNav
        links={[
          { href: '/', label: 'Accueil' },
          { href: '#apercu', label: 'Aperçu' },
          { href: '#versions', label: 'Versions' },
          { href: '/desktop', label: 'Bureau' },
          { href: '/whats-new', label: 'Nouveautés' },
        ]}
        cta={<PublicSessionCta />}
        classic
      />

      <main className="dl-ed-main">
        <section className="dl-hero dl-ed-hero">
          <div className="dl-container">
            <a className="dl-ed-release-badge" href="#versions"><span aria-hidden="true" />{m?.versionName ? `Version Android · ${m.versionName}` : 'Versions Android'} <b aria-hidden="true">↗</b></a>
            <div className="dl-ed-hero-grid">
              <div className="dl-hero-content">
                <h1 className="dl-h1 dl-ed-title"><span className="dl-ed-title-first">Atlas Commerce</span>{' '}<span className="dl-ed-title-second">pour Android.</span></h1>
                <p className="dl-desc">Stock, ventes, factures et trésorerie : les outils Atlas vous accompagnent sur le terrain.</p>
                <div className="dl-ctas">
                  {apkHref ? <a className="dl-cta-main" href={apkHref} target="_blank" rel="noopener noreferrer">↓ &nbsp; Télécharger l&apos;APK</a> : <span className="dl-cta-main dl-cta-wait" aria-disabled="true">{state === 'loading' ? 'Lecture du manifeste…' : 'Manifeste injoignable'}</span>}
                  <a className="dl-cta-ghost" href="#versions">Voir les versions</a>
                </div>
                <p className="dl-note">{state === 'ok' ? 'APK officielle · téléchargement sans connexion au compte' : state === 'loading' ? 'Vérification de la version officielle' : 'Consultez le dépôt pour les versions disponibles'}</p>
              </div>
              <div className="dl-ed-mark" aria-hidden="true"><div><img src="/atlas-icon-light.png" alt="" width="100" height="100" /></div><span>ATLAS · SUR LE TERRAIN</span></div>
            </div>
            <DownloadHeroVisual platform="android" />
            <ul className="dl-ed-facts">
              <li><b>Stock &amp; scan</b><span>Votre catalogue à portée de main.</span></li>
              <li><b>Ventes &amp; PDF</b><span>Les documents de votre activité.</span></li>
              <li><b>Sur le terrain</b><span>Fonctions disponibles hors ligne.</span></li>
              <li><b>Open source</b><span>Un projet à explorer sur GitHub.</span></li>
            </ul>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="telechargement" aria-labelledby="android-download-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading"><p className="dl-ed-kicker">01 / TÉLÉCHARGER</p><h2 id="android-download-title">Android</h2><p>Retrouvez la dernière APK officielle et les informations de version.</p><a href={ANDROID_REPO} target="_blank" rel="noopener noreferrer">Dépôt Android ↗</a></div>
            <div className="dl-ed-content">
              <div className="dl-ed-platforms" aria-label="Plateforme"><span className="dl-ed-platform-active">Android</span><Link to="/desktop">Bureau</Link></div>
              <div className="dl-ed-download-row"><div><strong>Application Android</strong><span>{m?.versionName ? `Version ${m.versionName}` : 'Version indisponible'} · APK</span></div>{apkHref ? <a href={apkHref} target="_blank" rel="noopener noreferrer">Télécharger ↗</a> : <span>{state === 'loading' ? 'Chargement…' : 'Indisponible'}</span>}</div>
              <div className="dl-stats" aria-label="Informations de version"><div className="dl-stat"><strong>{m?.versionName ? `v${m.versionName}` : '—'}</strong><span>Version</span></div><div className="dl-stat"><strong>{m?.versionCode ? `#${m.versionCode}` : '—'}</strong><span>Build</span></div><div className="dl-stat"><strong>{manifestPublished || '—'}</strong><span>Publication de l’APK</span></div></div>
              <p className="dl-ed-hint">{m?.buildDate && <>Build : {m.buildDate} · </>}Installez uniquement l’APK obtenue depuis la page ou le dépôt officiel.</p>
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="versions" aria-labelledby="android-versions-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading"><p className="dl-ed-kicker">02 / MISES À JOUR</p><h2 id="android-versions-title">Versions</h2><p>Notes et historique publiés pour l’application Android.</p><a href={`${ANDROID_REPO}/releases`} target="_blank" rel="noopener noreferrer">Toutes les releases ↗</a></div>
            <div className="dl-ed-content">
              <article className="dl-release"><p className="dl-release-label">Dernière release</p><h3>{relTitle}</h3><p className="dl-release-date">{relDate ? `Publiée le ${relDate}` : 'Date de publication indisponible'}</p>{notesBody ? <div className="dl-md dl-release-body" dangerouslySetInnerHTML={{ __html: mdToHtml(notesBody) }} /> : <p className="dl-release-body">Notes de version non publiées pour ce binaire.</p>}{rel?.html_url && <a className="dl-release-link" href={rel.html_url} target="_blank" rel="noopener noreferrer">Voir la release sur GitHub ↗</a>}</article>
              <h3 className="dl-ed-subheading">Historique</h3><div className="dl-rel-list">{rels.map((r, i) => <div key={String(r.tag_name || r.name || i)} className="dl-rel-row"><strong>{r.name || r.tag_name}</strong><span className="dl-muted">{publicationDate(r.published_at) || 'Date indisponible'}</span>{r.html_url && <a href={r.html_url} target="_blank" rel="noopener noreferrer">Voir ↗</a>}</div>)}{rels.length === 0 && <p className="dl-muted">Historique indisponible pour le moment.</p>}</div>
            </div>
          </div>
        </section>
        <DownloadPreview platform="android" />
        <section className="dl-ed-section dl-container"><div className="dl-ed-rail"><div className="dl-ed-heading"><p className="dl-ed-kicker">04 / FONCTIONNALITÉS</p><h2>Un outil pour le terrain.</h2><p>Les fonctionnalités Atlas pour accompagner votre activité.</p></div><div className="dl-feats">{FEATURES.map(f => <div key={f.title} className="dl-feat"><strong>{f.title}</strong><p>{f.text}</p></div>)}</div></div></section>
      </main>

      {/* ── Footer deux colonnes ─ */}
      <footer className="dl-foot">
        <div className="dl-foot-inner">
          <div className="dl-foot-brand">
            <img src="/atlas-logo-dark.png" alt="" className="theme-logo-dark" width={117} height={38} style={{ height: 38, width: 117 }} />
            <img src="/atlas-logo-light.png" alt={APP_NAME} className="theme-logo-light" width={117} height={38} style={{ height: 38, width: 117 }} />
            <p>Application Android de gestion commerciale : stock, caisse, facturation et trésorerie, même offline.</p>
          </div>
          <nav aria-label="Liens produit">
            <Link to="/whats-new">Nouveautés</Link>
            <Link to="/about">À propos</Link>
            <Link to="/privacy">Confidentialité</Link>
            <Link to="/terms">Conditions</Link> · <Link to="/licenses">Licences</Link>
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
