# Connexion desktop native v2 : approbation par téléphone (expérimental)

## État et limites

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

Le mot de passe/OTP natif et les passkeys Windows **ne sont pas implémentés** et
restent indisponibles, quels que soient les drapeaux WebAuthn/Turnstile. Le
navigateur système v1 reste un choix explicite, jamais un repli automatique
après refus, erreur de preuve, TLS ou origine. Ce changement ne modifie pas les
routes v1, web, Android ou l'ancien QR. Aucune release ni déploiement effectué.

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
   présence du code. `DB` doit être lié pour annoncer la méthode. Un échec D1
   reste possible à l'exécution et renvoie 503.
3. Le Worker exige `CF-Connecting-IP` pour chaque opération ; l'opérateur doit
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
  pour mot de passe/OTP. Aucune route v2 de mot de passe/OTP n'existe ici et
  l'exemption native historique de `/api/auth/login` n'est pas étendue. Le
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

## Mot de passe natif et Windows WebAuthn : bloqués

Turnstile est un défi web, pas un widget Rust. Un marqueur natif, user-agent ou
fingerprint ne prouve ni intégrité ni absence d'abus. Évaluer avec l'opérateur
un vérificateur natif réellement attestable et sa politique de panne avant
d'ajouter une route mot de passe/OTP. Sans alternative fiable, utiliser v1 en
navigateur au choix explicite. Une future route devrait conserver les budgets
IP/compte existants et créer un défi OTP temporaire lié à l'opération, sans
conserver ou redemander le mot de passe, sans oracle d'existence de compte.

L'API Windows [`WebAuthNAuthenticatorGetAssertion`](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/nf-webauthn-webauthnauthenticatorgetassertion)
prend un RP ID et des données client de l'appelant ;
[`webauthn.h`](https://github.com/microsoft/webauthn/blob/master/webauthn.h)
ne démontre pas à lui seul une association serveur vérifiable entre une
application native et une origine web. Aucune association officielle adaptée à
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
