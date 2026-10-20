import { Link } from 'react-router-dom';
import { isLoggedIn, getToken, isStockRole } from '../auth';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_CREATOR_NAME,
  APP_VERSION,
} from '../version';

function safeLoggedIn(): boolean {
  return typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
}

export default function Terms() {
  const logged = safeLoggedIn();
  return (
    <div className="privacy-page terms-page">
      <div className="privacy-inner">
        <p className="privacy-nav">
          {logged ? (
            <Link to={isStockRole() ? '/products' : '/'}>{"← Retour à l'application"}</Link>
          ) : (
            <Link to="/login">← Connexion</Link>
          )}
          {' · '}
          <Link to="/privacy">Confidentialité</Link>
          {' · '}
          <Link to="/about">À propos</Link>
        </p>

        <h1>Conditions d&apos;utilisation</h1>
        <p className="privacy-meta">
          {APP_NAME} · {APP_TAGLINE} · v{APP_VERSION}
          <br />
          Dernière mise à jour : 16 septembre 2026
          <br />
          Éditeur : {APP_CREATOR_NAME} / etherealmber · El Jadida, Maroc
        </p>

        <section>
          <h2>1. Objet</h2>
          <p>
            Les présentes conditions régissent l&apos;accès et l&apos;usage de {APP_NAME},
            application de gestion commerciale (stock, facturation, clients) proposée en mode
            web et application Android native. En vous connectant, vous acceptez ces conditions.
          </p>
        </section>

        <section>
          <h2>2. Accès et comptes</h2>
          <ul>
            <li>Les comptes sont provisionnés par l&apos;administrateur de l&apos;instance (pas d&apos;inscription libre).</li>
            <li>Vous êtes responsable de la confidentialité de vos identifiants, passkeys et appareils de confiance.</li>
            <li>L&apos;accès peut être révoqué en cas d&apos;usage abusif ou de compromission.</li>
          </ul>
        </section>

        <section>
          <h2>3. Usage autorisé</h2>
          <p>
            {APP_NAME} est destiné à la gestion interne de votre activité. Vous vous engagez à
            ne pas contourner les contrôles de sécurité, ni utiliser le service pour des activités illicites.
          </p>
        </section>

        <section>
          <h2>4. Atlas Agent</h2>
          <p>
            L&apos;assistant Atlas Agent fournit des suggestions opérationnelles. Les réponses
            peuvent être inexactes ; validez toute action sensible (stock, factures, paiements).
            Les conversations sont stockées de façon chiffrée sur R2 selon la{' '}
            <Link to="/privacy">politique de confidentialité</Link>.
          </p>
        </section>

        <section>
          <h2>5. Modules métier</h2>
          <p>
            Stock, facturation (FA / VR / devis), achats, clients, solde, employés (paie),
            messagerie et Atlas Agent font partie de l&apos;offre instance. L&apos;usage des
            données collaborateurs et des pièces d&apos;identité des collaborateurs doit respecter
            le droit marocain applicable.
          </p>
        </section>

        <section>
          <h2>6. Données et sauvegardes</h2>
          <p>
            Les données métier sont hébergées via Cloudflare (Workers, D1, R2). Les sauvegardes
            administrateur sont chiffrées. Vous restez responsable de la licéité des données
            que vous saisissez (clients, factures, etc.).
          </p>
        </section>

        <section>
          <h2>6. Disponibilité</h2>
          <p>
            Le service est fourni « en l&apos;état ». Des interruptions (maintenance, incidents
            cloud) peuvent survenir sans que cela ouvre droit à indemnité.
          </p>
        </section>

        <section>
          <h2>7. Propriété intellectuelle</h2>
          <p>
            L&apos;interface, le code et la marque {APP_NAME} restent la propriété de leurs
            titulaires. Votre contenu métier vous appartient.
          </p>
        </section>

        <section>
          <h2>8. Contact</h2>
          <p>
            Pour toute question relative à ces conditions : contact via le créateur{' '}
            {APP_CREATOR_NAME} / etherealmber.
          </p>
        </section>

        <p className="privacy-foot">
          <Link to="/privacy">Politique de confidentialité</Link>
          {' · '}
          <Link to="/login">Connexion</Link>
        </p>
      </div>
    </div>
  );
}
