import { useRef } from 'react';
import { useLandingMotion } from '../hooks/useLandingMotion';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { DISPLAY_VERSION } from '../version';
import {
  PublicNav,
  PublicDownloadCta,
  GitHubStarButton,
  PublicSessionCta,
  type NavLink,
} from '../components/PublicChrome';
import { isLoggedIn } from '../auth';
import ThemeShot from '../components/ThemeShot';

const NAV: NavLink[] = [
  { href: '#features', label: 'Fonctionnalités' },
  { href: '#plateformes', label: 'Plateformes' },
  { href: '/whats-new', label: 'Nouveautés' },
  { href: '/support', label: 'Support' },
  { href: '/about', label: 'À propos' },
];

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

export default function Home() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingMotion(pageRef, '.rise', '.hm-showcase');

  return (
    <div className="home-landing" ref={pageRef}>
      <a className="hm-skip" href="#contenu">Aller au contenu</a>
      <PublicNav links={NAV} cta={<PublicSessionCta />} classic />

      <main className="hm-main" id="contenu">
        {/* ---------------- Hero ---------------- */}
        <section className="hm-hero">
          <Link className="hm-eyebrow hm-release-link" to="/whats-new">Atlas Commerce · {DISPLAY_VERSION} <span aria-hidden="true">↗</span></Link>
          <div className="hm-hero-copy">
          <h1>
            <span className="hm-headline-first">Votre commerce,</span>{' '}
            <span className="hm-grad hm-headline-second">en toute clarté.</span>
          </h1>
          <p className="hm-sub">
            Stock, ventes, factures et rapports : retrouvez les outils de votre activité dans un espace commun,
            sur le web, Android et bureau.
          </p>
          <div className="hm-cta">
            <Link to={isLoggedIn() ? '/dashboard' : '/login'} className="hm-start">Ouvrir Atlas <span aria-hidden="true">↗</span></Link>
            <PublicDownloadCta />
            <a href="#features" className="hm-hero-explore">Découvrir les fonctionnalités <span aria-hidden="true">↓</span></a>
          </div>
          <p className="hm-hero-note">
            Gratuit · open source (MIT) · aussi sur <a href="/android">Android</a> et{' '}
            <a href="/desktop">Windows · macOS · Linux</a>
          </p>

          </div>
          <div className="hm-showcase">
          <div className="hm-window hm-window--shot rise">
            <ThemeShot name="site-dashboard" alt="Tableau de bord web Atlas Commerce avec des données fictives" width={1280} height={800} eager />
          </div>
          <img className="hm-phone-shot" src="/shots/phone-products-demo.webp" alt="Catalogue web mobile avec des produits fictifs" width="390" height="844" loading="lazy" />
          </div>
          <p className="hm-shot-caption">Interfaces web sur ordinateur et mobile · données fictives de démonstration</p>
          <ul className="hm-facts" aria-label="Les essentiels d’Atlas">
            <li><b>Stock &amp; scan</b><span>Suivez vos produits et vos mouvements.</span></li>
            <li><b>Vente &amp; facturation</b><span>Du comptoir aux documents commerciaux.</span></li>
            <li><b>Sur vos appareils</b><span>Web, Android et application bureau.</span></li>
            <li><b>Open source</b><span>Un projet ouvert que vous pouvez explorer.</span></li>
          </ul>
        </section>

        {/* ---------------- Fonctionnalités (bento) ---------------- */}
        <section id="features" className="hm-sec">
          <div className="hm-section-heading rise">
            <p className="hm-section-kicker">01 / VOTRE ACTIVITÉ</p>
            <h2>Les outils essentiels, réunis dans Atlas.</h2>
            <p>Du catalogue à la facture, retrouvez les informations utiles à chaque étape de votre journée.</p>
          </div>
          <div className="hm-bento">
            <div className="hm-bento-card rise">
              <figure className="hm-fx hm-fx-shot hm-fx-stock"><ThemeShot name="feature-stock" alt="Catalogue produits de l’application web avec photos, niveaux de stock et seuils (données fictives)" width={1064} height={600} /></figure>
              <h3>Stock en temps réel</h3>
              <p>Consultez l’inventaire, les seuils et les mouvements de vos produits.</p>
            </div>
            <div className="hm-bento-card rise">
              <figure className="hm-fx hm-fx-shot hm-fx-pos"><ThemeShot name="feature-sales" alt="Liste des tickets de vente rapide avec statuts de règlement (données fictives)" width={1280} height={720} /></figure>
              <h3>Caisse &amp; ventes</h3>
              <p>Ventes comptoir, tickets, règlements partiels et clôture de caisse sans saisie double.</p>
            </div>
            <div className="hm-bento-card rise">
              <figure className="hm-fx hm-fx-shot hm-fx-invoice"><ThemeShot name="feature-invoice" alt="Lignes d’une facture de vente avec prix HT et TTC (données fictives)" width={1280} height={620} /></figure>
              <h3>Facturation PDF</h3>
              <p>Devis, factures et reçus en PDF propres, avec QR de vérification publique.</p>
            </div>
            <div className="hm-bento-card rise">
              <figure className="hm-fx hm-fx-shot hm-fx-aging"><ThemeShot name="feature-aging" alt="Rapport de balance âgée des créances clients par tranche d’échéance (données fictives)" width={1280} height={720} /></figure>
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
              <figure className="hm-fx hm-fx-shot hm-fx-agent"><ThemeShot name="site-agent" alt="Panneau Atlas Agent avec une conversation fictive" width={380} height={700} /></figure>
              <h3>Agent IA intégré</h3>
              <p>Posez vos questions en français et explorez vos données selon vos permissions. Conversation fictive ci-dessus.</p>
            </div>
          </div>
        </section>

        {/* ---------------- Un parcours clair, du stock à la vente ---------------- */}
        <section id="tout-en-un" className="hm-sec hm-workflow">
          <div className="hm-section-heading rise">
            <p className="hm-section-kicker">02 / AU QUOTIDIEN</p>
            <h2>Moins d’allers-retours. Plus de clarté.</h2>
            <p>Une vue d’ensemble pour passer du produit à la vente, puis retrouver les informations qui comptent.</p>
          </div>
          <ol className="hm-steps rise">
            <li><span className="hm-step-number">01</span><div><h3>Organisez vos produits</h3><p>Retrouvez le catalogue, les quantités et les mouvements de stock au même endroit.</p></div></li>
            <li><span className="hm-step-number">02</span><div><h3>Enregistrez vos ventes</h3><p>Suivez les règlements et préparez vos documents commerciaux.</p></div></li>
            <li><span className="hm-step-number">03</span><div><h3>Gardez une vue d’ensemble</h3><p>Consultez vos rapports et posez vos questions à l’agent IA selon vos accès.</p></div></li>
          </ol>
        </section>

        {/* ---------------- Confiance ---------------- */}
        <section className="hm-sec">
          <h2 className="rise">La confiance, d’abord</h2>
          <div className="dl-trust rise">
            <div><b>Connexion OTP &amp; passkeys</b><span>Codes à usage unique et WebAuthn/FIDO2 pour les parcours pris en charge.</span></div>
            <div><b>Android hors-ligne</b><span>Des fonctions hors ligne avec synchronisation au retour du réseau, selon la version.</span></div>
            <div><b>Données souveraines</b><span>En auto-hébergement, utilisez D1/R2 dans votre compte Cloudflare et configurez vos sauvegardes.</span></div>
            <div><b>100&nbsp;% open source</b><span>Code MIT auditable, auto-hébergement possible, zéro lock-in.</span></div>
            <div><b>QR public vérifiable</b><span>Les documents compatibles peuvent être vérifiés par QR sans compte.</span></div>
            <div><b>Sans commission</b><span>Aucun pourcentage sur vos ventes : le logiciel ne vit pas de votre chiffre.</span></div>
          </div>
        </section>

        {/* ---------------- Plateformes ---------------- */}
        <section id="plateformes" className="hm-sec">
          <div className="hm-section-heading rise">
            <p className="hm-section-kicker">03 / VOS APPAREILS</p>
            <h2>Atlas vous suit, du terrain au comptoir.</h2>
            <p>Choisissez l’interface adaptée à votre journée et retrouvez votre espace de travail.</p>
          </div>
          <div className="dl-grid hm-platform-grid rise">
            <div className="dl-card hm-platform-card">
              <figure className="hm-platform-visual hm-platform-visual--phone"><img src="/shots/phone-products-demo.webp" alt="Catalogue web mobile avec produits fictifs" width="390" height="844" loading="lazy" /><figcaption>Web mobile · données fictives</figcaption></figure>
              <div className="dl-ico">{IC_GLOBE}</div>
              <h3>Web</h3>
              <p>
                Chrome, Edge, Safari et Firefox. Le PWA s’installe sur l’écran d’accueil et
                fonctionne aussi en mode autonome — téléphone, tablette, pliable, Chromebook et
                grand écran de bureau.
              </p>
              <Link to="/login" className="dl-link dl-chip">Ouvrir l’application <span aria-hidden="true">→</span></Link>
            </div>
            <div className="dl-card hm-platform-card">
              <figure className="hm-platform-visual hm-platform-visual--phone"><img src="/shots/phone-balance-demo.webp" alt="Balance web mobile avec données fictives" width="390" height="844" loading="lazy" /><figcaption>Web mobile · données fictives</figcaption></figure>
              <div className="dl-ico">{IC_PHONE}</div>
              <h3>Android</h3>
              <p>
                Application native pour le stock, les ventes et le scan, avec des fonctions hors ligne
                et une synchronisation au retour du réseau. Téléchargez l’APK depuis la page officielle.
              </p>
              <Link to="/android" className="dl-link dl-chip">Télécharger l’APK <span aria-hidden="true">→</span></Link>
            </div>
            <div className="dl-card hm-platform-card">
              <figure className="hm-platform-visual hm-platform-visual--desktop"><ThemeShot name="site-dashboard" alt="Tableau de bord web sur ordinateur avec données fictives" width={1280} height={800} /><figcaption>Web sur ordinateur · données fictives</figcaption></figure>
              <div className="dl-ico">{IC_DESK}</div>
              <h3>Bureau</h3>
              <p>
                Windows, macOS et Linux : retrouvez votre espace Atlas dans une fenêtre dédiée.
                Consultez les versions disponibles pour votre ordinateur.
              </p>
              <Link to="/desktop" className="dl-link dl-chip">Version bureau <span aria-hidden="true">→</span></Link>
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
              <a className="dl-link dl-chip" href="https://github.com/Etherealmber/atlas-commerce" target="_blank" rel="noreferrer noopener">
                Voir le dépôt →
              </a>
            </div>
            <div className="dl-card">
              <div className="dl-ico">{IC_DESK}</div>
              <h3>Atlas Desktop</h3>
              <p>
                Le client bureau natif en Rust (Windows, macOS, Linux) : fenêtre dédiée, coffre
                système et mises à jour vérifiées via CDN1.
              </p>
              <a className="dl-link dl-chip" href="https://github.com/Etherealmber/atlas-commerce-desktop" target="_blank" rel="noreferrer noopener">
                Voir le dépôt →
              </a>
            </div>
          </div>
          <div className="dl-fork rise">
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
                L’application Android propose des fonctions hors ligne avec synchronisation au retour
                du réseau. La disponibilité dépend de la version et des opérations utilisées.
              </p>
            </details>
            <details>
              <summary>Mes données sont-elles en sécurité ?<i aria-hidden="true" /></summary>
              <p>
                La connexion utilise notamment des codes OTP et, pour les parcours compatibles, des
                passkeys (WebAuthn/FIDO2). En auto-hébergement, les données vivent dans votre compte Cloudflare
                (D1/R2), avec sauvegardes chiffrées et politique de divulgation responsable.
              </p>
            </details>
            <details>
              <summary>Comment se passent les mises à jour ?<i aria-hidden="true" /></summary>
              <p>
                Le web se met à jour automatiquement. L’application bureau (Windows, macOS et Linux)
                et l’application Android vérifient leurs manifestes signés sur CDN1, et les
                installateurs officiels restent accessibles sur{' '}
                <a href="/desktop">la page Bureau</a> et <a href="/android">la page Android</a>.
              </p>
            </details>
          </div>
        </section>

        {/* ---------------- CTA final ---------------- */}
        <section className="hm-final rise">
          <h2>Prêt à tenir votre commerce la bonne façon ?</h2>
          <p>Retrouvez vos produits, vos ventes et vos clients au même endroit.</p>
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
          <a href="/support">Support</a>
          <a href="/android">Android</a>
          <a href="/desktop">Bureau</a>
          <a href="https://github.com/Etherealmber/atlas-commerce" target="_blank" rel="noreferrer noopener">GitHub</a>
          <a href="https://github.com/Etherealmber/atlas-commerce/blob/main/SECURITY.md" target="_blank" rel="noreferrer noopener">Sécurité</a>
        </div>
        <p>MIT © 2026 Etherealmber · Atlas Commerce {DISPLAY_VERSION} · Créateur : Etherealmber</p>
      </footer>
    </div>
  );
}
