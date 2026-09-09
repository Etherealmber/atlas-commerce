/**
 * About — product identity + owner GitHub showcase + legal links.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  APP_BUILD,
  APP_CREATOR,
  APP_CREATOR_NAME,
  APP_TEAM,
  APP_GITHUB,
  APP_TEAM_GITHUB,
  APP_INSTAGRAM,
  APP_LOCATION,
  APP_DESCRIPTION,
  APP_PROFILE,
} from '../version';
import { openConsentSettings } from '../lib/cookieConsent';
import { resetWelcome } from '../lib/welcome';

type GhUser = {
  name: string | null;
  company: string | null;
  location: string | null;
  public_repos: number;
  avatar_url: string;
  bio: string | null;
  html_url: string;
};

type GhRepo = {
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
};

const PROJECT_SHOWCASE: {
  repo: string;
  title: string;
  href: string;
  blurb: string;
  badge?: string;
}[] = [
  {
    repo: 'ai-agent',
    title: 'Paul',
    href: 'https://chat.afmarbre.com',
    blurb: 'Agent IA privé sur Cloudflare — chat sur votre compte.',
    badge: 'Live',
  },
  {
    repo: 'support-page',
    title: 'Support',
    href: 'https://support.afmarbre.com',
    blurb: 'Page support clients.',
    badge: 'Live',
  },
  {
    repo: 'archi-convert',
    title: 'Archi Convert',
    href: 'https://github.com/loxdpsy/archi-convert',
    blurb: 'Unités et matériaux pour l’architecture.',
    badge: 'GitHub',
  },
  {
    repo: 'toolkit',
    title: 'Toolkit',
    href: 'https://github.com/loxdpsy/toolkit',
    blurb: 'Boîte à outils TypeScript.',
    badge: 'GitHub',
  },
];

export default function About() {
  const [year] = useState(() => new Date().getFullYear());
  const [user, setUser] = useState<GhUser | null>(null);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `À propos · ${APP_NAME}`;
  }, []);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const [uRes, rRes] = await Promise.all([
          fetch(`https://api.github.com/users/${APP_CREATOR}`, {
            headers: { Accept: 'application/vnd.github+json' },
          }),
          fetch(`https://api.github.com/users/${APP_CREATOR}/repos?sort=updated&per_page=20`, {
            headers: { Accept: 'application/vnd.github+json' },
          }),
        ]);
        if (!uRes.ok || !rRes.ok) throw new Error('GitHub indisponible');
        const u = (await uRes.json()) as GhUser;
        const r = (await rRes.json()) as GhRepo[];
        if (stopped) return;
        setUser(u);
        setRepos((r || []).filter((x) => !x.fork));
      } catch (e: any) {
        if (!stopped) setLoadErr(e?.message || 'Impossible de charger GitHub');
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  const byName = Object.fromEntries(repos.map((r) => [r.name, r]));

  return (
    <div className="atlas-page about-page">
      <header className="about-hero">
        <div className="about-hero-brand">
          <img src="/favicon.svg" alt="" width={48} height={48} className="about-logo" />
          <div>
            <p className="atlas-eyebrow" style={{ margin: 0 }}>
              Produit
            </p>
            <h1 className="about-title">{APP_NAME}</h1>
            <p className="about-tag">{APP_TAGLINE}</p>
          </div>
        </div>
        <p className="about-lead">
          {APP_DESCRIPTION ||
            'Logiciel interne de stock, caisse et facturation pour commerces au Maroc.'}
        </p>
        <div className="about-meta-row">
          <span className="about-pill">
            Version <strong>{APP_VERSION}</strong>
          </span>
          {APP_BUILD ? <span className="about-pill muted">Build {APP_BUILD}</span> : null}
          <span className="about-pill muted">{APP_LOCATION || 'Maroc'}</span>
        </div>
      </header>

      <section className="card about-section">
        <h2>Pour qui</h2>
        <ul className="about-list">
          <li>
            <strong>Magasin / dépôt</strong> — scan, inventaire, transferts, propositions produit.
          </li>
          <li>
            <strong>Bureau</strong> — devis, factures, caisse, boîte d’actions, rapports.
          </li>
          <li>
            <strong>Rôles</strong> — propriétaire, secrétaire, magasinier (sans accès argent).
          </li>
        </ul>
      </section>

      <section className="card about-section">
        <h2>Fonctions clés</h2>
        <div className="about-grid">
          <div>
            <h3>Stock</h3>
            <p>Produits, seuils, entrepôts, inventaire mobile, photos et lots.</p>
          </div>
          <div>
            <h3>Vente</h3>
            <p>Vente rapide, devis, factures, reçus, impression thermique.</p>
          </div>
          <div>
            <h3>Équipe</h3>
            <p>Boîte d’actions PC ↔ téléphone, Atlas Agent contextuel.</p>
          </div>
          <div>
            <h3>Conformité</h3>
            <p>UBL local, confidentialité, sessions sécurisées.</p>
          </div>
        </div>
      </section>

      {/* Owner — GitHub profile */}
      <section className="card about-section about-owner">
        <div className="about-owner-head">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" width={56} height={56} className="about-owner-avatar" />
          ) : (
            <div className="about-owner-avatar about-owner-avatar-ph" />
          )}
          <div className="about-owner-meta">
            <h2>Créateur</h2>
            <p className="about-owner-name">
              <strong>{user?.name || APP_CREATOR_NAME}</strong>
              {' · '}
              <a href={APP_GITHUB} target="_blank" rel="noreferrer">
                @{APP_CREATOR}
              </a>
            </p>
            <p className="about-muted about-owner-bio">
              {user?.bio || 'Développement produit & infrastructure.'}
              {user?.location ? ` · ${user.location}` : APP_LOCATION ? ` · ${APP_LOCATION}` : ''}
              {user?.public_repos != null ? ` · ${user.public_repos} dépôts` : ''}
            </p>
          </div>
        </div>
        <div className="about-links about-links-row">
          <a href={APP_GITHUB} target="_blank" rel="noreferrer">
            GitHub
          </a>
          {APP_PROFILE ? (
            <a href={APP_PROFILE} target="_blank" rel="noreferrer">
              Profil
            </a>
          ) : null}
          {APP_TEAM_GITHUB ? (
            <a href={APP_TEAM_GITHUB} target="_blank" rel="noreferrer">
              Équipe {APP_TEAM}
            </a>
          ) : null}
          {APP_INSTAGRAM ? (
            <a href={APP_INSTAGRAM} target="_blank" rel="noreferrer">
              Instagram
            </a>
          ) : null}
        </div>
      </section>

      {/* Projects */}
      <section className="card about-section">
        <h2>Projets</h2>
        <p className="about-muted" style={{ marginBottom: 12 }}>
          Sites live et dépôts publics de @{APP_CREATOR}.
        </p>
        {loading && <p className="about-muted">Sync GitHub…</p>}
        {loadErr && (
          <p className="about-muted" style={{ color: 'var(--bad, #c45c4a)' }}>
            {loadErr} — les liens ci-dessous restent valides.
          </p>
        )}
        <ul className="about-projects">
          {PROJECT_SHOWCASE.map((p) => {
            const live = byName[p.repo];
            return (
              <li key={p.repo}>
                <a href={p.href} target="_blank" rel="noreferrer" className="about-project-link">
                  <span className="about-project-title">
                    {p.title}
                    {p.badge ? <span className="about-project-badge">{p.badge}</span> : null}
                  </span>
                  <span className="about-project-blurb">{p.blurb}</span>
                  {live?.language ? (
                    <span className="about-project-lang">
                      {live.language}
                      {live.stargazers_count ? ` · ★ ${live.stargazers_count}` : ''}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card about-section">
        <h2>Liens & confidentialité</h2>
        <div className="about-links about-links-row">
          <Link to="/privacy">Politique de confidentialité</Link>
          {' · '}
          <Link to="/terms">Conditions d'utilisation</Link>
          <button type="button" className="linkish" onClick={() => openConsentSettings()}>
            Cookies
          </button>
          <button
            type="button"
            className="about-replay-guide"
            onClick={() => {
              resetWelcome();
              window.location.assign('/welcome');
            }}
          >
            Revoir le guide
          </button>
        </div>
      </section>

      <footer className="about-foot">
        <span>
          © {year} {APP_NAME}
        </span>
        <span className="about-muted">Fait pour les commerces locaux · données sur votre instance</span>
      </footer>
    </div>
  );
}
