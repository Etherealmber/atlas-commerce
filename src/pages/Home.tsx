import { useEffect } from 'react';
import { Link } from 'react-router-dom';
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

const ARC_TOOLS = [
  { icon: '📒', label: 'Le cahier de caisse', pos: 'p1' },
  { icon: '📊', label: 'Les classeurs Excel', pos: 'p2' },
  { icon: '📝', label: 'Les devis sur Word', pos: 'p3' },
  { icon: '🧮', label: 'La calculatrice', pos: 'p4' },
  { icon: '💬', label: 'Les relances WhatsApp', pos: 'p5' },
  { icon: '📸', label: 'Les photos de bons', pos: 'p6' },
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
              <div className="hm-fx hm-fx-qr" aria-hidden="true">
                <span className="hm-qr" />
                <span className="hm-chip ok">Vérifié</span>
              </div>
              <h3>Vérification par QR</h3>
              <p>Vos clients scannent et vérifient l’authenticité d’un reçu en une seconde.</p>
            </div>
            <div className="hm-bento-card rise">
              <div className="hm-fx hm-fx-agent" aria-hidden="true">
                <span className="hm-bubble left">Combien de ventes cette semaine ?</span>
                <span className="hm-bubble right">23 ventes · 41 250 DH 📈</span>
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
              <div className="dl-ico">🌐</div>
              <h3>Web</h3>
              <p>
                Chrome, Edge, Safari et Firefox. Le PWA s’installe sur l’écran d’accueil et
                fonctionne aussi en mode autonome — téléphone, tablette, pliable, Chromebook et
                grand écran de bureau.
              </p>
              <Link to="/login" className="dl-link">Ouvrir l’application →</Link>
            </div>
            <div className="dl-card">
              <div className="dl-ico">📱</div>
              <h3>Android</h3>
              <p>
                Application native hors-ligne : caisse, stock, factures et scan QR sans réseau, avec
                synchronisation chiffrée dès la connexion retrouvée. APK signé, installable en deux
                touches.
              </p>
              <Link to="/download" className="dl-link">Télécharger l’APK →</Link>
            </div>
            <div className="dl-card">
              <div className="dl-ico">🖥️</div>
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
              <div className="dl-ico">🏗️</div>
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
              <div className="dl-ico">🖥️</div>
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
