import ReleaseTimeline from '../components/ReleaseTimeline';
import DownloadPreview from '../components/DownloadPreview';
import DownloadHeroVisual from '../components/DownloadHeroVisual';
/**
 * Desktop — page de téléchargement de l'application bureau (v0.7.3).
 *
 * Même gabarit standalone que /download (classes `dl-*`, responsive, thèmes) :
 * releases lues depuis GitHub Releases du dépôt atlas-commerce-desktop
 * (Windows .msi/.exe, macOS .dmg, Linux .AppImage), détection de l'OS du
 * visiteur pour le bouton principal, notes de version et historique.
 * Navigation publique partagée et lecture libre, connecté ou non.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLandingMotion } from '../hooks/useLandingMotion';
import { publicationDate } from '../lib/releaseDate';
import { Link } from 'react-router-dom';
import { PublicNav, PublicSessionCta, GitHubStarButton } from '../components/PublicChrome';
import { APP_BUILD_DATE, APP_NAME } from '../version';

const GH_RELEASES = 'https://api.github.com/repos/Etherealmber/atlas-commerce-desktop/releases?per_page=50';
const DESKTOP_REPO = 'https://github.com/Etherealmber/atlas-commerce-desktop';

type GhAsset = { name?: string; browser_download_url?: string };
type GhRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  assets?: GhAsset[];
};

type OsKey = 'windows' | 'macos' | 'linux';

function detectOs(): OsKey {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/mac os x|macintosh|iphone|ipad/i.test(ua)) return 'macos';
  if (/linux|android/i.test(ua)) return 'linux';
  return 'windows';
}

function osAsset(release: GhRelease | null, os: OsKey): GhAsset | null {
  const assets = release?.assets || [];
  const has = (re: RegExp) => assets.find((a) => a.browser_download_url && re.test(String(a.name || ''))) || null;
  if (os === 'windows') {
    // .msi d'abord (installateur entreprise), puis setup.exe x86_64.
    return (
      has(/x86_64-pc-windows-msvc\.msi$/i) ||
      has(/-pc-windows-msvc\.msi$/i) ||
      has(/x86_64-pc-windows-msvc-setup\.exe$/i) ||
      has(/setup\.exe$/i)
    );
  }
  if (os === 'macos') return has(/macos.*\.dmg$/i) || has(/\.dmg$/i);
  return has(/x86_64\.AppImage$/i) || has(/\.AppImage$/i);
}

const OS_LABEL: Record<OsKey, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

const FEATURES: { title: string; text: string }[] = [
  { title: 'Sensation native', text: 'Fenêtre dédiée, raccourcis clavier, impression système et notifications du poste — comme une app métier classique.' },
  { title: 'Même compte, mêmes données', text: 'Connexion OTP / QR identique au web : le bureau retrouve dépôts, caisse, factures et rapports à l’ouverture.' },
  { title: 'Trois systèmes', text: 'Installateurs Windows (.msi / .exe), image macOS universelle (.dmg) et AppImage Linux (x86_64 & aarch64).' },
  { title: 'Mises à jour via Releases', text: 'Les binaires sont publiés par GitHub Actions sur GitHub Releases — aucun store, aucune télémétrie.' },
  { title: 'Pensé pour le comptoir', text: 'Caisse rapide au clavier, douchette code-barres USB et ticket thermique branché au poste.' },
  { title: 'Open source MIT', text: 'Code public (Rust / Tauri) : forkez, auditez, empaquetez pour votre distribution.' },
];

/* ── Mini-rendu Markdown sûr : escape HTML d'abord, puis titres, listes,
      gras, italiques, code inline et liens http(s) uniquement. ── */
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
  const closeUl = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
  };
  for (const raw of escMd(src).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeUl();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeUl();
      out.push(`<h${h[1].length + 2}>${inlineMd(h[2])}</h${h[1].length + 2}>`);
      continue;
    }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${inlineMd(li[1])}</li>`);
      continue;
    }
    closeUl();
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  closeUl();
  return out.join('');
}

export default function Desktop() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingMotion(pageRef, '.dl-ed-facts, .dl-ed-section, .dl-preview', '.dl-ed-visual-inner');
  const [rels, setRels] = useState<GhRelease[]>([]);
  const [state, setState] = useState<'load' | 'ok' | 'error'>('load');
  const [os, setOs] = useState<OsKey>('windows');
  const [assetFilter, setAssetFilter] = useState<OsKey | 'all'>('all');

  useEffect(() => {
    setOs(detectOs());
  }, []);

  const load = useCallback(() => {
    setState('load');
    fetch(GH_RELEASES, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: any) => {
        if (!Array.isArray(j) || j.length === 0) throw new Error('empty');
        setRels(j as GhRelease[]);
        setState('ok');
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${APP_NAME} pour bureau — Windows, macOS & Linux`;
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
      upsert('name', 'description', `${APP_NAME} version bureau : installateurs Windows, macOS et Linux publiés sur GitHub Releases. Même compte, mêmes données que le web.`),
      upsert('property', 'og:type', 'website'),
      upsert('property', 'og:title', `${APP_NAME} pour bureau — Windows, macOS & Linux`),
      upsert('property', 'og:description', 'Application bureau native : caisse au clavier, douchette USB, impression système. Releases officielles GitHub.'),
      upsert('property', 'og:url', 'https://stock.afmarbre.com/desktop'),
      upsert('property', 'og:image', 'https://stock.afmarbre.com/atlas-logo-dark.png'),
    ];
    return () => {
      document.title = prevTitle;
      metas.forEach((el) => el.remove());
    };
  }, []);

  const latest = rels[0] || null;
  const relBody = String(latest?.body || '').trim();
  const relTitle = latest?.name || latest?.tag_name || 'Atlas Commerce Desktop';
  const relDate = publicationDate(latest?.published_at);
  const mainAsset = osAsset(latest, os);
  const visibleAssets = (latest?.assets || []).filter((asset) => {
    const name = String(asset.name || '');
    if (/\.zsync$|source\.tar\.gz$/i.test(name)) return false;
    if (assetFilter === 'all') return true;
    if (assetFilter === 'windows') return /\.msi$|\.exe$|windows.*\.zip$/i.test(name);
    if (assetFilter === 'macos') return /\.dmg$|macos.*\.zip$/i.test(name);
    return /appimage|linux|\.deb$|\.rpm$/i.test(name);
  });

  return (
    <div className="download-landing desktop-landing" ref={pageRef}>
      <PublicNav
        links={[
          { href: '/', label: 'Accueil' },
          { href: '/android', label: 'Android' },
          { href: '#apercu', label: 'Aperçu' },
          { href: '#assets', label: 'Téléchargements' },
          { href: '/whats-new', label: 'Nouveautés' },
        ]}
        cta={<PublicSessionCta />}
        classic
      />

      <main className="dl-ed-main">
        <section className="dl-hero dl-ed-hero">
          <div className="dl-container">
            <a className="dl-ed-release-badge" href="#versions"><span aria-hidden="true" />{latest?.tag_name ? `Version bureau · ${latest.tag_name}` : 'Versions bureau'} <b aria-hidden="true">↗</b></a>
            <div className="dl-ed-hero-grid">
              <div className="dl-hero-content">
                <h1 className="dl-h1 dl-ed-title"><span className="dl-ed-title-first">Atlas Commerce</span>{' '}<span className="dl-ed-title-second">pour bureau.</span></h1>
                <p className="dl-desc">Votre espace de gestion dans une fenêtre dédiée, pour Windows, macOS et Linux.</p>
                <div className="dl-ctas">
                  {state === 'ok' && mainAsset ? <a className="dl-cta-main" href={String(mainAsset.browser_download_url)} target="_blank" rel="noopener noreferrer"><span className="dl-cta-arrow" aria-hidden="true">↓</span> &nbsp; Télécharger pour {OS_LABEL[os]}</a> : state === 'error' ? <span className="dl-cta-main dl-cta-wait" aria-disabled="true">Releases injoignables</span> : state === 'ok' ? <span className="dl-cta-main dl-cta-wait" aria-disabled="true">Aucun binaire pour {OS_LABEL[os]}</span> : <span className="dl-cta-main dl-cta-wait" aria-disabled="true">Chargement…</span>}
                  <a className="dl-cta-ghost" href="#assets">Autres fichiers <span className="dl-cta-arrow" aria-hidden="true">↓</span></a>
                </div>
                <p className="dl-note">Choisissez un fichier adapté à votre système depuis les releases officielles.</p>
              </div>
              <div className="dl-ed-mark" aria-hidden="true"><div><img src="/atlas-icon-light.png" alt="" width="100" height="100" /></div><span>ATLAS · AU COMPTOIR</span></div>
            </div>
            <DownloadHeroVisual platform="desktop" />
            <ul className="dl-ed-facts">
              <li><b>Fenêtre dédiée</b><span>Votre espace Atlas sur ordinateur.</span></li>
              <li><b>Ventes &amp; stock</b><span>Les outils du comptoir réunis.</span></li>
              <li><b>Vos documents</b><span>Factures et rapports à consulter.</span></li>
              <li><b>Open source</b><span>Code et releases sur GitHub.</span></li>
            </ul>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="assets" aria-labelledby="desktop-download-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading"><p className="dl-ed-kicker">01 / TÉLÉCHARGER</p><h2 id="desktop-download-title">Bureau</h2><p>Choisissez votre système. Les fichiers proviennent de la dernière release publiée.</p><a href={`${DESKTOP_REPO}/releases`} target="_blank" rel="noopener noreferrer">Releases sur GitHub ↗</a></div>
            <div className="dl-ed-content">
              <div className="dl-ed-platforms" role="group" aria-label="Filtrer les fichiers par système">
                {([['all', 'Tous'], ['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux']] as const).map(([value, label]) => <button key={value} type="button" className="secondary" aria-pressed={assetFilter === value} onClick={() => setAssetFilter(value)}>{label}</button>)}
              </div>
              <div className="dl-ed-files" aria-live="polite">{visibleAssets.map((asset, i) => <div className="dl-ed-download-row" key={String(asset.name || i)}><div><strong>{String(asset.name || 'Fichier')}</strong><span>{/\.msi$|\.exe$/i.test(String(asset.name || '')) ? 'Windows' : /\.dmg$/i.test(String(asset.name || '')) ? 'macOS' : /appimage|linux|\.deb$|\.rpm$/i.test(String(asset.name || '')) ? 'Linux' : 'Autre fichier'}</span></div>{asset.browser_download_url && <a href={asset.browser_download_url} target="_blank" rel="noopener noreferrer">Télécharger ↗</a>}</div>)}{visibleAssets.length === 0 && <p className="dl-ed-hint">{state === 'load' ? 'Chargement des fichiers…' : 'Aucun fichier disponible pour cette sélection.'}</p>}</div>
              <div className="dl-stats" aria-label="Informations de version"><div className="dl-stat"><strong>{latest?.tag_name || '—'}</strong><span>Version</span></div><div className="dl-stat"><strong>{relDate || '—'}</strong><span>Publiée le</span></div><div className="dl-stat"><strong>{latest ? (latest.assets?.length ?? 0) : '—'}</strong><span>Fichiers</span></div></div>
              <p className="dl-ed-hint">Windows : .msi / .exe · macOS : .dmg · Linux : AppImage. Consultez la release pour les autres fichiers.</p>
            </div>
          </div>
        </section>

        <section className="dl-ed-section dl-container" id="versions" aria-labelledby="desktop-versions-title">
          <div className="dl-ed-rail">
            <div className="dl-ed-heading"><p className="dl-ed-kicker">02 / MISES À JOUR</p><h2 id="desktop-versions-title">Versions</h2><p>Les dernières notes et publications du dépôt bureau.</p><a href={`${DESKTOP_REPO}/releases`} target="_blank" rel="noopener noreferrer">Toutes les releases ↗</a></div>
            <div className="dl-ed-content"><article className="dl-release"><p className="dl-release-label">Dernière release</p><h3>{relTitle}</h3><p className="dl-release-date">{relDate ? `Publiée le ${relDate}` : 'Date de publication indisponible'}</p>{relBody ? <div className="dl-md dl-release-body" dangerouslySetInnerHTML={{ __html: mdToHtml(relBody) }} /> : <p className="dl-release-body">Notes de version non publiées pour ce binaire.</p>}{latest?.html_url && <a className="dl-release-link" href={latest.html_url} target="_blank" rel="noopener noreferrer">Voir la release sur GitHub ↗</a>}</article>
              <ReleaseTimeline releases={rels} renderMarkdown={mdToHtml} />
            </div>
          </div>
        </section>
        <DownloadPreview platform="desktop" />
        <section className="dl-ed-section dl-container"><div className="dl-ed-rail"><div className="dl-ed-heading"><p className="dl-ed-kicker">04 / FONCTIONNALITÉS</p><h2>Pensée pour le comptoir.</h2><p>Retrouvez vos outils Atlas sur votre poste de travail.</p><GitHubStarButton repo="Etherealmber/atlas-commerce-desktop" /></div><div className="dl-feats">{FEATURES.map(f => <div key={f.title} className="dl-feat"><strong>{f.title}</strong><p>{f.text}</p></div>)}</div></div></section>
      </main>

      <footer className="dl-foot">
        <div className="dl-foot-inner">
          <div className="dl-foot-brand">
            <img src="/atlas-logo-dark.png" alt={APP_NAME} className="theme-logo-dark" width={117} height={38} style={{ height: 38, width: 117 }} />
            <img src="/atlas-logo-light.png" alt={APP_NAME} className="theme-logo-light" width={117} height={38} style={{ height: 38, width: 117 }} />
            <p>Application bureau de gestion commerciale : caisse, stock et facturation, dans une fenêtre native.</p>
          </div>
          <nav aria-label="Liens produit">
            <Link to="/">Accueil</Link>
            <Link to="/android">Android</Link>
            <Link to="/whats-new">Nouveautés</Link>
            <Link to="/support">Support</Link>
            <Link to="/about">À propos</Link>
            <Link to="/privacy">Confidentialité</Link>
            <Link to="/login">Se connecter</Link>
          </nav>
        </div>
        <div className="dl-foot-bottom">
          <span>© {new Date().getFullYear()} {APP_NAME} — tous droits réservés</span>
          <span>{latest?.tag_name || APP_BUILD_DATE}</span>
        </div>
      </footer>
    </div>
  );
}
