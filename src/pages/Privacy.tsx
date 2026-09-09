import { Link } from 'react-router-dom';
import { isLoggedIn, getToken, isStockRole } from '../auth';
import {
  APP_NAME,
  APP_TAGLINE,
  APP_CREATOR_NAME,
  APP_VERSION,
} from '../version';
import { openConsentSettings } from '../lib/cookieConsent';

function safeLoggedIn(): boolean {
  return typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
}

export default function Privacy() {
  const logged = safeLoggedIn();
  return (
    <div className="privacy-page">
      <div className="privacy-inner">
        <p className="privacy-nav">
          {logged ? (
            <Link to={isStockRole() ? '/products' : '/'}>← Retour à l&apos;application</Link>
          ) : (
            <Link to="/login">← Connexion</Link>
          )}
          {' · '}
          <Link to="/about">À propos</Link>
          {' · '}
          <Link to="/terms">Conditions d'utilisation</Link>
          {' · '}
          <button type="button" className="privacy-link-btn" onClick={() => openConsentSettings()}>
            Gérer les cookies
          </button>
        </p>

        <h1>Politique de confidentialité</h1>
        <p className="privacy-meta">
          {APP_NAME} · {APP_TAGLINE} · v{APP_VERSION}
          <br />
          Dernière mise à jour : 8 septembre 2026
          <br />
          Responsable du traitement : {APP_CREATOR_NAME} / etherealmber · El Jadida, Maroc
          <br />
          Contact :{' '}
          <a href="https://github.com/loxdpsy" target="_blank" rel="noreferrer">
            github.com/loxdpsy
          </a>{' '}
          ·{' '}
          <a href="https://github.com/etherealmber" target="_blank" rel="noreferrer">
            @etherealmber
          </a>
        </p>

        <section>
          <h2>1. Objet et périmètre</h2>
          <p>
            La présente politique décrit comment {APP_NAME} (« nous ») traite les données
            personnelles lorsque vous utilisez nos services de gestion professionnelle
            (stock, inventaire, caisse, facturation, actions mobiles).
          </p>
          <p>Elle s’applique à&nbsp;:</p>
          <ul>
            <li>
              <strong>L’application web</strong> (navigateur, y compris mode téléphone{' '}
              <code>/m/</code>)
            </li>
            <li>
              <strong>L’application native Android</strong> (package{' '}
              <code>ma.etherealmber.atlascommerce</code>), distribuée hors ou via magasin
              d’applications
            </li>
            <li>
              Les API associées hébergées sur Cloudflare (Workers, D1, R2)
            </li>
          </ul>
          <p>
            L’instance est destinée à un usage professionnel interne par le personnel
            autorisé de l’entreprise cliente.
          </p>
        </section>

        <section>
          <h2>2. Responsable &amp; hébergement</h2>
          <p>
            Le responsable du traitement pour l’instance déployée est l’exploitant indiqué
            ci-dessus ({APP_CREATOR_NAME} / etherealmber), sauf contrat contraire avec votre
            organisation. L’infrastructure technique est fournie principalement par{' '}
            <strong>Cloudflare, Inc.</strong> (Workers, base de données D1, stockage d’objets
            R2, réseau CDN/WAF).
          </p>
          <p>
            Pour l’application Android et les notifications push, des services{' '}
            <strong>Google Firebase</strong> (Firebase Cloud Messaging) peuvent être utilisés
            (voir § 3.5 et § 6).
          </p>
        </section>

        <section>
          <h2>3. Données traitées</h2>

          <h3>3.1 Comptes staff</h3>
          <ul>
            <li>Identifiant de connexion, mot de passe (empreinte hachée côté serveur)</li>
            <li>Rôle (ex. administrateur, stock, secrétariat), nom affiché, e-mail, téléphone</li>
            <li>Date de dernière connexion, état du compte (actif / désactivé)</li>
          </ul>

          <h3>3.2 Sécurité &amp; session</h3>
          <ul>
            <li>
              Jeton de session stocké localement (navigateur&nbsp;: localStorage ;
              application Android&nbsp;: stockage sécurisé de l’app)
            </li>
            <li>Adresse IP, empreinte d’appareil, tentatives de connexion</li>
            <li>Codes OTP envoyés par e-mail pour valider un nouvel appareil</li>
            <li>
              Identifiants de passkey (WebAuthn / Credential Manager) liés au compte, si
              l’utilisateur en enregistre (empreinte biométrique traitée par l’OS, non
              transmise à nos serveurs)
            </li>
            <li>Journal d’audit des actions sensibles</li>
          </ul>

          <h3>3.3 Données métier</h3>
          <ul>
            <li>Produits, stocks, emplacements, inventaires, transferts</li>
            <li>Clients, fournisseurs, devis, factures, règlements</li>
            <li>
              Actions mobiles (« Boîte d’actions »)&nbsp;: scans, propositions de stock,
              demandes issues du téléphone ou de l’app native
            </li>
          </ul>

          <h3>3.4 Atlas Agent (assistant intégré)</h3>
          <ul>
            <li>Messages que vous envoyez à l’assistant et réponses générées</li>
            <li>
              Outils métier invoqués (lecture stock, factures, etc.) — résultats issus de
              votre base
            </li>
            <li>
              Conversations stockées sur <strong>Cloudflare R2</strong> (préfixe{' '}
              <code>agent-chats/v2/</code>), <strong>un fichier chiffré par conversation</strong> (<code>.conv</code>, AES-GCM), séparément de D1 — pas de JSON en clair
            </li>
            <li>
              Indication de plateforme (<code>source</code> / en-tête{' '}
              <code>X-App-Platform</code>&nbsp;: web, android, mobile) pour adapter le
              contexte (réponses plus courtes sur mobile, outils de navigation native)
            </li>
            <li>
              Propositions soumises à validation humaine (ex. ajustement de stock) avant
              application
            </li>
          </ul>
          <p>
            Les messages adressés à Atlas Agent peuvent être traités par un ou plusieurs sous-traitants techniques de génération de texte (choisis par l’administrateur de l’instance, par ex. via le paramètre fournisseur IA) afin de produire une réponse. Atlas Agent se présente uniquement sous ce nom dans l’interface et dans ses réponses ; les noms de marques de modèles ne sont pas exposés aux utilisateurs finaux. L’application mobile native appelle le même endpoint serveur <code>POST /api/assist/chat</code> — le choix du fournisseur est exclusivement côté Worker.
            L’assistant ne doit pas recevoir de données sensibles non nécessaires (CIN,
            mots de passe, codes OTP, données bancaires). Les fichiers de conversation sont
            chiffrés côté serveur (jeton de chiffrement Worker) et inclus dans les sauvegardes
            R2 administrateur ; ils ne sont pas utilisés pour de la publicité.
          </p>

          <h3>3.5 Application native Android</h3>
          <ul>
            <li>
              <strong>Identifiant d’application</strong>&nbsp;:{' '}
              <code>ma.etherealmber.atlascommerce</code>
            </li>
            <li>
              <strong>Jeton FCM</strong> (Firebase Cloud Messaging)&nbsp;: enregistré sur
              nos serveurs (<code>POST /api/assist/device-token</code>) pour envoyer des
              notifications liées aux approbations assistant ou alertes métier, uniquement
              si l’utilisateur est connecté et a accepté les notifications système
            </li>
            <li>
              <strong>Caméra</strong>&nbsp;: utilisée localement pour le scan de codes-barres
              / QR ; les images ne sont pas envoyées à un service de reconnaissance
              publicitaire
            </li>
            <li>
              <strong>Préférences d’affichage</strong>&nbsp;: thème (système / clair /
              sombre), mode compact, Liquid Glass — stockées sur l’appareil
            </li>
            <li>
              <strong>File hors-ligne</strong>&nbsp;: actions en attente de synchronisation
              peuvent être conservées localement jusqu’à reconnexion
            </li>
            <li>
              Données de diagnostic techniques éventuelles (plantages) via les mécanismes
              du système Android / magasin, selon la configuration de publication
            </li>
          </ul>

          <h3>3.6 Données techniques</h3>
          <ul>
            <li>Journaux serveur (requêtes, erreurs), limitation de débit</li>
            <li>Métadonnées CDN / WAF Cloudflare</li>
          </ul>
        </section>

        <section>
          <h2>4. Finalités &amp; bases légales</h2>
          <table className="privacy-table">
            <thead>
              <tr>
                <th>Finalité</th>
                <th>Base</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Authentification, session, passkeys, OTP</td>
                <td>Exécution du contrat / intérêt légitime (sécurité)</td>
              </tr>
              <tr>
                <td>Gestion stock, facturation, actions mobiles</td>
                <td>Exécution du contrat et obligation légale</td>
              </tr>
              <tr>
                <td>Atlas Agent (aide à la décision, propositions)</td>
                <td>Intérêt légitime / exécution du contrat</td>
              </tr>
              <tr>
                <td>Notifications push Android (FCM) sur approbations</td>
                <td>Intérêt légitime ; permission système Android</td>
              </tr>
              <tr>
                <td>Prévention des abus (rate limit, blocage IP)</td>
                <td>Intérêt légitime</td>
              </tr>
              <tr>
                <td>Préférences d’affichage (web)</td>
                <td>Consentement (bannière cookies) le cas échéant</td>
              </tr>
              <tr>
                <td>Mesure d’audience (si activée ultérieurement)</td>
                <td>Consentement</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>5. Cookies, stockage local &amp; app native</h2>
          <p>
            {APP_NAME} n’utilise pas de cookies publicitaires ni de traceurs marketing tiers.
          </p>
          <ul>
            <li>
              <strong>Nécessaires (web)</strong> — jeton de session, empreinte appareil,
              cookies techniques Cloudflare (CDN, WAF, Turnstile éventuel)
            </li>
            <li>
              <strong>Préférences (web)</strong> — thème, densité, guide d’accueil — selon
              consentement
            </li>
            <li>
              <strong>Application Android</strong> — stockage local de session, préférences
              UI, file hors-ligne, jeton FCM ; permission <em>Notifications</em> demandée
              sur Android 13+ ; permission <em>Caméra</em> pour le scan uniquement
            </li>
            <li>
              <strong>Mesure d’audience</strong> — non déployée (pas de Google Analytics /
              pixel pub)
            </li>
          </ul>
          <p>
            Web — gérer les cookies&nbsp;:{' '}
            <button type="button" className="privacy-link-btn" onClick={() => openConsentSettings()}>
              ouvrir le gestionnaire de cookies
            </button>
            . Android — révoquer les notifications ou désinstaller l’app via les réglages du
            téléphone.
          </p>
        </section>

        <section>
          <h2>6. Destinataires &amp; sous-traitants</h2>
          <ul>
            <li>Personnel autorisé de votre organisation (selon les rôles)</li>
            <li>Cloudflare, Inc. — hébergement, D1, R2, sécurité réseau</li>
            <li>
              Prestataire d’e-mail transactionnel (ex. Resend), pour les OTP si configuré
            </li>
            <li>
              Sous-traitant(s) technique(s) de génération de texte pour Atlas Agent (sélection admin : un seul actif à la fois) —
              contenu des messages pour générer les réponses
            </li>
            <li>
              <strong>Google LLC (Firebase Cloud Messaging)</strong> — acheminement des
              notifications push vers les appareils Android enregistrés ; le jeton FCM et
              le contenu de la notification transitent via l’infrastructure Google
            </li>
          </ul>
          <p>Les données clients métier ne sont pas vendues ni cédées à des annonceurs.</p>
        </section>

        <section>
          <h2>7. Transferts hors Maroc / UE</h2>
          <p>
            Cloudflare et, le cas échéant, Google Firebase et le prestataire LLM peuvent
            traiter des données dans des datacenters situés hors du Maroc (et hors UE). Des
            mesures contractuelles et techniques (chiffrement en transit, contrôle d’accès)
            s’appliquent. L’exploitant reste responsable de la conformité CNDP (loi 09-08)
            pour son instance.
          </p>
        </section>

        <section>
          <h2>8. Durées de conservation</h2>
          <ul>
            <li>Comptes staff — durée de la relation + obligations légales</li>
            <li>Journaux de sécurité / login — durée limitée (ordre de quelques mois)</li>
            <li>Jetons FCM — tant que le compte est actif ou jusqu’à invalidation du jeton</li>
            <li>Transcriptions Atlas Agent (R2) — selon politique d’exploitation de l’instance</li>
            <li>Documents comptables — délais légaux applicables au Maroc</li>
          </ul>
        </section>

        <section>
          <h2>9. Sécurité</h2>
          <p>
            Authentification (mot de passe, OTP, passkeys), sessions, HTTPS, isolation des
            rôles, journaux d’audit. L’application Android communique avec les mêmes API
            authentifiées (jeton Bearer). Aucune garantie absolue&nbsp;: signalez tout
            incident à l’administrateur de l’instance.
          </p>
        </section>

        <section>
          <h2>10. Vos droits</h2>
          <p>
            Conformément au RGPD (si applicable) et à la réglementation marocaine (CNDP / loi
            09-08), vous pouvez demander l’accès, la rectification, l’effacement (dans les
            limites légales), la limitation, l’opposition, la portabilité, et le retrait du
            consentement le cas échéant.
          </p>
          <p>
            Demande&nbsp;: administrateur de l’instance ou{' '}
            <a href="https://github.com/loxdpsy" target="_blank" rel="noreferrer">
              github.com/loxdpsy
            </a>
            . Réclamation possible auprès de la CNDP (Maroc) ou de l’autorité UE compétente.
          </p>
        </section>

        <section>
          <h2>11. Mineurs</h2>
          <p>
            Le service s’adresse à des professionnels. Il n’est pas destiné aux enfants de
            moins de 16 ans.
          </p>
        </section>

        <section>
          <h2>12. Codes QR &amp; documents publics</h2>
          <p>
            Les liens de vérification et de situation client sont signés (jeton HMAC). Le
            scan peut générer des journaux techniques. Aucun tracker publicitaire n’est
            intégré au QR. L’exploitant professionnel reste responsable de la conformité
            CNDP et du CGI pour ses propres traitements.
          </p>
        </section>

        <section>
          <h2>13. Modifications</h2>
          <p>
            Cette politique peut être mise à jour pour refléter des évolutions légales ou
            techniques (y compris l’app native et les notifications). La date de « dernière
            mise à jour » en tête de page fait foi. En cas de changement substantiel, un
            avis pourra être affiché dans l’application web ou native.
          </p>
        </section>

        <p className="privacy-foot">
          En utilisant {APP_NAME} (web ou application Android), vous reconnaissez avoir pris
          connaissance de cette politique. Pour les cookies non strictement nécessaires sur
          le web, votre choix est recueilli via la bannière de consentement.
        </p>
      </div>
    </div>
  );
}
