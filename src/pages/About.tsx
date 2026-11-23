/**
 * About — product identity + owner GitHub showcase + contributors + legal links.
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
  APP_LOCATION,
  APP_DESCRIPTION,
  APP_PROFILE,
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
    repo: 'afmarbre-main',
    title: 'afmarbre-main',
    href: 'https://github.com/Etherealmber/afmarbre-main',
    blurb: 'Vitrine & infrastructure afmarbre.com.',
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
    title: 'Conformité Maroc',
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
    <section className="card about-section ac-about-card" id="signaler">
      <div className="ac-about-card-head">
        <span className="ac-about-card-ico" aria-hidden="true">
          <Bug size={18} strokeWidth={2} />
        </span>
        <h2>Signaler un problème</h2>
      </div>
      <p className="about-muted" style={{ marginTop: 0 }}>
        Bug, idée ou question : votre message est envoyé directement dans les <strong>issues GitHub</strong> du
        projet Atlas Commerce (sans compte GitHub nécessaire). Les plantages sont signalés automatiquement sans
        données personnelles ni mots de passe.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {[
          ['bug', 'Bug'],
          ['feedback', 'Idée / amélioration'],
          ['other', 'Autre'],
        ].map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={kind === v ? 'primary' : 'secondary'}
            style={{ borderRadius: 999, padding: '6px 14px', fontSize: 13 }}
            onClick={() => setKind(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Décrivez le problème : ce que vous faisiez, ce qui s’est passé, ce que vous attendiez…"
        maxLength={2000}
        rows={4}
        style={{ width: '100%', borderRadius: 12, padding: 12, fontSize: 14, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Contact (facultatif — email ou téléphone)"
          maxLength={120}
          style={{ flex: '1 1 220px', borderRadius: 12, padding: '10px 12px', fontSize: 13 }}
        />
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={submit}
          style={{ borderRadius: 12, minHeight: 44, padding: '0 20px' }}
        >
          {busy ? 'Envoi…' : 'Envoyer le signalement'}
        </button>
      </div>
      {err && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 10 }}>{err}</p>}
      {done && <p style={{ color: '#22c55e', fontSize: 13, marginTop: 10 }}>{done}</p>}
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
    <div className="atlas-page about-page ac-about-bento atlas-crm">
      <header className="ac-about-hero-card" id="about-overview">
        <div className="ac-about-hero-top">
          <div>
            <span className="ac-about-eyebrow">
              <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
              Produit
            </span>
            <h1 className="about-title">{APP_NAME}</h1>
            <p className="ac-about-tagline">{APP_TAGLINE}</p>
          </div>
          <span className="ac-about-version-pill">v{APP_VERSION}</span>
        </div>

        <p className="ac-about-mission">
          Conçu pour les commerces et grossistes au Maroc — gérer stock, caisse et facturation
          sans dépendre d’un abonnement SaaS opaque.{' '}
          {APP_DESCRIPTION || 'Logiciel interne de stock, caisse et facturation pour commerces au Maroc.'}
        </p>

        <div className="ac-about-chips" aria-label="Technologies">
          {['Cloudflare Workers', 'D1 SQLite', 'R2 Storage', 'Durable Objects', 'WebAuthn'].map((tech) => (
            <span key={tech} className="about-trust-chip">
              {tech}
            </span>
          ))}
        </div>

        <div className="ac-about-bento-pair">
          <div className="ac-about-subcard">
            <div className="ac-about-subcard-head">
              <LifeBuoy size={17} strokeWidth={2} aria-hidden="true" />
              <span>Support</span>
            </div>
            <p className="about-muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              Accès, configuration ou question produit — on répond côté métier, pas en jargon technique.
            </p>
            <ul className="about-stack-list">
              <li>
                <a href="https://support.afmarbre.com" target="_blank" rel="noreferrer">
                  Portail support
                </a>
              </li>
              <li>
                <a href="https://wa.me/212600000000" target="_blank" rel="noreferrer">
                  WhatsApp (à configurer)
                </a>
              </li>
              <li>
                <a href="mailto:support@afmarbre.com">support@afmarbre.com</a>
              </li>
            </ul>
          </div>

          <div className="ac-about-subcard">
            <div className="ac-about-subcard-head">
              <Cloud size={17} strokeWidth={2} aria-hidden="true" />
              <span>Hébergement</span>
            </div>
            <p className="about-muted" style={{ marginTop: 0, fontSize: 13.5 }}>
              Vos données restent sur votre compte Cloudflare (Workers, base, fichiers).
            </p>
            <ul className="about-stack-list">
              <li>Workers — application &amp; API</li>
              <li>D1 — données métier</li>
              <li>R2 — pièces jointes &amp; sauvegardes</li>
              <li>Passkeys (WebAuthn) en option</li>
            </ul>
          </div>
        </div>
      </header>

      <ReportProblemForm />

      <section className="card about-section ac-about-card" id="about-features">
        <div className="ac-about-card-head">
          <span className="ac-about-card-ico" aria-hidden="true">
            <Boxes size={18} strokeWidth={2} />
          </span>
          <h2>Ce que fait Atlas Commerce</h2>
        </div>
        <p className="about-muted" style={{ marginTop: 0 }}>
          Stock, ventes, achats, caisse et conformité dans un seul outil rapide, hébergé sous votre contrôle.
        </p>
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

      <div className="ac-about-bento-pair" style={{ marginTop: 0 }}>
        <section className="card about-section ac-about-card">
          <h2>Pour qui</h2>
          <ul className="about-list" style={{ marginBottom: 0 }}>
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

        <section className="card about-section ac-about-card">
          <h2>Fonctions clés</h2>
          <ul className="about-list" style={{ marginBottom: 0 }}>
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

      {/* Owner — GitHub profile */}
      <section className="card about-section ac-about-card about-owner" id="about-creator">
        <div className="about-owner-head">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" width={56} height={56} className="about-owner-avatar" loading="lazy" decoding="async" />
          ) : (
            <div className="about-owner-avatar about-owner-avatar-ph" />
          )}
          <div className="about-owner-meta">
            <h2>Créateur</h2>
            <p className="about-owner-name">
              <strong>{APP_CREATOR_NAME}</strong>
              {' · '}
              <a href={APP_GITHUB} target="_blank" rel="noreferrer">
                @{APP_CREATOR}
              </a>
            </p>
            <p className="about-muted about-owner-bio">
              Développement produit &amp; infrastructure · {APP_LOCATION}
            </p>
            {ghProfile && (
              <p className="about-owner-stats" style={{ display: 'flex', gap: 14, margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted, #52525b)' }}>
                <span><strong>{ghProfile.followers}</strong> abonnés</span>
                <span><strong>{ghProfile.repos}</strong> dépôts publics</span>
                <span><strong>{ghProfile.stars}</strong> étoiles reçues</span>
              </p>
            )}
            <p style={{ margin: '10px 0 0' }}>
              <a
                className="about-owner-ghbtn"
                href={`https://github.com/${APP_CREATOR}`}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: '1px solid var(--line, #e4e4e7)',
                  color: 'inherit',
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <Github size={15} strokeWidth={1.9} aria-hidden="true" />
                Profil GitHub
              </a>
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

      {/* Contributors & thanks */}
      <section className="card about-section ac-about-card wn-thanks-card" aria-label="Remerciements et contributeurs">
        <div className="wn-thanks-head">
          <span className="wn-thanks-ico" aria-hidden="true">
            <Users size={16} strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="wn-thanks-title">Remerciements &amp; contributeurs</h2>
            <p className="wn-thanks-sub">
              Merci aux contributeurs qui participent aux commits et aux sorties d&apos;Atlas Commerce :
            </p>
          </div>
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
          <span className="wn-contributors-label"><Heart size={13} strokeWidth={2.2} aria-hidden="true" /> Merci à</span>
          <span className="wn-thanks-sub" style={{ margin: 0 }}>chaque contributeur · voir le journal détaillé dans <Link to="/whats-new">Nouveautés</Link></span>
        </div>
      </section>

      {/* Projects */}
      <section className="card about-section ac-about-card about-secondary" id="about-projects">
        <div className="ac-about-card-head">
          <span className="ac-about-card-ico" aria-hidden="true">
            <Github size={18} strokeWidth={2} />
          </span>
          <h2>Autour d’Atlas</h2>
        </div>
        <p className="about-muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Dépôts et applications compagnons — @{APP_CREATOR}.
        </p>
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
