# Connexion desktop native v2 : pilotes staging expérimentaux

## État et limites

**Mise à jour 0.9.1 :** le contrat opérationnel des modes `embedded_webview` et `system_browser`, leurs schémas exacts et les contraintes du client figurent dans le [contrat client](desktop-native-auth-v2-client.md). Les indications historiques ci-dessous sur le défi navigateur sont complétées par ce contrat. Le mode intégré est servi par un document autonome strictement limité au staging ; aucun client Rust ou essai réel n'est livré ici.

Le backend implémente un **parcours d'approbation téléphone distinct**, avec
PKCE S256, consentement et échange atomique. Une page mobile web séparée
`/login/desktop-phone` affiche le compte, l'appareil et le code et permet une
décision explicite pour une session web déjà ouverte sur le même serveur.
Le parcours est désactivé par défaut. Le client Rust et l'intégration à
l'application Android native ne sont pas livrés dans ce dépôt ; l'utilisateur
du téléphone doit disposer d'une session valide dans son navigateur mobile.
Ne pas activer en production avant l'intégration desktop et les essais réels
décrits plus bas. Un serveur ne peut pas prouver qu'une UI cliente a réellement affiché le
consentement : `compare_confirmed` ne remplace pas une implémentation correcte
et une validation des clients.

Le pilote mot de passe + OTP est maintenant raccordé au défi navigateur, mais
**exclusivement en staging**, avec un compte de test nommé et une boîte e-mail
fixe de test. Il est désactivé par défaut et n'est ni validé en staging réel ni
prêt pour la production. Le client desktop Rust et ses champs natifs ne sont pas
présents dans ce dépôt. Le prototype passkey Windows est séparé et indisponible.
Le navigateur système v1 reste un choix explicite, jamais un repli automatique.
Aucun déploiement du pilote n'a été effectué ici.

### Activation opérateur — staging uniquement tant que les clients manquent

1. Installer le Worker et un D1 propre, sur HTTPS avec certificat valide. Le
   Worker initialise `desktop_auth_v2` et `desktop_auth_limits_v2` au premier
   appel, ainsi que des déclencheurs qui annulent les demandes v2 sur
   révocation/réaffectation du téléphone ou modification/suppression du compte ;
   le compte D1 doit permettre ces opérations. Tester les droits et le
   comportement réel de `DB.batch` transactionnel. Pas de nouveau secret.
2. Réserver ces variables à l'environnement de test :
   `DESKTOP_NATIVE_V2_DISCOVERY=true` **et**
   `DESKTOP_NATIVE_V2_PHONE_APPROVAL=true`. L'une absente/différente de `true`
   désactive les opérations ; ne jamais déduire une disponibilité de la seule
   présence du code. `DB` doit exposer `prepare` et `batch` pour annoncer la méthode. Un échec D1
   reste possible à l'exécution et renvoie 503.
3. Le Worker exige `CF-Connecting-IP` pour chaque opération téléphone active ; l'opérateur doit
   garantir que seul un proxy/edge de confiance fournit cette en-tête et que
   les accès directs permettant de la falsifier sont bloqués. Sinon ne pas
   activer. Une IP desktop différente à l'échange impose de recommencer ; l'IP
   téléphone peut être différente ou changer selon les règles de session.
4. Mettre en place redaction des corps, en-têtes Authorization et paramètres
   sensibles dans tous les accès, traces et logs du proxy, client et opérateur.
   Ne pas enregistrer QR, ID de demande, state, verifier, nonce ou jeton.

## Audit des flux existants

- [`desktop-browser-auth-v1.md`](desktop-browser-auth-v1.md) décrit le
  navigateur v1, son origine HTTPS/port, S256, IP et fingerprint desktop,
  consentement et échange. Il reste intact.
- `/api/auth/qr/pc-session` est historique (TTL 60 s), sans liaison PKCE ni
  fingerprint desktop initial. Le QR v2 est différent et **ne l'utilise pas**.
- L'authentification de session existante vérifie la preuve d'un compte secondaire
  avec son rôle en base, mais la lecture du jeton peut renvoyer le rôle déclaré.
  La v2 revérifie explicitement compte actif, ID, rôle et matériel de preuve en
  base ; elle exige aussi un bearer valide et l'empreinte exacte d'un appareil
  téléphone enregistré. L'empreinte déclarée n'est pas une attestation.
- [`login-rate-limits.md`](login-rate-limits.md) décrit les budgets persistants
  pour mot de passe/OTP. Les routes v2 réservées ci-dessous ne traitent aucune
  authentification, et l'exemption native historique de `/api/auth/login` n'est pas étendue. Le
  vérificateur Turnstile historique échoue aussi ouvert lors d'une erreur réseau
  vers le fournisseur ; ce comportement préexistant n'est ni corrigé ni utilisé
  comme preuve d'un contrôle anti-abus natif dans cette v2.
- [`webauthn.md`](webauthn.md) documente le vérificateur existant et les
  prérequis de production ; sa configuration ne valide pas les passkeys Windows
  natives.

## Transport et découverte

**Tous les exemples de ce document sont fictifs : domaines, comptes, valeurs et
identifiants servent uniquement à illustrer le contrat et ne sont pas des secrets.**

Le client choisit une origine HTTPS racine sans identifiants, chemin non racine,
query ni fragment. Il vérifie le certificat et n'autorise aucune redirection API.
Il conserve le port explicite et vérifie chaque origine en réponse. Le serveur
compare l'origine déclarée à l'origine exacte de l'URL reçue ; s'il y a en-tête
`Origin`, il doit correspondre. `Sec-Fetch-Site` s'il est présent doit être
`same-origin` ou `none`. L'opérateur est responsable de la sécurité des proxys
qui construisent l'URL externe. JSON borné à 8192 octets et 10 secondes de lecture, champs inconnus
refusés, aucune query sur les opérations. Toutes les réponses v2 portent
`Cache-Control: no-store`, `CDN-Cache-Control: no-store`, `Referrer-Policy:
no-referrer`. Ne jamais mettre un secret dans une URL ou un QR.

`GET /api/auth/desktop/v2/capabilities` est public et ne prend aucun compte ni
query. Exemple avec les deux drapeaux et D1 liés :

```json
{"success":true,"data":{"version":2,"discovery_enabled":true,"methods":{
 "phone_approval":{"available":true,"version":2,"code_challenge_method":"S256","expires_in":300,"interval":5,"max_polls":60,"requires_phone_client":true},
 "password_otp":{"available":false,"reason":"NATIVE_ABUSE_VERIFIER_UNAVAILABLE"},
 "windows_passkey":{"available":false,"reason":"NATIVE_ASSOCIATION_UNVERIFIED"}},
 "browser_fallback":{"version":1,"capabilities_path":"/api/auth/desktop/v1/capabilities","automatic":false}}}
```

Sans double opt-in, `phone_approval` vaut `{ "available": false, "reason":
"METHOD_DISABLED" }`. La découverte seule n'active rien. Le chemin v1 doit être
vérifié via ses propres capacités avant de le proposer. Un serveur plus ancien
peut retourner 401, 404 ou HTML : vérifier version et format, ne pas présumer
qu'une erreur de sécurité autorise un repli. HTTP non chiffré répond 400
`HTTPS_REQUIRED` ; query/origin incohérentes sur découverte : 400 `INVALID_REQUEST`.

## Routes réservées pour méthodes indisponibles

Ces routes publiques réservent les noms mais **n'acceptent aucune tentative**.
Le client doit lire les capacités et ne jamais envoyer de mot de passe, OTP,
assertion, identifiant de compte ou autre donnée sensible à ces chemins. Les
appels POST HTTPS sans query ni Origin étranger reçoivent :

| Chemin exact | Corps pris en charge | Réponse normale |
| --- | --- | --- |
| `/api/auth/desktop/v2/password` | aucun ; ne pas envoyer de corps | 503 `NATIVE_ABUSE_VERIFIER_UNAVAILABLE` |
| `/api/auth/desktop/v2/otp` | aucun ; ne pas envoyer de corps | 503 `NATIVE_ABUSE_VERIFIER_UNAVAILABLE` |
| `/api/auth/desktop/v2/passkey` | aucun ; ne pas envoyer de corps | 503 `NATIVE_ASSOCIATION_UNVERIFIED` |

La forme exacte est `{"success":false,"code":"<code ci-dessus>","error":"Méthode native indisponible."}`.
Le serveur ne lit ni ne traite le corps, ne cherche aucun compte et n'émet aucun
challenge, OTP ou jeton. Les réponses ne dépendent pas du compte, d'un
fingerprint, du user-agent, d'un en-tête natif ou des flags Turnstile/WebAuthn.
Sans double opt-in téléphone, ces réponses ne créent pas de tables ni de quotas :
ces routes ne permettent aucune authentification. Avec le double opt-in téléphone, ces
sondes partagent le quota persistant `operation-ip` de la v2 ; dépassement 429
`RATE_LIMITED`, indisponibilité D1/IP fiable 503 `UNAVAILABLE`. Les protections
HTTP/origine et gardes globaux peuvent répondre avant les codes ci-dessus. Un
ancien serveur peut répondre 401/404 : ne jamais interpréter ces réponses comme
un droit d'utiliser un autre endpoint natif ou de contourner Turnstile.

Ces chemins réservés ne sont pas ceux du pilote : utiliser uniquement les
chemins `/api/auth/desktop/v2/pilot/...` documentés ci-dessous en staging. Les
exemptions natives et le comportement fail-open historiques du web ne sont
pas utilisés par le pilote. La méthode passkey reste indisponible.

## Défi navigateur et connexion native — staging seulement

Le défi seul ne crée aucune session. Le parcours de credentials utilise ce
défi si, et seulement si, les deux flags staging et toutes les dépendances sont
configurés. Hors staging, ou si une condition manque, il reste indisponible.
Le client Rust n'est pas livré : les tests locaux appellent le vrai routeur avec
un client simulé. L'expérience challenge-only continue de fonctionner séparément
sans le flag credentials. Le serveur ne sait pas attester le logiciel client.

### Trois propriétés distinctes et décision préalable

| Événement | Ce qu'il démontre | Ce qu'il ne démontre pas |
| --- | --- | --- |
| `verified` | Siteverify a accepté un token associé au `cdata`, hostname et action attendus avant expiration. | Ni identité de la personne, ni possession du PC, ni compte authentifié. Un token peut être obtenu par relais. |
| preuve PKCE + state | Le demandeur de poll/cancel/consume connaît les secrets correspondant à la transaction et utilise l'IP initiale. | Ni intégrité du binaire, ni présence du même humain dans le navigateur ; un attaquant peut lui-même créer la preuve et relayer le défi. |
| compte authentifié | Le pilote vérifie le mot de passe et l'OTP pour le compte de test autorisé, puis émet une session contrôlée. | La simple résolution de Turnstile ou la connaissance de PKCE ne l'établit jamais. |

Le test `demonstrates challenge relay` reproduit ce scénario en mode défi seul
avec une autre IP et un fournisseur simulé ; il ne teste aucune ferme réelle.
Le pilote credentials exige la même IP, ce qui réduit certains relais mais
reste insuffisant derrière NAT/CGNAT, VPN et coercition ;
un code affiché peut être communiqué. Options : accepter explicitement ce
risque **pour des comptes synthétiques, D1 et messagerie isolés**, en imposant
IP/compte/OTP, durée courte et revue humaine des résultats ; ou rester sans
credentials/session et conserver ce pilote ; ou choisir un autre facteur/canal
dont la liaison et le modèle de confiance seront vérifiés. Une décision de
l'opérateur sur cette politique reste nécessaire avant tout déploiement en production.

### Contrat Rust : mot de passe + OTP et session staging

**Activation :** `ENVIRONMENT=staging`, `DESKTOP_NATIVE_V2_PILOT_CHALLENGE=true`,
`DESKTOP_NATIVE_V2_PILOT_LOGIN=true`, `DESKTOP_NATIVE_V2_PILOT_ORIGIN` origine
HTTPS exacte (port inclus), `DESKTOP_NATIVE_V2_PILOT_USERNAME` identifiant
minuscule du seul compte de test non propriétaire, `DESKTOP_NATIVE_V2_PILOT_OTP_TO`
et `DESKTOP_NATIVE_V2_PILOT_OTP_FROM` adresses de test et binding `EMAIL` opérant,
`DESKTOP_NATIVE_V2_PILOT_OTP_KEY` secret dédié d'au moins 32 caractères, généré
aléatoirement par l'opérateur et stocké exclusivement en secret staging, clés
Turnstile et D1 fonctionnels. Aucun de ces secrets n'a été créé ici. Le compte
isolé doit être actif et utiliser `pbkdf2$100000$...` ; comptes historiques,
owner et autres comptes ne peuvent pas se connecter par ce pilote. La capacité
annonce `{ "available":true,"version":2,"experimental":true,"staging_only":true,"challenge":"system_browser_turnstile","otp_required":true,"challenge_presentation":{"hosted_path":"/login/desktop-challenge","embedded_path":"/login/desktop-challenge-embedded","modes":["embedded_webview","system_browser"],"webview2":"staging_supported_requires_client_validation","system_browser":"explicit_choice_only","same_ip_required":true,"server_verified":true} }`
uniquement lorsque ces paramètres et l'origine reçue conviennent ; elle ne
vérifie ni la disponibilité réelle du compte, D1, mail ou Siteverify, ni la
configuration effective de l'infrastructure. Aucun header ou fingerprint ne
fait office d'attestation.

Chaque connexion pilote nécessite **toujours** un défi : c'est la politique
actuelle, aucune exemption basée sur l'appareil n'existe. Le client génère en
mémoire un state et un verifier CSPRNG distincts (32 octets ou plus, base64url
sans padding), calcule S256, appelle `/pilot/requests`, montre le code, ouvre
l'URL de défi de la section suivante dans une WebView2 temporaire **si le client
Windows applique les contrôles ci-dessous**, ou dans le navigateur système
sur choix explicite, puis poll à 5 secondes minimum. La valeur de capacité
historique `system_browser_turnstile` reste inchangée pour compatibilité. Le champ `challenge_presentation` annonce les deux modes disponibles en staging, sans garantir le fonctionnement réel du client : `webview2: staging_supported_requires_client_validation` impose les contrôles et essais décrits ci-dessous. Il ne lit ni
cookies ni stockage ni JS ni token navigateur. Échec,
refus, expiration ou changement d'IP => recommencer, sans fallback automatique.
Ne **pas** appeler `/pilot/consume` pour un login : `/pilot/login/password`
consomme atomiquement le défi lui-même. L'IP du navigateur doit être égale à
celle du desktop pour un défi utilisable par ce pilote ; ce contrôle peut causer
des faux refus avec VPN, multi-homing ou IPv6 et ne prouve pas l'identité.

Les chemins ci-dessous sont sous `/api/auth/desktop/v2/pilot`, tous POST JSON
sans query, avec TLS valide, pas de redirection, aucune journalisation des
corps/réponses/en-têtes, et origine exacte. `proof` dans les exemples signifie
uniquement les quatre champs explicites `origin`, `request_id`, `state`,
`code_verifier` dans l'objet JSON ; ce n'est pas un champ littéral. Les secrets
ne vont jamais dans une URL, un callback ou la page de défi.

1. Après `poll` = `verified`, `POST /login/password` :
   `{"origin":"<origine>","request_id":"<id>","state":"<state>","code_verifier":"<verifier>","username":"<compte>","password":"<secret>"}`.
   Le nom est trim/lowercase et doit correspondre à `[a-z0-9._-]{1,64}` ; le
   mot de passe a 1–512 caractères. Réponse **200 identique** pour compte absent,
   hors allowlist ou mot de passe incorrect :
   `{"success":true,"data":{"status":"otp_pending"}}`. Un seul appel peut
   réserver et consommer la transaction. Un compte factice subit aussi PBKDF2 ;
   l'envoi en arrière-plan n'a pas lieu pour une identité invalide. Les temps
   ne sont pas garantis identiques : mesurer les fuites temporelles avant tout
   usage au-delà de ce compte isolé. L'envoi échoué ne délivre pas de session.
2. Le code est envoyé seulement vers la boîte staging configurée, jamais à une
   adresse issue du client. `POST /login/otp` :
   `{"origin":"<origine>","request_id":"<id>","state":"<state>","code_verifier":"<verifier>","otp":"<six chiffres>"}`.
   Code CSPRNG uniforme, MAC HMAC-SHA256 lié à l'ID stocké en D1 ; au plus cinq
   tentatives, expire au plus tard à l'expiration de la transaction initiale
   (300 s en tout). Compte invalide, OTP incorrect/non délivré/expiré, course ou
   rejeu : 401 `AUTH_FAILED` générique (une transaction expirée peut répondre
   410 `EXPIRED` avant cette étape). Envoi asynchrone : une tentative avant la
   confirmation de livraison consomme aussi un essai. Succès **200, une fois** :
   `{"success":true,"data":{"token_type":"Bearer","access_token":"<access>","refresh_token":"<refresh>","access_expires_at":"<ISO UTC>","session_expires_at":"<ISO UTC>","origin":"<origine>","username":"<compte>","role":"<rôle>"}}`.
3. Après l'étape password, `POST /login/cancel` reçoit les quatre champs proof
   et renvoie 200 `{"success":true,"data":{"status":"cancelled"}}`. Avant
   l'étape password utiliser `/pilot/cancel`. Après émission de session utiliser
   `/session/logout`. Une annulation ou modification du compte pendant la
   vérification empêche la création de session.
4. L'access token sert uniquement d'en-tête `Authorization: Bearer <access>`
   sur les API protégées ; il n'est pas accepté en query ni pour initier un
   parcours web/QR/auth historique. Le stockage Rust doit être protégé par le
   coffre système, isolé par origine, sans log ; aucune intégration coffre
   n'est fournie ici. Accès valable 15 min au maximum ; session totale 12 h
   maximum, non glissante. Les vérifications utilisent le hash du token en D1,
   compte actif, rôle, ID et hash du matériel courant ; l'empreinte n'est pas
   un facteur. Les lectures de sessions natives utilisent first-primary lorsque
   le binding expose Sessions API ; D1 réel et cutover restent à vérifier.
5. `POST /session/refresh` : `{"origin":"<origine>","refresh_token":"<refresh>"}`.
   Succès : même objet session que l'OTP avec **deux nouveaux tokens**, expirations
   et identité ; les anciens tokens sont invalidés. Renouveler en une seule
   requête en vol. Le rejeu d'un refresh consommé et enregistré révoque la famille,
   y compris après réponse perdue. L'historique ne contient que les générations
   consommées depuis cette modification, plus la dernière génération précédente
   lors de la première rotation ; les générations antérieures sont irrécupérables.
   Une course peut révoquer le résultat du gagnant : recommencer. Après une
   réponse refresh perdue ou incertaine, **ne jamais rejouer automatiquement** :
   tenter logout avec le dernier refresh local, effacer les jetons et recommencer.
   Une réponse OTP perdue n'est pas récupérable : recommencer ; la session orpheline
   expirera au plus tard après 12 h, ou l'opérateur la révoque en D1.
6. `POST /session/logout` : `{"origin":"<origine>","refresh_token":"<refresh courant ou consommé enregistré>"}`
   renvoie `{"success":true,"data":{"status":"revoked"}}`. Effacer les
   tokens localement même en cas de perte réseau ; si nécessaire l'opérateur
   révoque la session dans D1. Modification/suppression/désactivation du compte,
   rôle, sel ou hash de mot de passe révoque de façon terminale les sessions et
   tentatives en cours via triggers ; une requête déjà autorisée peut néanmoins
   finir après révocation. Couper le flag suspend l'accès mais ne remplace pas
   une révocation D1 permanente : le réactiver peut restaurer une session non
   expirée/non révoquée.

Budgets D1 fixes, réservés même en cas d'échec : 5 créations/IP/5 min ;
90 autres opérations/IP/min ; pour password et OTP séparément, 20/compte/10 min
et 5/(compte, IP)/10 min ; les noms inconnus ont les mêmes compteurs. Après défi vérifié, les opérations pilot password/OTP partagent aussi les compteurs persistants du site : 60/IP/min, 300/IP/10 min, 20/compte/10 min (password et OTP ensemble), 5/compte+IP+type/10 min. Ceci peut freiner l'autre canal au seuil d'abus ; un défi non vérifié ne consomme pas ces compteurs partagés. Le refresh
est également limité à 8 tentatives par famille sur 10 minutes, sans bloquer logout.
OTP :
maximum 5 essais par transaction. La réponse `RATE_LIMITED` est 429 avec
`Retry-After: 600`, conservateur ; les fenêtres fixes autorisent une rafale à
leur frontière. Un attaquant peut épuiser le quota d'un compte ciblé ou déduire
une activité récente ; une IP partagée peut être bloquée. Les hash de compte et
IP sont pseudonymes, pas anonymes. Le nettoyage est borné et opportuniste.

Erreurs : `{"success":false,"code":"<code>","error":"Opération de connexion indisponible ou refusée."}` ; 400 `INVALID_REQUEST`/`HTTPS_REQUIRED`,
401 `INVALID_PROOF`/`AUTH_FAILED`, 403 `ORIGIN_MISMATCH`/`CHALLENGE_FAILED`,
409 `NOT_APPROVED`/`USED`, 410 `EXPIRED`, 429 `RATE_LIMITED`/`SLOW_DOWN`,
503 `METHOD_DISABLED`/`UNAVAILABLE`. La protection globale peut répondre avant
ce routeur. D1, SMTP et Siteverify sont en échec fermé. Le token de refresh
est 64 caractères hex aléatoires ; ne pas le mettre en paramètre d'URL.

Le navigateur avec le même IP peut appartenir à une autre personne derrière un
NAT ou à une ferme via proxy. Le code de comparaison peut être relayé ou la
victime contrainte. Le test automatisé reproduit le relais inter-IP en mode
challenge-only ; en mode login cette variante est rejetée, mais un relais sur IP
partagée reste possible. OTP et quotas réduisent l'impact sans prouver que le
solveur est l'utilisateur du PC. Acceptation explicite du risque résiduel,
revue externe et tests anti-énumération réels sont requis avant production.

### Tests reproductibles et limites

Dans ce dépôt (Node avec `node:sqlite`, dépendances npm installées) :

```sh
npx vitest run worker/__tests__/desktop-auth.test.ts src/__tests__/desktop-challenge-worker-contract.test.ts worker/__tests__/desktop-native-turnstile.test.ts
npm test
```

Le premier groupe teste le composant de défi relié au vrai Worker avec D1
SQLite et Siteverify simulés, puis password/OTP/session et logout ; les tests
Worker couvrent aussi mauvais mot de passe/compte, OTP erroné/expiré, quotas,
refus, relais inter-IP refusé, preuve incorrecte, reprise/réutilisation,
concurrence, annulation, modification de compte, perte de réponse, échec mail,
Siteverify et rollback D1 simulé. Les fonctions de messagerie reçoivent un code
fictif en mémoire ; les tests ne l'impriment pas. Ils ne prouvent ni la sécurité
contre un relais de même IP, ni un client Rust réel, ni le comportement D1,
mail, edge et fournisseur réels. `npm run build` et un `wrangler deploy --dry-run`
sont des validations locales, pas des déploiements.

### Vérification opérationnelle avant tout essai réel

`wrangler whoami` ici indique « not authenticated » : cela n'indique pas un
échec de l'intégration Cloudflare de l'utilisateur, seulement l'absence d'accès
CLI dans cette session. Aucun réglage effectif de dashboard, Logpush, proxy,
Workers tail, APM, outil de diagnostic client ou rétention n'a pu être inspecté ;
`observability.redact_query_string=true` est seulement le fichier suivi. Pas de
preuve d'absence de logs des corps ou en-têtes ni des journaux fournisseur/mail.
Ne fournir aucun secret en conversation. Un opérateur doit autoriser et fournir
l'accès approprié par le canal d'intégration ou réaliser l'inspection lui-même.

Avant tout déploiement, obtenir l'accord explicite et créer un environnement
staging séparé (Worker, domaine HTTPS, D1 neuf, mail et clés Turnstile de test,
sans comptes, secrets ou bindings de production). Vérifier configuration effective,
règles d'accès direct et `CF-Connecting-IP`, désactivation des captures de
bodies/Authorization et suppression des query strings dans Worker, proxy, WAF,
APM, Logpush, exports, tail et rétention ; utiliser seulement un marqueur
synthétique non secret dans une requête de diagnostic prévue pour cela, jamais
une preuve, un mot de passe, OTP ou token comme canari. Examiner aussi email,
client Rust et gestionnaire de crash. Restreindre l'accès, durée de rétention et
nettoyage historique. Si l'un de ces canaux est inconnu, échec de validation.

Ensuite, sur D1/Cloudflare réels, reproduire les tests automatisés du challenge
avec des clés compatibles avec les métadonnées strictes ; inspecter refus,
invalidations, courses et timeouts sans exposer leurs contenus. Vérifier que la
capture des secrets reste désactivée au niveau fournisseur ; ne pas augmenter
la verbosité pour déboguer. Les scénarios OTP, révocation et perte de réponse
sont couverts par des tests simulés mais restent à exécuter sur le service réel. Tests sur Android séparés sans
modifier le dépôt de référence. Ne pas confondre simulation SQLite avec D1 réel.

### Contrat exact du défi commun

Les règles communes HTTPS, port, origine, taille JSON et `no-store` ci-dessus
s'appliquent. Tous les appels sont POST JSON sans query. Champs additionnels
refusés ; toutes les valeurs entre chevrons sont des descriptions, pas des
valeurs de test. `id` = 64 hex minuscules CSPRNG ; `state` et `code_verifier`
suivent les mêmes règles et génération CSPRNG que le protocole téléphone.
`S256` est le base64url sans padding de SHA-256 du verifier ASCII. La preuve et
l'IP initiale sont obligatoires pour poll/cancel/consume ; changement d'IP
impose de recommencer. Le hash d'IP ne constitue ni anonymisation robuste ni
attestation ; aucune empreinte ni en-tête client n'est une attestation.

- `POST /api/auth/desktop/v2/pilot/requests` :
  `{"origin":"<origine exacte>","state":"<state>","code_challenge":"<S256>","code_challenge_method":"S256","device_label":"<nom>","presentation":"embedded_webview"}`. `presentation` est `embedded_webview` ou `system_browser` (omission = navigateur système historique). Le choix est lié à la demande.
  201 : `{"success":true,"data":{"version":2,"request_id":"<id>","origin":"<origine exacte>","pairing_code":"<5 caractères>-<5 caractères>","expires_in":300,"interval":5}}`.
  Le serveur génère aussi un `cdata` aléatoire, stocke le hash de state, le
  challenge, le hash IP et le label ; jamais le verifier brut. En mode intégré,
  construire `/login/desktop-challenge-embedded#request_id=<id>` ; en mode
  navigateur système, construire `/login/desktop-challenge#request_id=<id>`.
  Aucun state, verifier, mot de passe, OTP ni jeton dans l'URL. Le fragment est
  retiré de l'historique avant `prepare` et la référence ne doit pas être journalisée.
- `POST /api/auth/desktop/v2/pilot/browser/prepare` :
  `{"origin":"<origine exacte>","request_id":"<id>"}` et en-tête Origin
  exactement égal à l'origine. 200 : `{"success":true,"data":{"request_id":"<id>","origin":"<origine exacte>","device_label":"<nom>","pairing_code":"<code>","presentation":"<embedded_webview ou system_browser>","site_key":"<clé publique>","action":"atlas_desktop_v2","cdata":"<hex aléatoire 64>","expires_at":"<date ISO UTC>"}}`.
  Le navigateur système affiche origine, nom non attesté et code ; la page
  intégrée autonome affiche uniquement le défi et son état. Le client Rust ne
  lit ni cookies, stockage, JS, trafic ni token navigateur.
- `POST /api/auth/desktop/v2/pilot/browser/decision` : même en-tête Origin et
  soit `{"origin":"<origine>","request_id":"<id>","decision":"deny"}`,
  soit `{"origin":"<origine>","request_id":"<id>","decision":"approve","compare_confirmed":true,"turnstile_token":"<token>"}`.
  200 : `{"success":true,"data":{"status":"denied"}}` ou `verified`.
  En mode système l'approbation exige la comparaison ; en mode intégré elle
  contient seulement `origin`, `request_id`, `decision` et `turnstile_token`.
  Dans les deux cas le token est obligatoire ; le serveur revendique
  atomiquement pending→verifying puis appelle directement Siteverify et compare
  strictement hostname, action et cdata stockés. Port et PKCE sont liés à la
  ligne serveur, pas attestés par Siteverify. Échec, réponse malformée, timeout
  ou métadonnées incorrectes → `failed`, sans nouvelle tentative. Un crash
  peut laisser `verifying` jusqu'à expiration : recommencer, jamais fail-open.
- `POST /api/auth/desktop/v2/pilot/poll`, `/cancel`, `/consume` : chacun reçoit
  `{"origin":"<origine exacte>","request_id":"<id>","state":"<state>","code_verifier":"<verifier>"}`.
  Poll 200 : `{"success":true,"data":{"status":"<état>","request_id":"<id>","origin":"<origine>","interval":5}}` avec état `pending`,
  `verifying`, `verified`, `failed`, `denied`, `cancelled` ou `consumed`.
  Cancel 200 : `{"success":true,"data":{"status":"cancelled"}}`.
  Consume 200 : `{"success":true,"data":{"status":"consumed"}}` et **rien
  d'autre**. Une seule transition `verified→consumed` gagne. La perte de sa
  réponse est irrécupérable ; poll peut indiquer `consumed`, jamais réémettre
  d'autorisation. Expiration absolue 300 s, 60 polls max et 5 s entre polls.
  Budget D1 distinct : cinq créations/IP/fenêtre fixe de 300 s, 90 autres
  opérations/IP/fenêtre fixe de 60 s. Ce n'est pas un quota par compte et les
  fenêtres fixes permettent des rafales aux frontières.

Erreurs : `{"success":false,"code":"<code>","error":"Opération de connexion indisponible ou refusée."}` ; notamment 400 `INVALID_REQUEST`, 401
`INVALID_PROOF`, 403 `ORIGIN_MISMATCH`/`CHALLENGE_FAILED`, 409 `USED`/
`NOT_APPROVED`, 410 `EXPIRED`, 429 `SLOW_DOWN`/`RATE_LIMITED`, 503
`METHOD_DISABLED`/`UNAVAILABLE`. Les middleware globaux peuvent répondre en
premier. Une erreur ne permet jamais de basculer automatiquement vers un autre
mode. Ne pas journaliser requêtes, réponses, URL, token fournisseur ou preuves.

### Intégration Rust / WebView2 Windows à réaliser, non livrée ni validée

Ce dépôt ne contient pas le client Rust de connexion desktop. La liste suivante
est une **spécification d'implémentation**, pas du code exécuté ni une preuve de
compatibilité Turnstile/WebView2. Tant que ces contrôles et essais ne sont pas
réalisés, ne l'activer que sur un serveur de test isolé et seulement pour les essais explicitement autorisés. Le choix de navigateur
système doit rester une action native explicite ; créer une nouvelle transaction
après abandon/échec, jamais un basculement automatique ou un contournement.

1. Dans le client Windows, ajouter une option de build/configuration staging
   désactivée par défaut, distincte des flags serveur. Ne la proposer que pour
   l'origine de staging explicitement autorisée et `password_otp.available` ;
   ne pas interpréter `challenge: system_browser_turnstile` comme un test de
   prise en charge WebView2. Si Runtime WebView2 absent, création ou chargement
   impossible, fermer/annuler et proposer séparément le navigateur système.
2. Valider l'origine configurée avec un parseur d'URL : HTTPS, hôte non vide,
   pas de userinfo, chemin autre que `/`, query ni fragment ; comparer les origines
   canoniques exactes, port effectif inclus (y compris port non standard), avec
   l'origine renvoyée par le serveur et celle du navigateur. Certificat TLS
   valide obligatoire, aucun handler n'accepte une erreur certificat. Après
   création, valider version, ID `[a-f0-9]{64}`, origine, code, échéance et
   intervalle ; construire l'URL depuis l'origine validée et le chemin fixe,
   avec **seul** `#request_id=<id>` ; aucune query ni autre fragment. Ne pas
   journaliser l'URL même si le fragment n'est pas transmis en HTTP.
3. Générer state et verifier distincts par CSPRNG en mémoire native, S256 ;
   afficher le code de comparaison et l'origine dans l'UI native. Créer une
   fenêtre visible dédiée et temporaire WebView2, profil utilisateur neuf et
   isolé par tentative (dossier privé, suppression après fermeture du processus
   WebView2), sans profil de l'application ni session existante. Laisser les
   cookies/stockage internes nécessaires au fournisseur fonctionner, mais Rust
   ne les lit ni n'exporte, et ne lit ni DOM, JavaScript ni token Turnstile.
   Aucun `ExecuteScript`, injection, host object, message web, interception de
   requêtes/réponses, capture réseau, DevTools ou pont JS générique. Pas de
   navigation vers les écrans de login ni de champs identifiant/password/OTP
   dans la page ; saisir ces champs exclusivement dans l'interface native.
4. Installer les handlers **avant toute navigation**. Dans
   `CoreWebView2.NavigationStarting`, autoriser seulement l'URL de départ
   construite ci-dessus et, pour la navigation principale, HTTPS sur l'origine
   exacte avec chemin `/login/desktop-challenge-embedded`, sans query et sans fragment
   supplémentaire. Contrôler chaque redirection et annuler toute autre URL ou
   schéma, même si initiée par une sous-frame ; la suppression du fragment par
   `history.replaceState` ne doit pas être prise pour une preuve de succès.
   Ne pas autoriser par simple préfixe de chaîne ni autoriser toutes les pages
   de l'origine. Tester aussi navigation top déclenchée par iframe et
   redirections. `NewWindowRequested` : marquer traité et ne jamais ouvrir
   automatiquement une popup ni un navigateur. Bloquer téléchargements et
   demandes de permissions, désactiver menus de développement et raccourcis
   DevTools ; toute navigation interdite ou erreur fatale annule l'opération.
   Les sous-frames nécessaires à Turnstile sont distinctes de la navigation
   principale : ne pas bloquer aveuglément leur fonctionnement, mais leur
   interdire toute élévation vers une autre page principale. CSP et handlers ne
   constituent pas une sandbox de code malveillant de même origine.
5. Ne pas déduire la réussite d'une URL, fermeture de fenêtre, titre, message
   JS ou callback navigateur. Seul `/pilot/poll` depuis Rust avec
   `{origin,request_id,state,code_verifier}` en JSON, même IP et TLS sans
   redirection, peut annoncer `verified`. Une requête en vol ; au minimum 5 s
   entre polls, respecter `Retry-After`, maximum 60 et 300 s. Vérifier origin,
   ID, statut et échéance ; fermer la WebView après `verified`, puis appeler
   `/login/password` et `/login/otp` comme ci-dessus. `verified` n'est pas une
   session ; ne pas appeler `/consume` pour le login. Fermeture utilisateur,
   refus, échec, expiration, changement IP ou statut inattendu : arrêter le poll,
   annuler au mieux avec la preuve (`/pilot/cancel`, ou `/login/cancel` après
   password), effacer secrets de la mémoire et détruire la fenêtre/profil. Une
   réponse perdue après password ou OTP ne doit pas être rejouée pour obtenir
   des secrets ; abandonner et recommencer, session éventuellement orpheline.
6. Choisir et épingler versions du crate/binding WebView2, Runtime evergreen ou
   fixed version, SDK Windows et bibliothèque HTTP/TLS dans le dépôt desktop ;
   utiliser une API exposant tous les événements ci-dessus. Vérifier les
   correctifs Runtime et les versions OS supportées. Aucun crate ni version n'a
   été ajouté ici, aucun comportement API Windows n'est garanti par ce texte.

**CSP et dépendances.** La page intégrée est un document autonome, sans SPA,
service worker ni pont desktop, servi `no-store`, `no-referrer`, avec une CSP
spécifique. `script-src` autorise seulement la même origine et
`https://challenges.cloudflare.com`, `connect-src` la même origine et ce
fournisseur, `frame-src` le seul fournisseur ; `frame-ancestors 'none'`,
`base-uri 'none'`, `form-action 'none'` et `object-src 'none'`. La sous-frame
fournisseur et l'éventuel `about:blank` transitoire ne sont pas des navigations
principales autorisées. Le profil doit être vierge pour éviter un service worker
préexistant. Le navigateur système garde la page SPA et sa CSP partagée. Ni la
CSP ni les handlers ne protègent contre un serveur de même origine compromis.
Consulter le [contrat client](desktop-native-auth-v2-client.md) pour la CSP
complète et vérifier les dépendances réelles en test sans capturer les secrets.

**Plan de validation bloquant.** Sur Windows 10 et 11 réels, Runtime installé et
absent, tester lancement visible, interaction Turnstile réelle, succès,
refus, expiration, fermeture/annulation, rejeu, concurrence, réponse perdue,
IP modifiée/VPN, redirection, popup, navigation top par iframe et comparaison
avec port non standard. Répéter avec choix explicite navigateur système. Sur
Worker, D1, mail et Siteverify réels en staging isolé, vérifier atomismes,
métadonnées strictes, désactivation par défaut et les mêmes échecs ; inspecter
les logs effectifs Worker/edge/proxy/APM/client/mail avec marqueur non secret.
Ne pas contourner la validation si une clé de test n'émet pas les métadonnées
requises : obtenir une configuration compatible. Consigner versions, résultats
et risques sans secrets. Aucun de ces essais réels n'a été effectué dans cette
session : Linux sans WebView2 et Wrangler non authentifié ; la configuration
preview suivie réutilise des ressources production, elle n'est pas un staging
isolé. Aucun déploiement n'a été effectué. Les tests locaux utilisent des
simulations ; ils ne remplacent aucune de ces validations réelles. Voir le
[contrat client en anglais](desktop-native-auth-v2-client.md) pour les schémas et la reprise après perte de réponse.

### Risque de transfert et critères de blocage

Un attaquant peut créer sa propre transaction et son propre verifier, puis
convaincre une autre personne de résoudre **son** défi ; le code peut être
transmis, une ferme de défis le résoudre, ou une personne être contrainte.
Même avec l’égalité IP imposée pour le pilote credentials, un NAT
partagé, un header « desktop », une empreinte déclarée ou une case cochée ne
prouvent pas que le même humain ou logiciel effectue la connexion. Le cdata
empêche de substituer un token d'une autre transaction après vérification par
le fournisseur, mais ne prévient pas le relais du défi lui-même. Le détenteur
de l'ID peut aussi refuser une demande et causer un déni de service. Pas de
liaison à un compte dans la seule cérémonie du défi ; les quotas compte sont
appliqués ensuite par le pilote credentials. Ce pilote ne doit pas être activé
en production sans revue indépendante et acceptation explicite des risques.

Les tests exécutent composant navigateur et Worker avec D1 SQLite simulé et
Siteverify simulé, pas un navigateur système Rust ni Cloudflare réel. Avant
tout déploiement : tester D1 et Siteverify réels avec clés adaptées (les clés de
test peuvent omettre les métadonnées strictes), proxy/edge et redaction effective
de tous les logs, concurrence, interruption réseau et horloges ; inspecter aussi
Logpush, traces, producteurs et rétention historique. Aucun accès effectif à ces
paramètres n'a été vérifié ici. Évaluer séparément la compatibilité Android.

### Prototype Windows séparé — laboratoire isolé, non activé

Le prototype dans `experiments/windows-webauthn/` est une **bibliothèque de
laboratoire non reliée aux routes**, sans transport, inscription, authentification,
état persistant ni émission de session. Le Rust invoque l'API Windows
`WebAuthNAuthenticatorGetAssertion` en demandant UV ; son ABI FFI est inspiré des
préfixes v1 de [webauthn.h](https://github.com/microsoft/webauthn/blob/master/webauthn.h).
Le validateur TS isolé convertit strictement la signature ES256 DER vers le format
brut attendu par WebCrypto, puis utilise le vérificateur serveur existant avec
une politique RP/origine explicitement fournie, UV obligatoire et clé stockée.
Des tests logiciels signent réellement en ES256 et testent origine, RP, challenge,
UV, compte utilisateur, signature, compteur et DER malformé ; ils ne simulent
ni une machine Windows ni un état persistant. Le compteur retourné n'est **pas**
mis à jour automatiquement. Aucun compilateur Rust ni machine Windows n'était
disponible ici : le code natif/ABI reste non compilé et non validé. Les capacités
`windows_passkey` restent indisponibles.

Contrat Rust du laboratoire (API locale, **pas une route HTTP**) :

- `client_data(origin: &str, rp_id: &str, challenge: &str) -> Result<Vec<u8>, ...>`
  attend une origine HTTPS canonique, RP exactement égal à son hostname et un
  challenge base64url de 43 caractères ; encode le JSON exact WebAuthn
  `{"type":"webauthn.get","challenge":"<challenge>","origin":"<origine>","crossOrigin":false}`.
  La restriction RP=hostname est volontaire pour ce lab, pas une règle générale
  WebAuthn pour les domaines parents.
- Sous Windows, `unsafe get_assertion(hwnd, origin, rp_id, challenge)` exige un
  HWND valide du processus et retourne `LabAssertion { client_data_json,
  authenticator_data, signature_der, credential_id, user_handle }`, tous octets
  en mémoire ; aucun affichage, log, stockage ni appel réseau. L'appelant doit
  vérifier TLS/origine/port et obtenir une configuration serveur de confiance.
- `verifyWindowsLabAssertion` dans `verify.ts` reçoit `expectedOrigin`, `rpId`,
  `expectedChallenge`, `clientDataJSON`, `authenticatorData`, `signatureDER`,
  `userHandle?` (tous champs binaires en base64url sans padding) et `stored`
  (`publicKeyJwk` ES256, `counter`, `backupEligible`, `userHandle`) depuis un
  stockage de confiance. Résultat `{counter, backupState, uv}` ou erreur générique.
  `credential_id` doit servir à rechercher la clé en base, jamais à accepter une
  clé transmise par le client. Le challenge de production doit être CSPRNG,
  expirant et consommé atomiquement ; le lab ne fournit pas cette gestion, ni
  l'atomicité du compteur, ni la révocation/liaison compte.

Sur Windows 10 et 11 réels, avec Rust stable et les outils de compilation/SDK
Windows installés : préparer un RP de test HTTPS isolé et une passkey **de test**
découvrable déjà enregistrée ; depuis un terminal avec fenêtre, définir
`ATLAS_LAB_ORIGIN` et `ATLAS_LAB_RP_ID` (non secrets), puis lancer
`cargo test --manifest-path experiments/windows-webauthn/Cargo.toml -- --ignored`.
Faire un essai Windows Hello et un essai clé FIDO2, puis annuler l'UI Windows et
vérifier l'échec ; relever OS/version/authentificateur sans copier les assertions.
Ce smoke test emploie intentionnellement un challenge factice constant et ne
contacte aucun serveur : il ne prouve pas la vérification serveur ni le rejeu.
Pour un vrai test bout en bout, il reste à construire un harnais sécurisé qui
émet un challenge aléatoire à usage unique, conserve en mémoire l'assertion et la
transmet en POST TLS au validateur isolé avec une clé inscrite hors bande, puis
à tester les tamper/rejeu, concurrence et invalidation du compte/clé. Ne pas
improviser une route active ni enregistrer les valeurs dans des fichiers/logs.

Le clientDataJSON étant fourni à l'API par l'appelant, déclarer une origine HTTPS
ne prouve pas l'association de l'application native à cette origine. Décider
explicitement si les applications natives non attestées sont acceptées comme
cette origine, ou exiger un canal d'association vérifiable avant toute activation.
Le résultat cryptographique prouve la possession d'une clé et, si UV, une
vérification locale par l'authentificateur ; il ne prouve pas l'identité de
l'application ou de la personne devant le PC.

## Protocole téléphone v2

Toutes les routes ci-dessous sont sous `/api/auth/desktop/v2` et utilisent POST
avec `Content-Type: application/json` et `X-Device-Fingerprint`. Les appels
`phone/*` nécessitent aussi `Authorization: Bearer <session téléphone>` ; le
fingerprint téléphone doit être celui du jeton, associé au même compte dans
`trusted_devices`. Le PC utilise une empreinte distincte. Ces valeurs sont des
liaisons de session existantes, pas des preuves d'intégrité du logiciel.

### 1. Créer sur le PC

Générer séparément par CSPRNG `state` et `code_verifier` (32 octets minimum,
base64url sans padding) ; garder les deux dans la mémoire native uniquement.
`code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))`, sans padding.

`POST /api/auth/desktop/v2/requests` :

```json
{"origin":"https://inventaire.example:8443","state":"<state>","code_challenge":"<S256>","code_challenge_method":"S256","device_label":"PC bureau"}
```

`state` : 43–128 caractères base64url ; verifier : 43–128 caractères RFC 7636
`[A-Za-z0-9._~-]` ; challenge : exactement 43 caractères base64url. Le label
(1–60 caractères, sans contrôles/bidi/markup) est déclaratif et doit être
présenté comme non vérifié. Réponse 201 :

```json
{"success":true,"data":{"version":2,"request_id":"<hex aléatoire 64>","origin":"https://inventaire.example:8443","pairing_code":"ABCDE-FGHIJ","expires_in":300,"interval":5}}
```

Le serveur stocke le hash du state, le challenge, le fingerprint PC et un hash de
l'IP, jamais le verifier ni le state brut. Expiration absolue à 300 secondes.
Pour ouvrir la page mobile web, le QR encode uniquement cette URL de structure
fixe, construite par le client avec **son origine exacte** et l'ID reçu :
`https://inventaire.example:8443/login/desktop-phone#request_id=<id>` (exemple
fictif). Le fragment contient exactement un `request_id` hexadécimal de 64
caractères, sans paramètres supplémentaires ; aucune query n'est acceptée.
Il n'est pas envoyé en HTTP et la page le retire immédiatement de l'historique ;
un rechargement exige un nouveau scan. L'ID est une référence opaque éphémère,
**pas** une autorisation ni une preuve. Ne jamais inclure state, verifier,
bearer, OTP ou mot de passe dans le QR. Ne pas journaliser le lien ni le QR.

### 2. Préparer et décider sur le téléphone

Le téléphone ouvre l'URL dans le navigateur déjà connecté au même serveur
et port. La page n'accède qu'à la session de sa propre origine, vérifie le
format et retire le fragment avant d'envoyer la requête. Si seule l'application
Android native est connectée, cela ne connecte pas automatiquement le
navigateur : ouvrir une session web puis rescanner. Le téléphone doit comparer l'origine affichée **et la barre d'adresse du
navigateur** avec le serveur attendu ; il ne transmet jamais son bearer
à une autre origine. Une session téléphone valide et non révoquée est obligatoire.

`POST /api/auth/desktop/v2/phone/prepare` : `{"origin":"<origine exacte>","request_id":"<id>"}`.
Réponse **200** (dates fictives) :

```json
{"success":true,"data":{"request_id":"<id>","origin":"https://inventaire.example:8443","username":"alice","device_label":"PC bureau","pairing_code":"ABCDE-FGHIJ","consent_nonce":"<nonce hexadécimal 64 caractères>","expires_at":"2026-11-19T12:05:00.000Z","consent_expires_at":"2026-11-19T12:02:00.000Z"}}
```

Elle
n'approuve rien et n'émet aucun jeton. Le nonce expire après 120 s au maximum,
sans dépasser l'expiration de la requête. Une nouvelle préparation remplace le
nonce précédent. Le téléphone doit afficher le compte, le serveur, l'appareil
non vérifié et le code ; l'utilisateur doit comparer le code sur les deux
appareils avant de décider.

`POST /api/auth/desktop/v2/phone/decision` :

```json
{"origin":"<origine exacte>","request_id":"<id>","consent_nonce":"<nonce>","decision":"approve","compare_confirmed":true}
```

Avec le même bearer et fingerprint que la préparation, `decision` est `approve` ou `deny` ; `compare_confirmed: true` est requis pour
l'approbation. Réponse 200 avec `data.status` = `approved` ou `denied`. Le
nonce est lié à l'opération, au bearer téléphone, à l'appareil et au compte/rôle
courants. Réutilisation, changement de compte ou substitution sont refusés ; un
refus est terminal. L'approbation ne délivre aucun jeton. Un scan seul ne peut
pas autoriser une demande. Le téléphone ne reçoit ni state ni verifier.

### 3. Poll, annulation, échange sur le PC

Les chemins complets `POST /api/auth/desktop/v2/poll`,
`POST /api/auth/desktop/v2/cancel` et `POST /api/auth/desktop/v2/exchange`
reçoivent chacun :

```json
{"origin":"<origine exacte>","request_id":"<id>","state":"<state>","code_verifier":"<verifier>"}
```

Ces champs sont uniquement dans le corps HTTPS. Le client utilise au plus une
requête en vol et limite chaque délai HTTP à 15 secondes et au temps restant de
la demande ; sur `SLOW_DOWN` ou `RATE_LIMITED`, il respecte `Retry-After`.
Chaque appel vérifie state,
PKCE, origine/port, fingerprint et IP de création du PC. Poll renvoie `pending`
ou `approved`, sans jeton, au plus une fois toutes les 5 secondes et 60 fois.
`cancel` rend pending ou approved terminal. Une demande refusée, annulée,
expirée ou consommée ne peut pas être échangée.

Réponses de polling et d'annulation, HTTP 200 :

Polling :

```json
{"success":true,"data":{"status":"pending","request_id":"<id>","origin":"https://inventaire.example:8443","interval":5}}
```

Annulation :

```json
{"success":true,"data":{"status":"cancelled"}}
```

Après approbation, `/exchange` renvoie une seule fois, HTTP 200 :

```json
{"success":true,"data":{"token":"<session fictive>","token_type":"Bearer","username":"alice","role":"user","request_id":"<id>","origin":"https://inventaire.example:8443"}}
```

Le backend revalide le
compte/rôle/matériel et la présence de l'appareil téléphone, puis utilise un
`DB.batch` transactionnel : consommation conditionnelle et enregistrement de
l'appareil PC, sans réaffecter un fingerprint lié à un autre compte. Une seule
course gagne. Aucun jeton n'est renvoyé si le lot échoue. Si le serveur a
consommé la demande mais la réponse réseau est perdue, **ne pas réessayer pour
récupérer le jeton** : recommencer une nouvelle opération. Le PC conserve le
jeton dans le stockage sécurisé système ; la révocation via les appareils de
confiance invalide ensuite la session selon les règles existantes. Le jeton est
le format de session Atlas existant : ce contrat ne crée ni refresh token ni
nouvelle durée de session, et le jeton n'inclut pas de claim d'origine. Le
client doit donc isoler son coffre et toute session par origine exacte (port
inclus), ne pas partager un jeton entre serveurs, et effacer state/verifier
après succès ou abandon. Une interruption du processus impose une nouvelle
demande plutôt qu'une reprise depuis le stockage web.

### Limites, erreurs et état

États : `pending -> approved -> consumed`, `pending -> denied`, ou
`pending|approved -> cancelled` ; expiration depuis tout état. Admission D1
atomique : 5 créations/IP/5 min, 90 autres opérations/IP/min et 30
préparations/décisions par compte téléphone/5 min. Chaque admission consomme un
slot, même si la suite échoue ; les compteurs sont partagés entre isolats,
pseudonymes (hash, pas anonymes), fenêtres fixes, suppression bornée. L'IP est
réservée avant authentification téléphone ; le quota compte est appliqué à
l'identité authentifiée, jamais à un compte déclaré. Limites et D1 indisponibles
échouent fermé ; les limites peuvent causer un déni temporaire pour un compte ou
une IP partagée. Une empreinte/UA/native ne les augmente pas.

Erreurs JSON de forme `{success:false,code,error}` sans exception ni preuve :
`INVALID_REQUEST` 400/413, `REQUEST_TIMEOUT` 408, `HTTPS_REQUIRED` 400, `ORIGIN_MISMATCH` 403,
`UNAUTHORIZED` 401, `INVALID_PROOF` 401, `DENIED` 403, `EXPIRED` 410,
`CANCELLED`, `USED`, `NOT_APPROVED`, `ACCOUNT_CHANGED` 409, `RATE_LIMITED` ou
`SLOW_DOWN` 429 avec `Retry-After`, `METHOD_DISABLED` et `UNAVAILABLE` 503.
Les gardes globaux peuvent également répondre `SERVICE_UNAVAILABLE` 503,
`PAYLOAD_TOO_LARGE` 413 ou `WAF_BLOCKED` 403 avant le routeur v2.
Les erreurs ne doivent pas être interprétées comme une invitation à contourner
le protocole. L'ID étant une référence aléatoire de 256 bits, les réponses de
statut de cette opération ne révèlent pas l'existence d'un compte recherché.

## Windows WebAuthn : non disponible

Le pilote mot de passe/OTP ci-dessus est limité au staging. Turnstile n'est pas
une attestation native ni une preuve de l'identité du solveur. Le prototype
Windows reste indépendant et n'empêche pas les tests de ce pilote.

Pour un serveur auto-hébergé, le RP ID est un domaine, sans schéma ni port ;
l'origine HTTPS est distincte et conserve le port. Le serveur doit vérifier la
cohérence du RP ID avec l'origine configurée, puis vérifier l'origine exacte
attendue et le hash du RP ID dans chaque assertion ; il ne doit pas simplement
accepter une origine fournie par le client.
L'API Windows [`WebAuthNAuthenticatorGetAssertion`](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/nf-webauthn-webauthnauthenticatorgetassertion)
prend un RP ID et des données client de l'appelant ;
[`webauthn.h`](https://github.com/microsoft/webauthn/blob/master/webauthn.h)
ne démontre pas à lui seul une association serveur vérifiable entre une
application native et une origine web. L'[exemple Microsoft .NET MAUI](https://learn.microsoft.com/en-us/samples/dotnet/maui-samples/platformintegration-passkeys/) indique que son parcours Windows fait confiance à l'origine HTTPS directement, sans AASA ni Digital Asset Links ; il ne valide pas pour autant le modèle de confiance d'un client Rust arbitraire ni la configuration de chaque serveur Atlas. Aucune association officielle adaptée à
ces installations auto-hébergées n'a été validée ici : ne pas fabriquer un
origin ni élargir l'allowlist. Une solution future doit vérifier challenge, type,
origin exact, RP ID hash, UP/UV, signature, compte, compteur et rejeu et être
activée seulement après essais réels et revue de sécurité.

## Validation et sortie du mode expérimental

Un test contractuel associe la page mobile au vrai routeur Worker et à un
simulateur SQLite D1 pour créer, approuver et échanger. Les tests de la page mobile couvrent affichage, comparaison obligatoire,
refus, changement de compte, absence de session et absence de redirection.
Les tests Worker utilisent le vrai routeur et SQLite comme simulateur D1 pour
consentement, PKCE, isolation, substitution, révocation, limites, courses et
rollback. Ce n'est **pas** une validation du service Cloudflare D1 réel. Avant
activation : tests de contrat des deux clients, tests sur D1 staging réel,
essais manuels Windows 10 **et** 11 avec téléphone déjà connecté et port HTTPS
personnalisé, changement d'IP, certificat invalide, refus et perte de réponse.
Vérifier visuellement compte/serveur/code et la révocation des deux appareils.
Tester un authentificateur réel séparément avant toute future activation passkey.
Ne pas utiliser de secrets ou comptes de production.


## Audit de déploiement séparé : téléphone v2 et Android

Constats **du dépôt**, pas de l'environnement actif :

- `wrangler.jsonc` ne définit ni `DESKTOP_NATIVE_V2_DISCOVERY` ni
  `DESKTOP_NATIVE_V2_PHONE_APPROVAL`, donc la configuration suivie dans Git
  n'active pas le parcours. Des variables du dashboard ou d'un autre fichier de
  déploiement peuvent néanmoins différer ; vérifier les valeurs effectives sans
  publier de secrets. La capacité `available: true` indique les flags et une
  liaison D1 avec `prepare` et `batch`, pas un contrôle complet des permissions, clients ou de la santé D1.
- Le fichier active les journaux d'invocation et les traces persistantes avec
  `redact_query_string: true` (corrigé dans ce changement). Cela ne prouve pas
  la configuration effectivement déployée, ni l'expurgation de tous les autres
  systèmes ; une query interdite peut être capturée avant le refus Worker.
  Avant activation, l'opérateur doit examiner séparément Workers Logs/Traces,
  Logpush/tail consumers, proxy/CDN/WAF et journaux clients, désactiver ou
  expurger les URL, queries, corps et en-têtes sensibles de bout en bout et
  vérifier cette politique en staging avec des valeurs fictives. Le paramètre
  `redact_query_string` ne couvre pas à lui seul les corps ou Authorization.
  Vérifier aussi les réglages séparés de preview et l'absence de changement
  de configuration par dashboard ; aucun secret n'est modifié ici.
- Vérifier HTTPS et certificat, port et reconstruction d'URL par le proxy,
  provenance non falsifiable de `CF-Connecting-IP`, D1 primaire/cutover,
  droits de création des tables/index/triggers, transaction réelle du batch,
  caches et absence d'enregistrement des liens et QR ; pas de test en production.

**Android natif, non implémenté ici :** reconnaître uniquement le QR v2 à
chemin fixe et fragment unique `request_id` (distinct du QR historique),
valider l'origine HTTPS exacte et le port choisis par l'utilisateur, rejeter
les redirections et ne jamais envoyer le bearer à un autre serveur. Utiliser une
session téléphone existante et son fingerprint conforme au serveur, appeler
`phone/prepare`, vérifier tous les champs et délais, afficher compte, serveur,
label non vérifié et code, exiger une comparaison et une décision explicites,
puis appeler `phone/decision` avec le nonce de cette préparation. Gérer refus,
expiration, changement de compte, quotas et perte réseau sans approbation
silencieuse ni réutilisation de nonce ; effacer le contexte après décision ou
abandon. Une session Android ne connecte pas automatiquement le navigateur.
Conserver le lecteur QR historique séparé et ses comportements existants.
Un intent/deep link doit être validé strictement avant accès au coffre, sans
journaliser sa valeur ; une empreinte n'est ni identité ni attestation.

Valider ce contrat avec les équipes Rust et Android, un serveur de staging D1
réel, clients natifs réels et certificats valides avant toute activation. Ces
vérifications externes et les paramètres effectifs du dashboard restent non
vérifiés dans ce dépôt.

### Journaux historiques et compatibilité

Le Worker n'écrit plus le code OTP dans la console, y compris sur les hôtes de
preview, et ne journalise plus les exceptions brutes du transport d'e-mail OTP.
Les parcours de connexion et l'envoi d'e-mail restent inchangés ; les outils de
développement qui lisaient le code dans la console doivent utiliser une boîte
de test dédiée en staging. Les messages d'erreur globaux d'authentification ne
journalisent plus les exceptions brutes. Ces corrections ne prouvent pas que
les autres composants ou le fournisseur d'e-mail expurgent leurs propres logs.

Le lien OTP web historique contient des paramètres sensibles dans sa query ; il
n'est pas modifié ici pour préserver sa compatibilité. Il faut vérifier la
rédaction aux points d'accès, WAF, reverse proxies, tableaux de bord, tails,
exports et traces, ainsi que la rétention historique, indépendamment du réglage
Worker. Ne pas utiliser de valeur réelle pour tester les journaux. Les tokens
et preuves des nouvelles opérations v2 restent hors URL et hors QR.
