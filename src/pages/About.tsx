/**
 * About — Dashboard Bento redesign: product identity, metrics, support/infra,
 * bug reporting, capabilities, creator & GitHub showcase, contributors.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Bot,
  Boxes,
  Bug,
  Building2,
  Cloud,
  ExternalLink,
  FileText,
  Github,
  Heart,
  LifeBuoy,
  Package,
  Receipt,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  APP_CREATOR,
  APP_CREATOR_NAME,
  APP_TEAM,
  APP_GITHUB,
  APP_TEAM_GITHUB,
  APP_INSTAGRAM,
  APP_DESCRIPTION,
} from '../version';
import { api } from '../api';
import { isLoggedIn } from '../auth';
import { REPO_CONTRIBUTORS, fetchRepoContributors, type Contributor } from '../lib/contributors';

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
    repo: 'atlas-commerce',
    title: 'atlas-commerce',
    href: 'https://github.com/Etherealmber/atlas-commerce',
    blurb: 'Application web, API Edge Cloudflare Workers et moteur financier WebAssembly.',
    badge: 'GitHub',
  },
  {
    repo: 'atlas-commerce-android',
    title: 'atlas-commerce-android',
    href: 'https://github.com/Etherealmber/atlas-commerce-android',
    blurb: 'Application Android native (Kotlin) : WebView, scan QR, notifications.',
    badge: 'GitHub',
  },
  {
    repo: 'atlas-commerce-desktop',
    title: 'atlas-commerce-desktop',
    href: 'https://github.com/Etherealmber/atlas-commerce-desktop',
    blurb: 'Client bureau Tauri : Windows, macOS, Linux.',
    badge: 'GitHub',
  },
];

const FEATURE_TILES = [
  {
    icon: Package,
    title: 'Stock & entrepôt',
    body: 'Produits, catégories, mouvements, alertes stock bas, images R2, historique 90 jours, transferts et règles auto.',
  },
  {
    icon: Receipt,
    title: 'Ventes (FA / VR / devis)',
    body: 'Factures, ventes rapides, devis convertibles, paiements partiels, numérotation atomique et archivage PDF / R2.',
  },
  {
    icon: Boxes,
    title: 'Achats & fournisseurs',
    body: 'Factures d’achat, réceptions, fournisseurs, suivi des impayés et impact stock à la réception.',
  },
  {
    icon: Users,
    title: 'Clients & crédit',
    body: 'Fiches clients, ICE, soldes, plafonds de crédit, situation client et relances.',
  },
  {
    icon: Wallet,
    title: 'Solde & trésorerie',
    body: 'Caisse / banque, dépenses et recettes, salaires employés, remboursements et exports quotidiens.',
  },
  {
    icon: Building2,
    title: 'Employés & paie',
    body: 'Fiches collaborateur, salaire mensuel ou périodique, pièce d’identité chiffrée et débit solde.',
  },
  {
    icon: Bug,
    title: 'Signalements & crashs',
    body: 'Détection automatique des erreurs et signalements envoyés directement dans les issues GitHub.',
  },
  {
    icon: Bot,
    title: 'Atlas Agent',
    body: 'Assistant intégré pour créer clients, produits ou documents, interroger le stock et accélérer les tâches.',
  },
  {
    icon: ShieldCheck,
    title: 'Sécurité',
    body: 'Rôles, OTP nouvel appareil, WebAuthn, confirmation mot de passe, audit et sauvegardes chiffrées.',
  },
  {
    icon: FileText,
    title: 'Conformité & TVA',
    body: 'HT/TTC, TVA, mentions légales, numéros séquentiels, préparation e-facturation UBL et archives.',
  },
  {
    icon: Smartphone,
    title: 'Mobile & caisse',
    body: 'Parcours téléphone, vente rapide, tickets, reçus et workflows terrain pour l’équipe magasin.',
  },
  {
    icon: BarChart3,
    title: 'Rapports',
    body: 'Tableaux de bord, ventes, stock, créances et exports pour piloter sans tableur parallèle.',
  },
];

function ReportProblemForm() {
  const canReport = isLoggedIn();
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const text = message.trim();
    if (text.length < 5) {
      setErr('Décrivez le problème en quelques mots (5 caractères minimum).');
      return;
    }
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const res = await api.submitUserReport({
        kind,
        message: text,
        contact: contact.trim() || undefined,
        page: typeof location !== 'undefined' ? location.pathname : '',
        version: APP_VERSION,
      });
      const ref = res?.data?.reference || 'OK';
      setDone(`Merci ! Signalement envoyé — référence ${ref}. Il arrive dans les issues GitHub du projet.`);
      setMessage('');
      setContact('');
    } catch (e: any) {
      setErr(String(e?.message || 'Envoi impossible. Réessayez ou contactez le support.'));
    } finally {
      setBusy(false);
    }
  }

  if (!canReport) return null;
  return (
    <section className="ac-panel ac-about-panel" id="signaler">
      <div className="ac-panel-head">
        <div>
          <h2>Signaler un problème</h2>
          <span className="ac-panel-sub">
            Bug, idée ou question envoyé directement dans les issues GitHub du projet (sans compte requis).
          </span>
        </div>
        <span className="ac-status-pill">
          <Bug size={13} strokeWidth={2} aria-hidden="true" />
          Feedback direct
        </span>
      </div>

      <div className="ac-about-kind-pills">
        {[
          ['bug', 'Bug'],
          ['feedback', 'Idée / amélioration'],
          ['other', 'Autre'],
        ].map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`ac-seg-btn${kind === v ? ' active' : ''}`}
            aria-pressed={kind === v}
            onClick={() => setKind(v)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ac-bento-stack">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Décrivez le problème : ce que vous faisiez, ce qui s’est passé, ce que vous attendiez…"
          maxLength={2000}
          rows={4}
        />
        <div className="ac-about-report-row">
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Contact (facultatif — email ou téléphone)"
            maxLength={120}
          />
          <button type="button" className="primary" disabled={busy} onClick={submit}>
            {busy ? 'Envoi…' : 'Envoyer le signalement'}
          </button>
        </div>
        {err && <p className="ac-about-msg ac-about-msg--err">{err}</p>}
        {done && <p className="ac-about-msg ac-about-msg--ok">{done}</p>}
      </div>
    </section>
  );
}

export default function About() {
  const [year] = useState(() => new Date().getFullYear());
  const [user, setUser] = useState<GhUser | null>(null);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [contributors, setContributors] = useState<Contributor[]>(REPO_CONTRIBUTORS);
  const [ghProfile, setGhProfile] = useState<{ followers: number; repos: number; stars: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchRepoContributors().then((list) => {
      if (alive) setContributors(list);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        let u: GhUser | null = null;
        let r: GhRepo[] = [];
        const proxied = await fetch('/api/public/github-profile');
        if (proxied.ok) {
          const json = (await proxied.json()) as {
            success?: boolean;
            data?: { user?: GhUser; repos?: GhRepo[] };
          };
          if (json?.success && json.data?.user) {
            u = json.data.user as GhUser;
            r = (json.data.repos || []) as GhRepo[];
          }
        }
        if (!u) {
          const [uRes, rRes] = await Promise.all([
            fetch(`https://api.github.com/users/${APP_CREATOR}`, {
              headers: { Accept: 'application/vnd.github+json' },
            }),
            fetch(`https://api.github.com/users/${APP_CREATOR}/repos?sort=updated&per_page=20`, {
              headers: { Accept: 'application/vnd.github+json' },
            }),
          ]);
          if (!uRes.ok || !rRes.ok) throw new Error('GitHub indisponible');
          u = (await uRes.json()) as GhUser;
          r = ((await rRes.json()) as GhRepo[]) || [];
        }
        if (stopped || !u) return;
        setUser(u);
        setRepos((r || []).filter((x) => !x.fork));
      } catch {
        /* static showcase remains */
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`https://api.github.com/users/${APP_CREATOR}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!r.ok) return;
        const j: any = await r.json();
        const reposRes = await fetch(`https://api.github.com/users/${APP_CREATOR}/repos?per_page=100`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        let stars = 0;
        if (reposRes.ok) {
          const list: any[] = await reposRes.json();
          stars = list.reduce((acc, x) => acc + Number(x?.stargazers_count || 0), 0);
        }
        if (alive) {
          setGhProfile({
            followers: Number(j?.followers || 0),
            repos: Number(j?.public_repos || 0),
            stars,
          });
        }
      } catch { /* best-effort */ }
    })();
    return () => { alive = false; };
  }, []);

  const byName = Object.fromEntries(repos.map((r) => [r.name, r]));

  return (
    <div className="atlas-page about-page ac-dash ac-about-bento">
      {/* Bento Hero — matches Dashboard ac-dash-hero */}
      <header className="ac-dash-hero" id="about-overview">
        <div className="ac-dash-hero-text">
          <p className="ac-dash-eyebrow">
            <span>À propos · v{APP_VERSION}</span>
          </p>
          <h1>{APP_NAME}</h1>
          <p className="ac-dash-lead">
            {APP_TAGLINE}. {APP_DESCRIPTION}
          </p>
          <div className="ac-about-chips" aria-label="Technologies">
            {['Cloudflare Workers', 'D1 SQLite', 'R2 Storage', 'Durable Objects', 'WebAuthn'].map((tech) => (
              <span key={tech} className="about-trust-chip">
                {tech}
              </span>
            ))}
          </div>
        </div>
        <div className="ac-dash-hero-side">
          <Link to="/whats-new" className="secondary ac-about-pill-btn">
            <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
            Voir les nouveautés
          </Link>
        </div>
      </header>

      {/* Bento 4-Metric Row */}
      <section className="ac-metric-grid" aria-label="Repères produit">
        <article className="ac-metric">
          <span className="ac-metric-label">Version active</span>
          <strong className="ac-metric-val">v{APP_VERSION}</strong>
          <span className="ac-metric-meta">Atlas Commerce ERP</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Modules métier</span>
          <strong className="ac-metric-val">{FEATURE_TILES.length}</strong>
          <span className="ac-metric-meta">Stock · Ventes · Finance · Mobile</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Infrastructure</span>
          <strong className="ac-metric-val">Edge · D1 · R2</strong>
          <span className="ac-metric-meta">Hébergé sur votre compte Cloudflare</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Contributeurs</span>
          <strong className="ac-metric-val">{contributors.length}</strong>
          <span className="ac-metric-meta">{ghProfile ? `${ghProfile.repos} dépôts publics` : 'Open ecosystem'}</span>
        </article>
      </section>

      {/* Support & Hosting Bento Pair */}
      <div className="ac-bento-grid-2">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Support &amp; accompagnement</h2>
              <span className="ac-panel-sub">Accès, configuration ou question produit</span>
            </div>
            <span className="ac-status-pill">
              <LifeBuoy size={13} strokeWidth={2} aria-hidden="true" />
              Support
            </span>
          </div>
          <ul className="ac-about-kv-list">
            <li>
              <span className="muted">Portail</span>
              <Link to="/support">Support {APP_NAME}</Link>
            </li>
            <li>
              <span className="muted">Tickets</span>
              <a href="https://github.com/Etherealmber/atlas-commerce/issues" target="_blank" rel="noreferrer">
                GitHub Issues <ExternalLink size={12} aria-hidden="true" />
              </a>
            </li>
            <li>
              <span className="muted">Éditeur</span>
              <a href={APP_GITHUB} target="_blank" rel="noreferrer">
                {APP_CREATOR_NAME} <ExternalLink size={12} aria-hidden="true" />
              </a>
            </li>
          </ul>
        </section>

        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Hébergement &amp; souveraineté</h2>
              <span className="ac-panel-sub">Vos données restent sur votre instance Cloudflare</span>
            </div>
            <span className="ac-status-pill">
              <Cloud size={13} strokeWidth={2} aria-hidden="true" />
              Cloudflare
            </span>
          </div>
          <ul className="ac-about-kv-list">
            <li>
              <span className="muted">Workers</span>
              <span>Application &amp; API Edge</span>
            </li>
            <li>
              <span className="muted">D1 SQLite</span>
              <span>Base transactionnelle métier</span>
            </li>
            <li>
              <span className="muted">R2 Storage</span>
              <span>PDF, pièces jointes &amp; sauvegardes</span>
            </li>
            <li>
              <span className="muted">WebAuthn</span>
              <span>Passkeys &amp; OTP nouvel appareil</span>
            </li>
          </ul>
        </section>
      </div>

      {/* Bug Report Bento Panel */}
      <ReportProblemForm />

      {/* Features Bento Grid */}
      <section className="ac-panel" id="about-features">
        <div className="ac-panel-head">
          <div>
            <h2>Ce que fait Atlas Commerce</h2>
            <span className="ac-panel-sub">
              Stock, ventes, achats, caisse et conformité dans un seul outil rapide.
            </span>
          </div>
          <span className="ac-status-pill">
            <Boxes size={13} strokeWidth={2} aria-hidden="true" />
            {FEATURE_TILES.length} capacités
          </span>
        </div>
        <div className="ac-about-features-grid">
          {FEATURE_TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <div key={tile.title} className="ac-about-feature-tile">
                <div className="ac-about-feature-tile-head">
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <h3>{tile.title}</h3>
                </div>
                <p>{tile.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Audience & Highlights Bento Pair */}
      <div className="ac-bento-grid-2">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Pour qui</h2>
              <span className="ac-panel-sub">Chaque profil dispose d’un périmètre clair</span>
            </div>
          </div>
          <ul className="ac-about-bullets">
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

        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Fonctions clés</h2>
              <span className="ac-panel-sub">Flux opérationnels de bout en bout</span>
            </div>
          </div>
          <ul className="ac-about-bullets">
            <li>
              <strong>Stock</strong> — produits, seuils, entrepôts, inventaire mobile, photos et lots.
            </li>
            <li>
              <strong>Vente</strong> — vente rapide, devis, factures, reçus, impression thermique.
            </li>
            <li>
              <strong>Équipe &amp; Conformité</strong> — boîte d’actions PC ↔ téléphone, UBL local, sessions sécurisées.
            </li>
          </ul>
        </section>
      </div>

      {/* Creator & Contributors Bento Stack */}
      <div className="ac-bento-stack" id="about-creator">
        <section className="ac-panel about-owner">
          <div className="ac-panel-head">
            <div>
              <h2>Créateur</h2>
              <span className="ac-panel-sub">Développement produit &amp; infrastructure · {APP_CREATOR_NAME}</span>
            </div>
          </div>
          <div className="about-owner-head">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" width={56} height={56} className="about-owner-avatar" loading="lazy" decoding="async" />
            ) : (
              <div className="about-owner-avatar about-owner-avatar-ph" />
            )}
            <div className="about-owner-meta">
              <p className="about-owner-name">
                <strong>{APP_CREATOR_NAME}</strong>
                {' · '}
                <a href={APP_GITHUB} target="_blank" rel="noreferrer">
                  @{APP_CREATOR}
                </a>
              </p>
              {ghProfile && (
                <p className="ac-about-stats">
                  <span><strong>{ghProfile.followers}</strong> abonnés</span>
                  <span><strong>{ghProfile.repos}</strong> dépôts publics</span>
                  <span><strong>{ghProfile.stars}</strong> étoiles reçues</span>
                </p>
              )}
              <div className="ac-about-owner-actions">
                <a
                  className="secondary ac-about-pill-btn"
                  href={`https://github.com/${APP_CREATOR}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Github size={14} strokeWidth={2} aria-hidden="true" />
                  Profil GitHub
                </a>
                {APP_TEAM_GITHUB && (
                  <a
                    className="secondary ac-about-pill-btn"
                    href={`${APP_TEAM_GITHUB}?tab=repositories`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Dépôts {APP_TEAM}
                  </a>
                )}
                {APP_INSTAGRAM && (
                  <a className="secondary ac-about-pill-btn" href={APP_INSTAGRAM} target="_blank" rel="noreferrer">
                    Instagram
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="ac-panel wn-thanks-card" aria-label="Remerciements et contributeurs">
          <div className="ac-panel-head">
            <div>
              <h2>Remerciements &amp; contributeurs</h2>
              <span className="ac-panel-sub">Contributeurs aux commits et sorties d&apos;Atlas Commerce</span>
            </div>
            <span className="ac-status-pill">
              <Users size={13} strokeWidth={2} aria-hidden="true" />
              {contributors.length}
            </span>
          </div>
          <div className="wn-contributors">
            {contributors.map((c, idx) => (
              <a
                key={c.login}
                href={c.url}
                target="_blank"
                rel="noreferrer noopener"
                className="wn-contributor-pill"
                style={{ animationDelay: `${Math.min(idx * 45, 240)}ms` }}
                title={`${c.name} — ${c.role}`}
              >
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" />
                ) : (
                  <span className="wn-contributor-fallback" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="wn-contributor-name">{c.name !== c.login ? `${c.name} (${c.handle})` : c.handle}</span>
              </a>
            ))}
          </div>
          <div className="wn-release-contributors">
            <span className="wn-contributors-label">
              <Heart size={13} strokeWidth={2.2} aria-hidden="true" /> Merci à
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              chaque contributeur · voir le journal détaillé dans <Link to="/whats-new">Nouveautés</Link>
            </span>
          </div>
        </section>
      </div>

      {/* Projects Bento Grid */}
      <section className="ac-panel" id="about-projects">
        <div className="ac-panel-head">
          <div>
            <h2>Autour d’Atlas</h2>
            <span className="ac-panel-sub">Dépôts et applications compagnons — @{APP_CREATOR}</span>
          </div>
          <span className="ac-status-pill">
            <Github size={13} strokeWidth={2} aria-hidden="true" />
            Écosystème
          </span>
        </div>
        <ul className="ac-about-projects-grid">
          {PROJECT_SHOWCASE.map((p) => {
            const live = byName[p.repo];
            return (
              <li key={p.repo}>
                <a href={p.href} target="_blank" rel="noreferrer" className="ac-about-project-card">
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

      <footer className="about-foot">
        <span>
          © {year} {APP_NAME}
        </span>
        <span className="about-muted">Fait pour les commerces locaux · données sur votre instance</span>
      </footer>
    </div>
  );
}
