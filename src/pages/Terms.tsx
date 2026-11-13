import { Link } from 'react-router-dom';
import { isLoggedIn, isStockRole } from '../auth';
import { APP_NAME } from '../version';

export default function Terms() {
  return (
    <div className="privacy-page terms-page">
      <div className="privacy-inner">
        <p className="privacy-nav">
          <Link to={isLoggedIn() ? (isStockRole() ? '/products' : '/') : '/login'}>← Retour</Link>
          {' · '}<Link to="/privacy">Confidentialité</Link>
          {' · '}<Link to="/licenses">Licences</Link>
        </p>
        <h1>Conditions d’utilisation</h1>
        <p className="privacy-meta">{APP_NAME} · Dernière mise à jour : 20 octobre 2026</p>
        <section>
          <h2>1. Périmètre et instance auto-hébergée</h2>
          <p>Ces conditions décrivent l’utilisation du logiciel {APP_NAME}. Chaque instance est exploitée
            par son propre administrateur, qui peut définir des conditions supplémentaires et les adapter
            au droit applicable. Pour les questions concernant votre instance, contactez son exploitant.</p>
        </section>
        <section>
          <h2>2. Accès et usage</h2>
          <p>L’accès est réservé aux personnes autorisées par l’exploitant. Protégez vos identifiants et
            appareils, respectez les droits d’accès et n’utilisez pas l’instance à des fins illicites.
            L’exploitant gère les comptes et peut suspendre ou révoquer l’accès.</p>
        </section>
        <section>
          <h2>3. Données, sauvegardes et services externes</h2>
          <p>L’exploitant est responsable de la configuration, de la sécurité, des sauvegardes et du
            traitement licite de ses données métier. Certaines fonctions peuvent utiliser des services
            externes selon la configuration de l’instance ; consultez la <Link to="/privacy">politique
            de confidentialité</Link> et les conditions de ces fournisseurs.</p>
        </section>
        <section>
          <h2>4. Atlas Agent</h2>
          <p>Les réponses de l’assistant peuvent être inexactes. Vérifiez les informations et les actions
            sensibles avant de les utiliser. Les fonctions disponibles et les prestataires utilisés
            dépendent de la configuration de l’instance.</p>
        </section>
        <section>
          <h2>5. Licence et propriété intellectuelle</h2>
          <p>Le logiciel est disponible sous licence MIT ou Apache 2.0 au choix du destinataire.
            Consultez la <Link to="/licenses">notice et les textes des licences</Link>. Les
            marques et composants tiers restent soumis aux droits de leurs titulaires. Ces conditions
            d’utilisation ne remplacent ni ne limitent les droits accordés par la licence choisie.</p>
        </section>
        <section>
          <h2>6. Disponibilité et garanties</h2>
          <p>La disponibilité dépend de l’exploitant et de ses fournisseurs. Le logiciel est fourni
            sans garantie dans les limites prévues par la licence choisie et le droit applicable.</p>
        </section>
        <p className="privacy-foot"><Link to="/privacy">Politique de confidentialité</Link>{' · '}
          <Link to="/licenses">Licences</Link></p>
      </div>
    </div>
  );
}
