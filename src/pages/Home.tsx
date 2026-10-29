/**
 * Home — accueil public de stock.afmarbre.com (v0.7.3).
 *
 * Présente le produit (web, Android, bureau), explique son usage pas à pas
 * et invite à forker les dépôts GitHub (projet MIT). Lecture libre, sans
 * compte, sans cookie, sans aucune redirection : le tableau de bord vit
 * désormais sur /dashboard et la connexion sur /login.
 *
 * Mise en page : mêmes classes `dl-*` que /download (responsive phone/PC,
 * thèmes clair/sombre déjà câblés via html[data-theme]) + animations
 * d'entrée respectueuses de prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getToken } from '../auth';
import { APP_CREATOR_NAME, APP_GITHUB, APP_NAME, APP_VERSION } from '../version';

const WEB_REPO = 'https://github.com/Etherealmber/atlas-commerce';
const ANDROID_REPO = 'https://github.com/Etherealmber/atlas-commerce-android';
const DESKTOP_REPO = 'https://github.com/Etherealmber/atlas-commerce-desktop';

const STEPS: { n: string; title: string; text: string }[] = [
  {
    n: '1',
    title: 'Créez votre espace',
    text: 'Un compte par commerce : utilisateurs, rôles (owner, admin, secrétaire, magasinier…) et dépôts multiples se paramètrent depuis les Réglages.',
  },
  {
    n: '2',
    title: 'Connectez-vous en sécurité',
    text: 'Mot de passe + code OTP par e-mail à chaque connexion, QR de connexion depuis l’app Android, passkeys WebAuthn et appareils révocables à tout moment.',
  },
  {
    n: '3',
    title: 'Vendez, encaissez, facturez',
    text: 'Caisse rapide sur PC ou téléphone, tickets VR imprimables, factures TVA, devis, avoirs et reçus PDF avec QR de vérification publique.',
  },
  {
    n: '4',
    title: 'Suivez tout en temps réel',
    text: 'Stock multi-dépôts, stock bas, créances clients, dettes fournisseurs, trésorerie, rapports combinés et balance âgée — exportables et imprimables.',
  },
];

const FEATURES: { title: string; text: string }[] = [
  { title: 'Stock multi-dépôts', text: 'Entrées, sorties, transferts, inventaire tournant et valorisation — chaque dépôt garde ses quantités.' },
  { title: 'Caisse & tickets VR', text: 'Vente rapide au comptoir, impression thermique 58/80 mm ou PDF, remise et modes de paiement.' },
  { title: 'Facturation TVA marocaine', text: 'Factures, devis, avoirs (WR), échéanciers et mentions légales ; taux TVA par article.' },
  { title: 'Scan & OCR', text: 'Code-barres au téléphone ou à la douchette, création d’article par photo, devis fournisseur lus par OCR.' },
  { title: 'Atlas Agent IA', text: 'Un assistant intégré qui répond sur vos chiffres : ventes du jour, stock bas, meilleurs clients…' },
  { title: 'Créances & dettes', text: 'Suivi des règlements partiels, relances, balance âgée clients/fournisseurs et situation par client via QR.' },
  { title: 'Équipe & paie', text: 'Employés, postes, cycles de paie, pointage et situations individuelles imprimables.' },
  { title: 'Sécurité de bout en bout', text: 'OTP systématique, sessions signées liées à l’IP et à l’empreinte, WebAuthn, audit complet des actions.' },
  { title: 'Hors-ligne maîtrisé', text: 'L’app Android continue le catalogue et les ventes sans réseau, puis synchronise automatiquement.' },
];

const PLATFORMS: { key: string; title: string; text: string; href: string; cta: string; ext?: boolean }[] = [
  {
    key: 'web',
    title: 'Web — PC & téléphone',
    text: 'L’ERP complet dans le navigateur : tableau de bord, caisse, facturation, rapports et réglages. Interface responsive, thème clair/sombre/system.',
    href: '/dashboard',
    cta: 'Ouvrir le tableau de bord',
  },
  {
    key: 'android',
    title: 'Android natif',
    text: 'Appli Kotlin installée depuis notre CDN : scan, caisse terrain, catalogue hors-ligne, notifications et mises à jour automatiques.',
    href: '/download',
    cta: 'Page de téléchargement',
  },
  {
    key: 'desktop',
    title: 'Bureau (Windows · macOS · Linux)',
    text: 'Application native emballée pour le comptoir : même compte, mêmes données, sensation native et mises à jour via GitHub Releases.',
    href: '/desktop',
    cta: 'Page de téléchargement',
  },
];

/** Révélation au scroll : ajoute `.in` quand la section entre à l’écran. */
function useReveal() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

export default function Home() {
  const revealRef = useReveal();
  const loggedIn = !!getToken();
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = `${APP_NAME} — Stock · Caisse · Facturation`;
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
      upsert('name', 'description', `${APP_NAME} — ERP, caisse et facturation pour commerces et grossistes au Maroc. Web, Android natif et application bureau. Projet open source MIT, forkez-le.`),
      upsert('property', 'og:type', 'website'),
      upsert('property', 'og:title', `${APP_NAME} — Stock · Caisse · Facturation`),
      upsert('property', 'og:description', 'Présentation du produit : web, Android et bureau. Open source MIT, forkez le dépôt.'),
      upsert('property', 'og:url', 'https://stock.afmarbre.com/'),
      upsert('property', 'og:image', 'https://stock.afmarbre.com/atlas-logo-dark.png'),
    ];
    return () => {
      document.title = prevTitle;
      metas.forEach((el) => el.remove());
    };
  }, []);

  useEffect(() => {
    fetch('https://api.github.com/repos/Etherealmber/atlas-commerce', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: any) => setStars(Number(j?.stargazers_count) || null))
      .catch(() => setStars(null));
  }, []);

  return (
    <div className="download-landing home-landing" ref={revealRef}>
      <header className="dl-nav">
        <Link to="/" className="dl-nav-brand" aria-label={`${APP_NAME} — accueil`}>
          <img src="/atlas-logo-dark.png" alt="Atlas" className="dl-nav-logo theme-logo-dark" width={80} height={26} />
          <img src="/atlas-logo-light.png" alt="Atlas" className="dl-nav-logo theme-logo-light" width={80} height={26} />
        </Link>
        <nav className="dl-nav-links" aria-label="Navigation de la page d’accueil">
          <a className="dl-nav-keep" href="#fonctionnement">Comment ça marche</a>
          <a className="dl-nav-keep" href="#fonctionnalites">Fonctionnalités</a>
          <a className="dl-nav-keep" href="#plateformes">Android & bureau</a>
          <a className="dl-nav-keep" href="#opensource">Open source</a>
          <Link className="dl-nav-keep" to="/whats-new">Nouveautés</Link>
          <Link className="dl-nav-keep" to="/about">À propos</Link>
        </nav>
        <div className="home-nav-actions">
          <div className="home-theme" role="group" aria-label="Choix du thème">
            <ThemeButtons />
          </div>
          {loggedIn ? (
            <Link className="dl-nav-cta" to="/dashboard">Ouvrir l’application</Link>
          ) : (
            <Link className="dl-nav-cta" to="/login">Se connecter</Link>
          )}
        </div>
      </header>

      <section className="dl-hero">
        <div className="dl-hero-bg" aria-hidden />
        <div className="dl-hero-grid" aria-hidden />
        <div className="dl-container">
          <div className="dl-hero-content hm-rise">
            <p className="dl-eyebrow">Accueil officiel · {APP_VERSION}</p>
            <h1 className="dl-h1">
              Atlas<span className="dl-h1-dot">.</span>
              <br />
              <span className="dl-h1-soft">Tout votre commerce, une seule app.</span>
            </h1>
            <p className="dl-desc">
              {APP_NAME} est l’ERP souverain des commerces et grossistes : stock multi-dépôts, caisse et
              tickets VR, facturation TVA, créances, paie et rapports — sur PC, téléphone Android et
              application bureau. Vos données restent chez vous.
            </p>
            <div className="dl-ctas">
              {loggedIn ? (
                <Link className="dl-cta-main" to="/dashboard">Ouvrir le tableau de bord</Link>
              ) : (
                <Link className="dl-cta-main" to="/login">Se connecter à mon espace</Link>
              )}
              <Link className="dl-cta-ghost" to="/download">Apk Android</Link>
              <Link className="dl-cta-ghost" to="/desktop">Version bureau</Link>
            </div>
            <p className="dl-note">
              <span className="dl-note-dot" aria-hidden />
              Lecture libre : cette page ne pose aucun cookie et ne redirige jamais. Le tableau de bord
              vit sur <Link to="/dashboard">/dashboard</Link>, la connexion sur <Link to="/login">/login</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="dl-band" id="fonctionnement">
        <div className="dl-container">
          <h2 className="dl-sec-title" data-reveal>Comment ça marche</h2>
          <div className="home-steps">
            {STEPS.map((s, i) => (
              <div className="home-step dl-section card" data-reveal style={{ animationDelay: `${i * 70}ms` }} key={s.n}>
                <span className="home-step-n" aria-hidden>{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="dl-band" id="fonctionnalites">
        <div className="dl-container">
          <h2 className="dl-sec-title" data-reveal>Ce que fait Atlas pour vous</h2>
          <div className="dl-feats">
            {FEATURES.map((f, i) => (
              <div className="dl-feat dl-section card" data-reveal style={{ animationDelay: `${i * 45}ms` }} key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="dl-band" id="plateformes">
        <div className="dl-container">
          <h2 className="dl-sec-title" data-reveal>Une application par appareil</h2>
          <div className="home-platforms">
            {PLATFORMS.map((p, i) => (
              <div className="home-platform dl-section card" data-reveal style={{ animationDelay: `${i * 70}ms` }} key={p.key}>
                <span className={`home-platform-tag home-platform-tag--${p.key}`}>{p.key === 'web' ? 'Web' : p.key === 'android' ? 'Android' : 'Bureau'}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
                {p.ext ? (
                  <a className="dl-cta-ghost" href={p.href} target="_blank" rel="noopener noreferrer">{p.cta}</a>
                ) : (
                  <Link className="dl-cta-ghost" to={p.href}>{p.cta}</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="dl-band home-oss" id="opensource">
        <div className="dl-container" data-reveal>
          <h2 className="dl-sec-title">Open source — forkez le projet</h2>
          <p className="dl-desc">
            {APP_NAME} est développé ouvertement par {APP_CREATOR_NAME} sous licence MIT : le code du web,
            de l’appli Android et de l’app bureau est public. Forkez le dépôt de votre choix, proposez des
            correctifs, ou hébergez votre propre instance.
          </p>
          <div className="home-repos">
            <a className="home-repo dl-section card" href={WEB_REPO} target="_blank" rel="noopener noreferrer">
              <strong>Etherealmber/atlas-commerce</strong>
              <span>Web · ERP, caisse & facturation (React + Cloudflare Workers)</span>
              <em>{stars != null ? `★ ${stars}` : 'MIT'}</em>
            </a>
            <a className="home-repo dl-section card" href={ANDROID_REPO} target="_blank" rel="noopener noreferrer">
              <strong>Etherealmber/atlas-commerce-android</strong>
              <span>Android natif · Kotlin + Compose, hors-ligne & scan</span>
              <em>MIT</em>
            </a>
            <a className="home-repo dl-section card" href={DESKTOP_REPO} target="_blank" rel="noopener noreferrer">
              <strong>Etherealmber/atlas-commerce-desktop</strong>
              <span>Bureau · Windows, macOS & Linux (Tauri/Rust)</span>
              <em>MIT</em>
            </a>
          </div>
          <div className="dl-ctas">
            <a className="dl-cta-main" href={`${WEB_REPO}/fork`} target="_blank" rel="noopener noreferrer">Forker atlas-commerce</a>
            <a className="dl-cta-ghost" href={APP_GITHUB} target="_blank" rel="noopener noreferrer">Profil GitHub</a>
          </div>
        </div>
      </section>

      <footer className="dl-foot">
        <div className="dl-container">
          <p>
            <Link to="/download">Télécharger</Link> · <Link to="/desktop">Bureau</Link> ·{' '}
            <Link to="/whats-new">Nouveautés</Link> · <Link to="/about">À propos</Link> ·{' '}
            <Link to="/privacy">Confidentialité</Link> · <Link to="/terms">Conditions</Link>
          </p>
          <p>Atlas — stock.afmarbre.com · © 2026 Etherealmber · loxdpsy · MIT</p>
        </div>
      </footer>
    </div>
  );
}

/** Petit sélecteur système / clair / sombre — mêmes attributs [data-theme-toggle]
 *  que le reste de l’app (révélation circulaire + persistance atlas-theme). */
function ThemeButtons() {
  const [mode, setMode] = useState<string>(() => {
    try {
      return localStorage.getItem('atlas-theme') || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        setMode(localStorage.getItem('atlas-theme') || 'system');
      } catch {
        /* private mode */
      }
    };
    window.addEventListener('atlas-theme-change', sync);
    return () => window.removeEventListener('atlas-theme-change', sync);
  }, []);
  const pick = (m: 'system' | 'light' | 'dark') => {
    try {
      localStorage.setItem('atlas-theme', m);
    } catch {
      /* private mode */
    }
    setMode(m);
    window.dispatchEvent(new Event('atlas-theme-change'));
  };
  const btn = (m: 'system' | 'light' | 'dark', label: string, icon: string) => (
    <button
      type="button"
      data-theme-toggle
      className={mode === m ? 'active' : undefined}
      title={label}
      aria-label={label}
      aria-pressed={mode === m}
      onClick={() => pick(m)}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
  return (
    <>
      {btn('system', 'Suivre le système', '🖥️')}
      {btn('light', 'Thème clair', '☀️')}
      {btn('dark', 'Thème sombre', '🌙')}
    </>
  );
}
