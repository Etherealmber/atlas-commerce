/**
 * Desktop — page de téléchargement de l'application bureau (v0.7.3).
 *
 * Même gabarit standalone que /download (classes `dl-*`, responsive, thèmes) :
 * releases lues depuis GitHub Releases du dépôt atlas-commerce-desktop
 * (Windows .msi/.exe, macOS .dmg, Linux .AppImage), détection de l'OS du
 * visiteur pour le bouton principal, notes de version et historique.
 * Ni topbar, ni cookie, ni session : lecture libre, connecté ou non.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicNav, PublicSessionCta, GitHubStarButton } from '../components/PublicChrome';
import { APP_BUILD_DATE, APP_GITHUB, APP_NAME } from '../version';

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
  const has = (re: RegExp) => assets.find((a) => re.test(String(a.name || ''))) || null;
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
  const [rels, setRels] = useState<GhRelease[]>([]);
  const [state, setState] = useState<'load' | 'ok' | 'error'>('load');
  const [os, setOs] = useState<OsKey>('windows');

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
  const relDate = latest?.published_at ? String(latest.published_at).slice(0, 10) : APP_BUILD_DATE;
  const mainAsset = osAsset(latest, os);
  const otherOs = (['windows', 'macos', 'linux'] as OsKey[]).filter((k) => k !== os);

  return (
    <div className="download-landing desktop-landing">
      <PublicNav
        links={[
          { href: '/', label: 'Accueil' },
          { href: '/android', label: 'Android' },
          { href: '#assets', label: 'Téléchargements' },
          { href: '/whats-new', label: 'Nouveautés' },
          { href: '/privacy', label: 'Confidentialité' },
          { href: '/about', label: 'À propos' },
        ]}
        cta={<PublicSessionCta />}
      />

      <section className="dl-hero">
        <div className="dl-hero-bg" aria-hidden />
        <div className="dl-hero-grid" aria-hidden />
        <div className="dl-container">
          <div className="dl-hero-content">
            <p className="dl-eyebrow">Application bureau officielle</p>
            <h1 className="dl-h1">
              Atlas Commerce
              <br />
              <span className="dl-h1-soft">sur votre ordinateur.</span>
            </h1>
            <p className="dl-desc">
              La version bureau d&apos;{APP_NAME} : une fenêtre native pour tenir la caisse au clavier,
              imprimer sur votre imprimante système et garder l&apos;ERP ouvert toute la journée —
              Windows, macOS et Linux.
            </p>
            <div className="dl-ctas">
              {state === 'ok' && mainAsset ? (
                <a className="dl-cta-main" href={String(mainAsset.browser_download_url)} target="_blank" rel="noopener noreferrer">
                  Télécharger pour {OS_LABEL[os]}
                </a>
              ) : state === 'error' ? (
                <span className="dl-cta-main dl-cta-wait" aria-disabled="true">Releases injoignables</span>
              ) : (
                <span className="dl-cta-main dl-cta-wait" aria-disabled="true">Chargement…</span>
              )}
              {otherOs.map((k) => {
                const a = osAsset(latest, k);
                return a ? (
                  <a key={k} className="dl-cta-ghost" href={String(a.browser_download_url)} target="_blank" rel="noopener noreferrer">
                    {OS_LABEL[k]}
                  </a>
                ) : null;
              })}
              <a className="dl-cta-ghost" href={DESKTOP_REPO} target="_blank" rel="noopener noreferrer">
                Dépôt & code source
              </a>
              <GitHubStarButton repo="Etherealmber/atlas-commerce-desktop" />
            </div>
            <p className="dl-note">
              <span className="dl-note-dot" aria-hidden />
              Binaires signés et publiés automatiquement par GitHub Actions — téléchargez-les uniquement
              depuis cette page ou le dépôt officiel.
            </p>
          </div>
        </div>
      </section>

      <section className="dl-band">
        <div className="dl-container">
          <div className="dl-stats" aria-label="Informations de version">
            <div className="dl-stat">
              <strong>{latest?.tag_name || '…'}</strong>
              <span>Version</span>
            </div>
            <div className="dl-stat">
              <strong>{relDate}</strong>
              <span>Publiée le</span>
            </div>
            <div className="dl-stat">
              <strong>{latest?.assets?.length || 0}</strong>
              <span>Fichiers</span>
            </div>
          </div>

          <h2 className="dl-sec-title">Pensée pour le comptoir</h2>
          <p className="dl-sec-sub">Une app de poste fixe, rapide et sobre, branchée sur votre compte Atlas.</p>
          <div className="dl-feats">
            {FEATURES.map((f) => (
              <div key={f.title} className="dl-feat">
                <strong>{f.title}</strong>
                <p>{f.text}</p>
              </div>
            ))}
          </div>

          <h2 className="dl-sec-title" style={{ marginTop: 56 }}>Fichiers de la dernière version</h2>
          <p className="dl-sec-sub">Choisissez selon votre système — checksums et .zsync disponibles sur la release.</p>
          <div className="dl-rel-list">
            {(latest?.assets || [])
              .filter((a) => !/\.zsync$|source\.tar\.gz$/i.test(String(a.name || '')))
              .map((a, i) => (
                <div key={String(a.name || i)} className="dl-rel-row">
                  <strong>{String(a.name)}</strong>
                  <span className="dl-muted">
                    {/\.msi$|setup\.exe$|\.zip$/i.test(String(a.name || ''))
                      ? 'Windows'
                      : /\.dmg$/i.test(String(a.name || ''))
                        ? 'macOS'
                        : /AppImage|linux/i.test(String(a.name || ''))
                          ? 'Linux'
                          : '—'}
                  </span>
                  <a href={String(a.browser_download_url)} target="_blank" rel="noopener noreferrer">Télécharger</a>
                </div>
              ))}
            {(latest?.assets || []).length === 0 && (
              <p className="dl-muted" style={{ margin: 0 }}>Fichiers indisponibles pour le moment.</p>
            )}
          </div>

          <h2 className="dl-sec-title" style={{ marginTop: 56 }}>Notes de version</h2>
          <p className="dl-sec-sub">Dernière publication du dépôt bureau sur GitHub Releases.</p>
          <div className="dl-release">
            <h3>{relTitle}</h3>
            <p className="dl-release-date">{relDate}</p>
            {relBody ? (
              <div className="dl-md dl-release-body" dangerouslySetInnerHTML={{ __html: mdToHtml(relBody) }} />
            ) : (
              <p className="dl-release-body">Notes de version non publiées pour ce binaire.</p>
            )}
            {latest?.html_url ? (
              <a className="dl-release-link" href={latest.html_url} target="_blank" rel="noopener noreferrer">
                Voir la release sur GitHub
              </a>
            ) : null}
          </div>

          <h2 className="dl-sec-title" id="assets" style={{ marginTop: 56 }}>Toutes les versions</h2>
          <p className="dl-sec-sub">Historique complet, mis à jour automatiquement depuis GitHub Releases.</p>
          <div className="dl-rel-list">
            {rels.map((r, i) => (
              <div key={String(r.tag_name || r.name || i)} className="dl-rel-row">
                <strong>{r.name || r.tag_name}</strong>
                <span className="dl-muted">{String(r.published_at || '').slice(0, 10)}</span>
                {r.html_url ? (
                  <a href={r.html_url} target="_blank" rel="noopener noreferrer">Voir</a>
                ) : null}
              </div>
            ))}
            {rels.length === 0 && (
              <p className="dl-muted" style={{ margin: 0 }}>Historique indisponible pour le moment.</p>
            )}
          </div>

          <ul className="dl-tech">
            <li>
              Dépôt :{' '}
              <a href={DESKTOP_REPO} target="_blank" rel="noopener noreferrer">atlas-commerce-desktop</a>{' '}
              <span className="dl-muted">· Rust / Tauri, empaquetage GitHub Actions</span>
            </li>
            <li>
              Famille :{' '}
              <a href={APP_GITHUB} target="_blank" rel="noopener noreferrer">atlas-commerce</a>{' '}
              <span className="dl-muted">·</span>{' '}
              <a href="https://github.com/Etherealmber/atlas-commerce-android" target="_blank" rel="noopener noreferrer">atlas-commerce-android</a>
            </li>
            <li>
              Licence : <span className="dl-muted">MIT © 2026 Etherealmber</span>
            </li>
            <li>
              Installation : <span className="dl-muted">Windows → .msi · macOS → .dmg (Gatekeeper : ouvrir une fois) · Linux → AppImage (chmod +x)</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="dl-cta-sec">
        <div className="dl-container" style={{ position: 'relative', zIndex: 2 }}>
          <h2>Le comptoir, version poste fixe</h2>
          <p>Installez l&apos;app bureau, connectez-vous avec le QR du web ou votre OTP, et encaissez sans ouvrir le navigateur.</p>
          <div className="dl-ctas" style={{ justifyContent: 'center' }}>
            {mainAsset ? (
              <a className="dl-cta-main" href={String(mainAsset.browser_download_url)} target="_blank" rel="noopener noreferrer">
                Télécharger pour {OS_LABEL[os]}
              </a>
            ) : (
              <a className="dl-cta-main" href={`${DESKTOP_REPO}/releases`} target="_blank" rel="noopener noreferrer">
                Voir les releases
              </a>
            )}
            <Link className="dl-cta-ghost" to="/android">Apk Android</Link>
            <Link className="dl-cta-ghost" to="/whats-new">Nouveautés</Link>
          </div>
        </div>
      </section>

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
