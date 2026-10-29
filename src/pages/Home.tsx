import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { APP_VERSION } from '../version';
import {
  PublicNav,
  PublicDownloadCta,
  GitHubStarButton,
  PublicSessionCta,
  useThemeValue,
  type NavLink,
} from '../components/PublicChrome';
import { isLoggedIn } from '../auth';

const HOME_LIGHT = '/shots/dashboard-light.png';
const HOME_DARK = '/shots/dashboard-dark.png';

const NAV: NavLink[] = [
  { href: '#features', label: 'Fonctionnalités' },
  { href: '#tout-en-un', label: 'Tout-en-un' },
  { href: '#plateformes', label: 'Plateformes' },
  { href: '#open-source', label: 'Open source' },
  { href: '#faq', label: 'FAQ' },
  { href: '/whats-new', label: 'Nouveautés' },
  { href: '/about', label: 'À propos' },
];

/** Fond animé du hero (particules lumineuses dérivantes, façon Liner).
 * Respecte prefers-reduced-motion : une seule image fixe est alors peinte. */
function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const dots = Array.from({ length: 46 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.8 + Math.random() * 2.1,
      p: Math.random() * Math.PI * 2,
      v: 0.4 + Math.random() * 0.8,
    }));
    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = cv.width = Math.max(1, Math.floor(r.width * dpr));
      h = cv.height = Math.max(1, Math.floor(r.height * dpr));
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        const x = (d.x + Math.sin(t * 0.00006 * d.v + d.p) * 0.03) * w;
        const y = (d.y + Math.cos(t * 0.00005 * d.v + d.p) * 0.045) * h;
        const rad = d.r * 7 * dpr;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(228, 113, 58, .38)');
        g.addColorStop(1, 'rgba(228, 113, 58, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener('resize', resize);
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) draw(1200);
    else raf = requestAnimationFrame(loop);
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduce && !raf) {
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return <canvas ref={ref} className="hm-canvas" aria-hidden="true" />;
}

/** Révélation douce au scroll (IntersectionObserver, une seule fois). */
function useRiseObserver() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            (en.target as HTMLElement).classList.add('is-in');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    const t = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>('.home-landing .rise').forEach((el) => io.observe(el));
    }, 60);
    return () => {
      window.clearTimeout(t);
      io.disconnect();
    };
  }, []);
}

/* v0.7.5 — icônes SVG dessinées à la main (fini les emojis) : chaque outil
   remplacé garde sa couleur de marque, l'arc reste lisible en clair/sombre. */
const IC_BOOK = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2.5" fill="#d4a017" />
    <path d="M8 3v18" stroke="#8a6a12" strokeWidth="1.6" />
    <path d="M11 8h6M11 12h6M11 16h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IC_EXCEL = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#107c41" />
    <path d="M9.2 8.2l5.6 7.6M14.8 8.2l-5.6 7.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const IC_WORD = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" fill="#185abd" />
    <path d="M7.5 8.5l1.7 7 2.3-5 2.3 5 1.7-7" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IC_CALC = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="5" y="2.5" width="14" height="19" rx="3" fill="#3f3f46" />
    <rect x="7.5" y="5" width="9" height="4" rx="1" fill="#a1a1aa" />
    <circle cx="9" cy="12.5" r="1.2" fill="#fafafa" /><circle cx="12" cy="12.5" r="1.2" fill="#fafafa" /><circle cx="15" cy="12.5" r="1.2" fill="#fafafa" />
    <circle cx="9" cy="16.5" r="1.2" fill="#fafafa" /><circle cx="12" cy="16.5" r="1.2" fill="#fafafa" /><circle cx="15" cy="16.5" r="1.2" fill="#c45c26" />
  </svg>
);
const IC_WHATS = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="#25d366" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);
const IC_CAM = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.4" />
  </svg>
);
const IC_PDF = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 2.5h8l4.5 4.5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17.5a1 1 0 0 1 1-1Z" fill="#e11d48" />
    <path d="M14 2.5V7h4.5" fill="#9f1239" />
    <path d="M8.5 12h7M8.5 15h7M8.5 18h4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IC_GLOBE = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.5 3.9 5.6 3.9 9S14.6 18.5 12 21c-2.6-2.5-3.9-5.6-3.9-9S9.4 5.5 12 3Z" />
  </svg>
);
const IC_PHONE = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>
);
const IC_DESK = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M9 20.5h6M12 16.5v4" />
  </svg>
);
const IC_REPO = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 8.5 12 3.5 3 8.5l9 5 9-5Z" />
    <path d="M3 8.5v7l9 5 9-5v-7" />
    <path d="M12 13.5v7" />
  </svg>
);

const ARC_TOOLS: { icon: ReactNode; label: string; pos: string }[] = [
  { icon: IC_BOOK, label: 'Le cahier de caisse', pos: 'p1' },
  { icon: IC_EXCEL, label: 'Les classeurs Excel', pos: 'p2' },
  { icon: IC_WORD, label: 'Les devis sur Word', pos: 'p3' },
  { icon: IC_CALC, label: 'La calculatrice', pos: 'p4' },
  { icon: IC_WHATS, label: 'Les relances WhatsApp', pos: 'p5' },
  { icon: IC_CAM, label: 'Les photos de bons', pos: 'p6' },
];

export default function Home() {
  const theme = useThemeValue();
  useRiseObserver();
  const shot = theme === 'light' ? HOME_LIGHT : HOME_DARK;

  return (
    <div className="home-landing">
      <div className="hm-bg" aria-hidden="true">
        <div className="hm-bg-grid" />
        <div className="hm-bg-glow hm-bg-glow-a" />
        <div className="hm-bg-glow hm-bg-glow-b" />
      </div>

      <PublicNav links={NAV} cta={<PublicSessionCta />} />

      <main className="hm-main">
        {/* ---------------- Hero ---------------- */}
        <section className="hm-hero">
          <HeroCanvas />
          <p className="hm-eyebrow">ATLAS · GESTION COMMERCIALE OPEN SOURCE</p>
          <h1>
            Tout votre commerce,
            <br />
            <span className="hm-grad">sans un seul tableur.</span>
          </h1>
          <p className="hm-sub">
            Stock, caisse, facturation, créances, fournisseurs, paie, rapports et agent IA — réunis
            dans une seule application, sur le web, Android et bureau.
          </p>
          <div className="hm-cta">
            <PublicDownloadCta />
            <GitHubStarButton />
            <Link to="/whats-new" className="hm-ghost">
              Voir les nouveautés
            </Link>
          </div>
          <p className="hm-hero-note">
            Gratuit · open source (MIT) · aussi sur <a href="/download">Android</a> et{' '}
            <a href="/desktop">Windows · macOS · Linux</a>
          </p>

          <div className="hm-window rise">
            <div className="hm-window-bar" aria-hidden="true">
              <span /><span /><span />
              <em>stock.afmarbre.com — Tableau de bord</em>
            </div>
            <img src={shot} alt="Le tableau de bord Atlas Commerce" loading="lazy" />
          </div>
        </section>

        {/* ---------------- Fonctionnalités (bento) ---------------- */}
        <section id="features" className="hm-sec">
          <h2 className="rise">Un back-office complet, pas une fiche de plus</h2>
          <p className="hm-sec-sub rise">
            Chaque module remplace un outil éparpillé — et tout se tient dans la même base, sur tous
            vos appareils.
          </p>
          <div className="hm-bento">
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-stock" aria-hidden="true">
                <span className="hm-row"><b>Marbre blanc 2&nbsp;cm</b><i className="hm-chip ok">42 u.</i></span>
                <span className="hm-row"><b>Granit noir</b><i className="hm-chip warn">6 u.</i></span>
                <span className="hm-row"><b>Quartz beige</b><i className="hm-chip bad">0 u.</i></span>
              </div>
              <h3>Stock en temps réel</h3>
              <p>Inventaire complet, alertes de seuil et mouvements datés — plus de stock fantôme.</p>
            </div>
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-pos" aria-hidden="true">
                <span className="hm-ticket">
                  <b>VR-0147</b>
                  <i>2 × Marbre blanc · 1 × pose</i>
                  <u>1 687,20 DH</u>
                </span>
                <span className="hm-chip ok">Encaissée</span>
              </div>
              <h3>Caisse &amp; ventes</h3>
              <p>Ventes comptoir, tickets, règlements partiels et clôture de caisse sans saisie double.</p>
            </div>
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-invoice" aria-hidden="true">
                <span className="hm-doc">
                  <b>FACT-0001</b>
                  <i /><i /><i />
                  <u>Total 1 687,20</u>
                </span>
                <span className="hm-chip">PDF + QR</span>
              </div>
              <h3>Facturation PDF</h3>
              <p>Devis, factures et reçus en PDF propres, avec QR de vérification publique.</p>
            </div>
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-aging" aria-hidden="true">
                <span className="hm-bar" style={{ width: '78%' }} />
                <span className="hm-bar" style={{ width: '52%' }} />
                <span className="hm-bar" style={{ width: '30%' }} />
              </div>
              <h3>Créances &amp; relances</h3>
              <p>Balance âgée, clients à relancer et historique de paiement — sans Post-it.</p>
            </div>
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-qr">
                <span className="hm-qrwrap" title="QR de vérification publique — scannez-moi">
                  {/* v0.7.5 — vrai QR (qrcode.react) pointant vers la vérification
                      publique, logo Atlas excavé au centre, comme sur les reçus. */}
                  <QRCodeSVG
                    value="https://stock.afmarbre.com/verify"
                    size={62}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#18181b"
                    imageSettings={{
                      src: '/atlas-icon-dark.png',
                      width: 18,
                      height: 18,
                      excavate: true,
                    }}
                  />
                </span>
                <span className="hm-chip ok">Vérifié</span>
              </div>
              <h3>Vérification par QR</h3>
              <p>Vos clients scannent et vérifient l’authenticité d’un reçu en une seconde.</p>
            </div>
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-agent" aria-hidden="true">
                <span className="hm-bubble left">Combien de ventes cette semaine ?</span>
                <span className="hm-bubble right">23 ventes · 41 250 DH</span>
              </div>
              <h3>Agent IA intégré</h3>
              <p>Posez vos questions en français : rapports, actions et réponses instantanées.</p>
            </div>
          </div>
        </section>

        {/* ---------------- Tout-en-un (arc d'outils) ---------------- */}
        <section id="tout-en-un" className="hm-sec hm-one">
          <h2 className="rise">
            Cahier, Excel, Word, calculatrice, WhatsApp…
            <br />
            <span className="hm-grad">remplacés par un seul produit.</span>
          </h2>
          <p className="hm-sec-sub rise">
            Tout ce que vous utilisez déjà pour gérer votre commerce tient dans Atlas — et rien ne se
            perd entre deux applications.
          </p>
          <div className="hm-arc rise" aria-hidden="false">
            {ARC_TOOLS.map((t) => (
              <span key={t.label} className={`hm-arc-tile ${t.pos}`}>
                <i>{t.icon}</i>
                <em>{t.label}</em>
              </span>
            ))}
            <div className="hm-arc-core">
              <img className="theme-logo-dark" src="/atlas-icon-dark.png" alt="" width={34} height={34} />
              <img className="theme-logo-light" src="/atlas-icon-light.png" alt="" width={34} height={34} />
              <b>Atlas</b>
              <em>tout votre commerce, une seule application</em>
            </div>
          </div>
        </section>

        {/* ---------------- Confiance ---------------- */}
        <section className="hm-sec">
          <h2 className="rise">La confiance, d’abord</h2>
          <div className="dl-trust rise">
            <div><b>Connexion OTP &amp; passkeys</b><span>Codes à usage unique + WebAuthn/FIDO2, sans mot de passe à réutiliser.</span></div>
            <div><b>Android hors-ligne</b><span>Vos données tournent sur le téléphone ; la synchronisation reprend toute seule.</span></div>
            <div><b>Données souveraines</b><span>Cloudflare D1/R2 dans votre propre compte, sauvegardes chiffrées.</span></div>
            <div><b>100&nbsp;% open source</b><span>Code MIT auditable, auto-hébergement possible, zéro lock-in.</span></div>
            <div><b>QR public vérifiable</b><span>Chaque document imprimé porte un QR infalsifiable, vérifiable sans compte.</span></div>
            <div><b>Sans commission</b><span>Aucun pourcentage sur vos ventes : le logiciel ne vit pas de votre chiffre.</span></div>
          </div>
        </section>

        {/* ---------------- Plateformes ---------------- */}
        <section id="plateformes" className="hm-sec">
          <h2 className="rise">Une application, tous vos écrans</h2>
          <div className="dl-grid rise">
            <div className="dl-card">
              <div className="dl-ico">{IC_GLOBE}</div>
              <h3>Web</h3>
              <p>
                Chrome, Edge, Safari et Firefox. Le PWA s’installe sur l’écran d’accueil et
                fonctionne aussi en mode autonome — téléphone, tablette, pliable, Chromebook et
                grand écran de bureau.
              </p>
              <Link to="/login" className="dl-link">Ouvrir l’application →</Link>
            </div>
            <div className="dl-card">
              <div className="dl-ico">{IC_PHONE}</div>
              <h3>Android</h3>
              <p>
                Application native hors-ligne : caisse, stock, factures et scan QR sans réseau, avec
                synchronisation chiffrée dès la connexion retrouvée. APK signé, installable en deux
                touches.
              </p>
              <Link to="/download" className="dl-link">Télécharger l’APK →</Link>
            </div>
            <div className="dl-card">
              <div className="dl-ico">{IC_DESK}</div>
              <h3>Bureau</h3>
              <p>
                Windows, macOS et Linux : la même application dans une fenêtre native, mises à jour
                automatiques et accès direct aux imprimantes pour vos documents PDF.
              </p>
              <Link to="/desktop" className="dl-link">Version bureau →</Link>
            </div>
          </div>
        </section>

        {/* ---------------- Open source ---------------- */}
        <section id="open-source" className="hm-sec hm-ose">
          <h2 className="rise">Construit en public</h2>
          <div className="dl-ose-grid rise">
            <div className="dl-card">
              <div className="dl-ico">{IC_REPO}</div>
              <h3>Atlas Commerce · web</h3>
              <p>
                React + Cloudflare Worker + D1. Toute la logique métier, l’OTP, les passkeys, la
                facturation et les rapports — sous licence MIT.
              </p>
              <a className="dl-link" href="https://github.com/Etherealmber/atlas-commerce" target="_blank" rel="noreferrer noopener">
                Voir le dépôt →
              </a>
            </div>
            <div className="dl-card">
              <div className="dl-ico">{IC_DESK}</div>
              <h3>Atlas Desktop</h3>
              <p>
                Le client bureau Tauri (Windows, macOS, Linux) : fenêtre native, mises à jour
                automatiques et impression directe.
              </p>
              <a className="dl-link" href="https://github.com/Etherealmber/atlas-commerce-desktop" target="_blank" rel="noreferrer noopener">
                Voir le dépôt →
              </a>
            </div>
          </div>
          <div className="dl-fork rise">
            <GitHubStarButton repo="Etherealmber/atlas-commerce-desktop" />
            <GitHubStarButton repo="Etherealmber/atlas-commerce" />
            <span className="dl-fork-note">
              Une étoile sur les dépôts aide le projet · MIT © 2026 Etherealmber
            </span>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className="hm-sec">
          <h2 className="rise">Questions fréquentes</h2>
          <div className="hm-faq rise">
            <details>
              <summary>L’application est-elle vraiment gratuite ?<i aria-hidden="true" /></summary>
              <p>
                Oui. Atlas est open source sous licence MIT : vous pouvez l’utiliser, l’auditer et
                l’auto-héberger librement. Aucune commission sur vos ventes, aucun abonnement caché.
              </p>
            </details>
            <details>
              <summary>Sur quels appareils puis-je l’utiliser ?<i aria-hidden="true" /></summary>
              <p>
                Sur le web (Chrome, Edge, Safari, Firefox), en PWA installé, sur Android (APK natif
                hors-ligne) et sur ordinateur avec l’application bureau Windows, macOS ou Linux. Les
                téléphones pliables, tablettes, Chromebooks et grands écrans sont pris en charge.
              </p>
            </details>
            <details>
              <summary>Puis-je travailler sans connexion ?<i aria-hidden="true" /></summary>
              <p>
                Oui sur Android et sur l’application bureau : vos données continuent de tourner en
                local et la synchronisation reprend automatiquement dès que le réseau revient.
              </p>
            </details>
            <details>
              <summary>Mes données sont-elles en sécurité ?<i aria-hidden="true" /></summary>
              <p>
                La connexion repose sur des codes OTP et des passkeys (WebAuthn/FIDO2) — jamais de
                mot de passe réutilisé. Les données vivent dans votre propre compte Cloudflare
                (D1/R2), avec sauvegardes chiffrées et politique de divulgation responsable.
              </p>
            </details>
            <details>
              <summary>Comment se passent les mises à jour ?<i aria-hidden="true" /></summary>
              <p>
                Le web se met à jour tout seul. L’application bureau embarque son propre
                updater ; sur Android, la dernière version signée est toujours sur{' '}
                <a href="/download">la page de téléchargement</a>.
              </p>
            </details>
          </div>
        </section>

        {/* ---------------- CTA final ---------------- */}
        <section className="hm-final rise">
          <h2>Prêt à tenir votre commerce la bonne façon ?</h2>
          <p>Installez Atlas en deux minutes — vos produits, vos ventes et vos clients au même endroit.</p>
          <div className="hm-cta">
            <PublicDownloadCta />
            {isLoggedIn() ? (
              <Link to="/dashboard" className="hm-ghost">Ouvrir l’application</Link>
            ) : (
              <Link to="/login" className="hm-ghost">Se connecter</Link>
            )}
          </div>
        </section>
      </main>

      <footer className="dl-foot">
        <div className="dl-foot-links">
          <a href="/whats-new">Nouveautés</a>
          <a href="/about">À propos</a>
          <a href="/download">Android</a>
          <a href="/desktop">Bureau</a>
          <a href="https://github.com/Etherealmber/atlas-commerce" target="_blank" rel="noreferrer noopener">GitHub</a>
          <a href="https://github.com/Etherealmber/atlas-commerce/blob/main/SECURITY.md" target="_blank" rel="noreferrer noopener">Sécurité</a>
        </div>
        <p>MIT © 2026 Etherealmber · Atlas Commerce {APP_VERSION} · Créateur : loxdpsy</p>
      </footer>
    </div>
  );
}
