import { Link } from 'react-router-dom';
import { isLoggedIn, isStockRole } from '../auth';
import { APP_NAME } from '../version';
import { openConsentSettings } from '../lib/cookieConsent';

export default function Privacy() {
  return (
    <div className="privacy-page">
      <div className="privacy-inner">
        <p className="privacy-nav">
          <Link to={isLoggedIn() ? (isStockRole() ? '/products' : '/') : '/login'}>← Retour</Link>
          {' · '}<Link to="/terms">Conditions</Link>{' · '}<Link to="/licenses">Licences</Link>
          {' · '}<button type="button" className="privacy-link-btn" onClick={() => openConsentSettings()}>Gérer les cookies</button>
        </p>
        <h1>Politique de confidentialité</h1>
        <p className="privacy-meta">{APP_NAME} · Dernière mise à jour : 20 octobre 2026</p>
        <section>
          <h2>1. Périmètre et responsable</h2>
          <p>{APP_NAME} est un logiciel auto-hébergé. L’organisation qui exploite votre instance
            détermine les traitements, leurs finalités et les fournisseurs utilisés ; contactez son
            administrateur pour connaître son identité, ses coordonnées et la politique propre à votre
            instance. Cette page décrit les traitements possibles du logiciel et ne remplace pas les
            informations que l’exploitant doit vous fournir.</p>
        </section>
        <section>
          <h2>2. Données et finalités</h2>
          <p>Selon les fonctions activées, l’instance peut traiter des données de compte et
            d’authentification, des informations techniques (adresse IP, appareil et journaux), ainsi
            que des données métier : clients, employés, documents, factures et opérations de stock.
            Ces données servent notamment à fournir le service, gérer les accès, assurer la sécurité
            et répondre aux besoins métier et obligations légales de l’exploitant.</p>
          <p>Si Atlas Agent est utilisé, les messages et les données nécessaires à la réponse peuvent
            être traités et transmis au fournisseur d’IA configuré. Ne soumettez des données sensibles
            que conformément aux instructions de votre organisation.</p>
        </section>
        <section>
          <h2>3. Stockage, destinataires et transferts</h2>
          <p>Les données sont hébergées sur l’infrastructure choisie pour l’instance. Selon sa
            configuration, des prestataires peuvent intervenir pour l’hébergement, la base de données,
            le stockage, le CDN, les e-mails, les notifications ou l’IA. Les composants partagés tels
            que le CDN et GitHub peuvent aussi recevoir des requêtes techniques lorsque utilisés.
            Les destinataires et éventuels transferts internationaux dépendent des services activés ;
            demandez ces informations à l’exploitant.</p>
        </section>
        <section>
          <h2>4. Conservation et sécurité</h2>
          <p>Les durées de conservation et de sauvegarde dépendent de l’exploitant, de sa configuration
            et des obligations applicables. L’exploitant doit protéger les accès, les secrets, les
            sauvegardes et les connexions, maintenir son instance à jour et définir ses procédures de
            suppression. Aucune mesure ne garantit une sécurité absolue.</p>
        </section>
        <section>
          <h2>5. Cookies et stockage local</h2>
          <p>Le navigateur ou l’application peuvent conserver des éléments de session, des préférences
            et des données nécessaires aux fonctions utilisées. Les choix disponibles pour le web sont
            accessibles via <button type="button" className="privacy-link-btn" onClick={() => openConsentSettings()}>les préférences cookies</button>.
            Les permissions de l’application mobile se gèrent dans les réglages de l’appareil.</p>
        </section>
        <section>
          <h2>6. Vos droits</h2>
          <p>Selon le droit applicable, vous pouvez disposer de droits d’accès, de rectification,
            d’effacement ou d’opposition, et du droit de saisir une autorité compétente. Adressez vos
            demandes à l’exploitant de votre instance, qui précise les bases légales et modalités
            applicables à ses traitements.</p>
        </section>
        <section>
          <h2>7. Modifications</h2>
          <p>Cette page peut évoluer avec le logiciel. L’exploitant doit la compléter ou la remplacer
            pour décrire fidèlement son instance et informer les utilisateurs des changements applicables.</p>
        </section>
        <p className="privacy-foot"><Link to="/terms">Conditions d’utilisation</Link>{' · '}
          <Link to="/licenses">Licences</Link></p>
      </div>
    </div>
  );
}
