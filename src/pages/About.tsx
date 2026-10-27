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
  APP_BUILD_DATE,
  APP_CHANNEL,
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
import { api } from '../api';

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


/** v260 — "Signaler un problème" : user report → GitHub issue (docs/reports-github.md). */
function ReportProblemForm() {
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const text = message.trim();
    if (text.length < 5) { setErr('Décrivez le problème en quelques mots (5 caractères minimum).'); return; }
    setBusy(true); setErr(null); setDone(null);
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
      setMessage(''); setContact('');
    } catch (e: any) {
      setErr(String(e?.message || 'Envoi impossible. Réessayez ou contactez le support.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card about-section" id="signaler">
      <h2>Signaler un problème</h2>
      <p className="about-muted" style={{ marginTop: 0 }}>
        Bug, idée ou question : votre message est envoyé directement dans les <strong>issues GitHub</strong> du
        projet Atlas Commerce (sans compte GitHub nécessaire). Les plantages de l’application sont aussi
        signalés automatiquement — jamais de données personnelles ni de mots de passe dans ces rapports.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {[['bug', '🐛 Bug'], ['feedback', '💡 Idée / amélioration'], ['other', '❓ Autre']].map(([v, label]) => (
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
        <button type="button" className="primary" disabled={busy} onClick={submit} style={{ borderRadius: 12, minHeight: 44, padding: '0 20px' }}>
          {busy ? 'Envoi…' : 'Envoyer le signalement'}
        </button>
      </div>
      {err && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{err}</p>}
      {done && <p style={{ color: '#15803d', fontSize: 13, marginTop: 10 }}>{done}</p>}
    </section>
  );
}

export default function About() {
  const [year] = useState(() => new Date().getFullYear());
  const [user, setUser] = useState<GhUser | null>(null);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* title set by PageTitleSync */
  }, []);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        // Prefer same-origin proxy (CSP-safe). Fallback to GitHub API if allowed.
        let u: GhUser | null = null;
        let r: GhRepo[] = [];
        const proxied = await fetch('/api/public/github-profile');
        if (proxied.ok) {
          const json = await proxied.json();
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
    <div className="atlas-page about-page atlas-crm">
      {/* v0.7 — version + build date + changelog, visible even when public */}
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
            <p className="atlas-eyebrow" style={{ margin: 0 }}>
              Produit
            </p>
            <h1 className="about-title">{APP_NAME}</h1>
            <p className="about-tag">{APP_TAGLINE}</p>
          </div>
        </div>
        <p className="about-mission">
          Conçu pour les commerces et grossistes au Maroc — gérer stock, caisse et facturation
          sans dépendre d’un abonnement SaaS opaque.
        </p>
        <p className="about-lead">
          {APP_DESCRIPTION ||
            'Logiciel interne de stock, caisse et facturation pour commerces au Maroc.'}
        </p>

        <div className="about-trust-strip" aria-label="Technologies">
          <span className="about-trust-chip">Cloudflare</span>
          <span className="about-trust-chip">D1</span>
          <span className="about-trust-chip">R2</span>
          <span className="about-trust-chip">Durable Objects</span>
          <span className="about-trust-chip">WebAuthn</span>
        </div>

        <div className="about-meta-row">
        <div className="card about-version-card about-meta-card">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Version actuelle</strong>
              <span className="muted" style={{ fontSize: 14 }}>
                {APP_VERSION} · canal {APP_CHANNEL} · build {APP_BUILD_DATE}
                {APP_LOCATION ? ` · ${APP_LOCATION}` : ''}
              </span>
            </div>
            <Link to="/whats-new" className="secondary about-secondary-link">
              Voir les nouveautés
            </Link>
          </div>
        </div>

        <section className="card about-section about-support about-meta-card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Support</h2>
            <p className="about-muted" style={{ marginTop: 0, fontSize: 14 }}>
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
          </section>
          <section className="card about-section about-stack about-meta-card" style={{ margin: 0 }}>
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Hébergement</h2>
            <p className="about-muted" style={{ marginTop: 0, fontSize: 14 }}>
              Vos données restent sur votre compte Cloudflare (Workers, base, fichiers).
            </p>
            <ul className="about-stack-list">
              <li>Workers — application & API</li>
              <li>D1 — données métier</li>
              <li>R2 — pièces jointes & sauvegardes</li>
              <li>Passkeys (WebAuthn) en option</li>
            </ul>
          </section>
        </div>
      </header>

      <ReportProblemForm />

      <section className="card about-section">
        <h2>Ce que fait Atlas Commerce</h2>
        <p className="about-muted" style={{ marginTop: 0 }}>
          Logiciel de gestion pour commerces et grossistes au Maroc — stock, ventes, achats, caisse et conformité,
          hébergé sous votre contrôle (Cloudflare), sans abonnement SaaS obligatoire.
        </p>
        <div className="about-features-grid">
          <div className="about-feature">
            <h3>Stock & entrepôt</h3>
            <p>Produits, catégories, mouvements, alertes stock bas, images R2, historique 90 jours, transferts et règles auto.</p>
          </div>
          <div className="about-feature">
            <h3>Ventes (FA / VR / devis)</h3>
            <p>Factures, ventes rapides, devis convertibles, paiements partiels, numérotation atomique, archivage PDF / R2.</p>
          </div>
          <div className="about-feature">
            <h3>Achats & fournisseurs</h3>
            <p>Factures d’achat, réceptions, fournisseurs, suivi des impayés et impact stock à la réception.</p>
          </div>
          <div className="about-feature">
            <h3>Clients & crédit</h3>
            <p>Fiches clients, ICE, soldes, plafonds de crédit, situation client et relances.</p>
          </div>
          <div className="about-feature">
            <h3>Solde & trésorerie</h3>
            <p>Caisse / banque, dépenses et recettes, salaires employés, remboursement, export pour le suivi quotidien.</p>
          </div>
          <div className="about-feature">
            <h3>Employés & paie</h3>
            <p>Fiches collaborateur, salaire mensuel ou tous les N jours, démission, pièce d’identité chiffrée, débit solde à chaque paiement.</p>
          </div>
          <div className="about-feature">
            <h3>Signalements & crashs</h3>
            <p>Un bug ? L’application le détecte et le signale automatiquement. Vous pouvez aussi envoyer un signalement qui arrive directement dans les issues GitHub du projet.</p>
          </div>
          <div className="about-feature">
            <h3>Atlas Agent</h3>
            <p>Assistant intégré pour créer clients, produits ou documents, interroger le stock et accélérer les tâches répétitives.</p>
          </div>
          <div className="about-feature">
            <h3>Sécurité</h3>
            <p>Rôles, OTP nouvel appareil, WebAuthn, confirmation mot de passe sur suppressions, audit, sauvegardes chiffrées.</p>
          </div>
          <div className="about-feature">
            <h3>Maroc</h3>
            <p>HT/TTC, TVA, mentions légales, numéros séquentiels, préparation e-facturation / UBL et archives longue durée.</p>
          </div>
          <div className="about-feature">
            <h3>Mobile & caisse</h3>
            <p>Parcours téléphone, vente rapide, tickets, reçus et workflows terrain pour l’équipe magasin.</p>
          </div>
          <div className="about-feature">
            <h3>Rapports</h3>
            <p>Tableaux de bord, ventes, stock, créances, exports — pour piloter sans tableur parallèle.</p>
          </div>
        </div>
      </section>

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
            <img src={user.avatar_url} alt="" width={56} height={56} className="about-owner-avatar" loading="lazy" decoding="async" />
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
      <section className="card about-section about-secondary">
        <h2>Autour d’Atlas</h2>
        <p className="about-muted" style={{ marginBottom: 12 }}>
          Projets et dépôts publics (secondaire) — @{APP_CREATOR}.
        </p>
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

            <section className="card about-section about-legal-hint">
        <h2>Liens & confidentialité</h2>
        <p className="about-muted" style={{ margin: 0 }}>
          Confidentialité, conditions, cookies, nouveautés et guide — icônes dans la barre du haut.
        </p>
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
