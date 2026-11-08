# Connexion desktop par navigateur système — contrat v1

## Décision et compatibilité

Le QR PC existant (`POST /api/auth/qr/pc-session`, `/login/qr?t=…&mode=pc`, phone-bind, status, complete) reste **inchangé**, avec expiration à 60 secondes. Il ne fournit pas de PKCE, n’attache pas la création à un fingerprint desktop et n’assure pas le retour après une nouvelle connexion web. Étendre implicitement son contrat aurait changé la sécurité et les clients existants.

Le nouveau contrat est donc explicitement versionné : **`/api/auth/desktop/v1`**, écran **`/login/desktop`**, navigateur système + **polling**, sans callback. Il réutilise la vérification des sessions web, le parcours web existant (mot de passe, Turnstile lorsqu’il est configuré, OTP et autres protections existantes), `makeTokenV2` et l’enregistrement dans `trusted_devices`. Aucun nouveau secret, passkey ou Durable Object. Aucune permission métier supplémentaire.

**Liaison existante étudiée :** `authFailReason` vérifie la preuve du compte actif, le rôle courant et la révocation dans `trusted_devices`. Pour les sessions avec fingerprint, une empreinte différente est refusée ; à empreinte identique, une variation d’IP est actuellement tolérée. Sans fingerprint, l’IP doit correspondre. Ce comportement n’est pas modifié. Le nouveau protocole exige en plus une empreinte explicite et **la même IP desktop de création jusqu’à l’échange**. L’IP du navigateur peut être différente ; sa session est vérifiée normalement, sans `relaxSession`.

Le code livré concerne le Worker et le web. L’ouverture du navigateur système et le stockage système sécurisé du jeton sont à implémenter dans le futur client desktop, selon le contrat ci-dessous.

## Origine et transport — obligations du client desktop

- L’utilisateur choisit son serveur. Aucune origine de production codée en dur dans ce protocole.
- Origine canonique = `new URL(serveur).origin`, **HTTPS uniquement**, avec port non standard conservé. Pas d’identifiants dans l’URL ; installation à la racine, pas de préfixe `/sous-dossier`. Rejeter une sélection contenant query/fragment ou chemin non racine plutôt que la réinterpréter silencieusement.
- Vérifier le certificat TLS. **Ne suivre aucune redirection** des appels API. Chaque URL d’API doit avoir cette origine exacte et un chemin constant de ce document. Si l’IP desktop change entre création et échange, recommencer une demande.
- Générer séparément par CSPRNG : `code_verifier` (32 octets aléatoires encodés base64url sans padding, 43 caractères au minimum), `state` (32 octets aléatoires base64url, 43–128 caractères), et une empreinte d’installation desktop persistante (`X-Device-Fingerprint`, 16–128 caractères `[A-Za-z0-9._:-]`). Ne jamais copier l’empreinte du navigateur.
- Challenge = `BASE64URL(SHA256(ASCII(code_verifier)))`, sans padding, exactement 43 caractères. Seul **S256** est accepté ; verifier RFC 7636 : 43–128 caractères `[A-Za-z0-9._~-]`.
- Garder verifier/state/contexte de demande dans la mémoire du processus desktop. Ne jamais les transmettre au navigateur, à un callback ou au stockage web. Le **state**, non assimilable à un jeton de session, est la seule exception : il figure dans le fragment du lien d’autorisation pour relier l’écran web à la demande. Le verifier n’y figure jamais.
- Envoyer les secrets de preuve uniquement dans le corps JSON des appels HTTPS décrits ici. Aucune query string sur les POST. Ne journaliser ni corps, ni Authorization, ni verifier, ni CSRF, ni jeton final. Le serveur ne conserve que le challenge, le hash du state et les liaisons nécessaires, jamais le verifier ou le jeton final.

Toutes les réponses du protocole sont `Cache-Control: no-store`, `CDN-Cache-Control: no-store`, `Referrer-Policy: no-referrer`. L’écran web a aussi ces protections et est protégé contre l’iframe par la politique existante. Les IDs de demande et le state sont transportés dans un **fragment**, non envoyé en requête HTTP, et retirés de la barre d’adresse après sauvegarde du contexte dans sessionStorage.

## 0. Découverte

```http
GET /api/auth/desktop/v1/capabilities
```

```json
{"success":true,"data":{"version":1,"flow":"system_browser_pkce_polling","code_challenge_method":"S256","expires_in":300,"interval":5,"max_polls":60,"callbacks":false}}
```

Un ancien serveur peut répondre 401, 404 ou une page HTML : proposer alors les connexions **natives existantes ou le QR PC existant**. Ne pas supposer qu’un autre endpoint existe. Une erreur de TLS/origine ne doit jamais entraîner de repli automatique vers un serveur différent ou une connexion moins sûre. Ne pas traiter un refus/une mauvaise preuve d’un serveur v1 comme une raison de contourner le protocole.

## 1. Création — desktop anonyme

```http
POST /api/auth/desktop/v1/requests
Content-Type: application/json
X-Device-Fingerprint: <empreinte desktop>
```

```json
{"origin":"https://inventaire.example:8443","state":"<state aléatoire>","code_challenge":"<S256>","code_challenge_method":"S256","device_label":"Mon ordinateur"}
```

Tous les champs sont obligatoires sauf `device_label` (défaut `Atlas Desktop`, 1–60 caractères, sans contrôles/bidi/markup). Les champs inconnus, dont `redirect_uri`, `callback`, `username` ou `role`, sont refusés. Le nom d’appareil est **déclaratif**, pas une attestation.

Réponse **201** :

```json
{"success":true,"data":{"version":1,"request_id":"<64 caractères hex aléatoires>","origin":"https://inventaire.example:8443","state":"<state initial>","authorization_url":"https://inventaire.example:8443/login/desktop#request_id=<id>&state=<state>","pairing_code":"ABCD-EFGH","expires_at":"<ISO UTC>","expires_in":300,"interval":5}}
```

Vérifier version, origine et state contre le contexte en mémoire. Avant d’ouvrir `authorization_url` avec l’API **navigateur système**, vérifier origine exacte, pathname `/login/desktop`, absence de query/credentials et fragment composé uniquement des `request_id`/`state` attendus. Ne pas ouvrir une URL de réponse arbitraire.

Afficher le `pairing_code` et le serveur dans le desktop. Ce code sert à comparer les deux écrans, **pas** à échanger un jeton. L’utilisateur ne doit jamais approuver un code envoyé par une autre personne.

La demande expire **300 secondes après création**, sans prolongation à la connexion ou à l’approbation. Le serveur choisit un ID imprévisible et conserve immuables origine, state hash, challenge, empreinte desktop et hash de son IP.

## 2. Connexion et consentement — navigateur uniquement

Si le navigateur n’est pas connecté, `/login/desktop` conserve uniquement `{request_id, state, origin, expiresAt}` dans **sessionStorage du même onglet**, puis ouvre `/login`. Après connexion web et OTP si requis, le retour est toujours le chemin fixe **`/login/desktop`**, jamais un `return_to` fourni dans une URL ou le stockage. Les autres connexions conservent leurs destinations habituelles. Si le stockage est inaccessible ou la demande expirée, recommencer sur le desktop.

L’écran prépare un consentement après validation normale du bearer et du fingerprint **du navigateur**, sans approuver la demande :

```http
POST /api/auth/desktop/v1/prepare
Authorization: Bearer <session web existante>
Origin: https://inventaire.example:8443
X-Device-Fingerprint: <empreinte navigateur>
Content-Type: application/json
```

```json
{"request_id":"<id>","origin":"https://inventaire.example:8443","state":"<state initial>"}
```

Réponse **200** :

```json
{"success":true,"data":{"request_id":"<id>","origin":"https://inventaire.example:8443","username":"alice","device_label":"Mon ordinateur","pairing_code":"ABCD-EFGH","csrf_token":"<nonce hex 64 caractères>","expires_at":"<ISO UTC>","consent_expires_at":"<ISO UTC>"}}
```

La nonce est liée à la demande, à l’état, au compte/rôle courant, au bearer et à l’empreinte du navigateur ; elle expire sous **120 secondes**, sans dépasser l’expiration de la demande. Une nouvelle préparation remplace la nonce précédente. L’écran affiche explicitement compte, serveur, nom non vérifié et code ; « Autoriser » est désactivé tant que la comparaison du code n’a pas été cochée. Un GET, le chargement du lien ou la connexion web seule **n’autorise rien**.

Après une action explicite :

```http
POST /api/auth/desktop/v1/authorize
```

Mêmes en-têtes web, corps :

```json
{"request_id":"<id>","origin":"https://inventaire.example:8443","state":"<state initial>","csrf_token":"<nonce prepare>","decision":"approve"}
```

`decision` vaut exactement **`approve`** ou **`deny`**. Réponse **200** :

```json
{"success":true,"data":{"status":"approved"}}
```

ou `status: denied`. L’origine HTTP doit correspondre exactement ; un `Sec-Fetch-Site` cross-site est refusé. La session navigateur est vérifiée à nouveau, et la transition n’est possible qu’une fois depuis `pending`, avec la nonce et l’acteur attendus. Pas de choix d’un autre compte via JSON. Après décision, le contexte web est effacé et le navigateur invite à revenir dans le desktop — **sans redirect ni callback**.

## 3. Polling borné — desktop uniquement

```http
POST /api/auth/desktop/v1/poll
Content-Type: application/json
X-Device-Fingerprint: <empreinte desktop initiale>
```

```json
{"request_id":"<id>","origin":"https://inventaire.example:8443","state":"<state initial>","code_verifier":"<verifier initial>"}
```

Réponse **200** :

```json
{"success":true,"data":{"status":"pending","request_id":"<id>","origin":"https://inventaire.example:8443","state":"<state initial>","interval":5}}
```

Statuts : `pending`, `approved`, `denied`, `cancelled`. **Aucun jeton ni identité** dans les réponses de polling. State, origine, PKCE, empreinte et IP de création sont vérifiés aussi pour poll/cancel. Le client revérifie l’origine/state/ID de réponse avant toute suite.

- Timeout de chaque requête HTTP : **15 secondes maximum**, toujours borné aussi par la durée restante de demande.
- Un seul polling en vol ; au moins **5 secondes** entre débuts d’essai acceptés.
- Maximum **60 polls acceptés** par demande ; arrêter également à `expires_at`, au refus, à l’annulation, à `USED` ou `EXPIRED`.
- Sur `SLOW_DOWN`, attendre au moins le `Retry-After` ; sur quota, pas de boucle immédiate. Une erreur ne prolonge pas l’expiration.
- Après `approved`, arrêter le polling et passer à l’échange.

## 4. Échange à usage unique — desktop uniquement

```http
POST /api/auth/desktop/v1/exchange
```

Mêmes en-têtes et **même corps que poll**. Réponse **200** :

```json
{"success":true,"data":{"token":"<session Atlas v2>","token_type":"Bearer","username":"alice","role":"user","request_id":"<id>","origin":"https://inventaire.example:8443","state":"<state initial>"}}
```

Le serveur vérifie à nouveau S256, state, origine, empreinte/IP desktop, expiration, statut `approved`, compte actif, rôle et matériau de session inchangés depuis le consentement, et appareil approbateur encore enregistré. Il fabrique le **format de session existant**, lié à l’IP et à **l’empreinte du desktop**, pas à celle du navigateur. La consommation est une transition D1 conditionnelle atomique ; un seul échange concurrent peut gagner. Le desktop est enregistré dans `trusted_devices` avant de transmettre le jeton. Si cet enregistrement échoue après consommation, aucun jeton n’est transmis et il faut **recommencer une nouvelle demande**.

Le jeton n’apparaît que dans ce corps HTTPS. L’origine est liée à la demande et vérifiée dans le protocole ; le format v2 existant n’ajoute pas de claim issuer/origin. Ne pas partager le domaine de confiance (DB/credentials) entre serveurs supposés indépendants, et isoler les sessions du client par origine. Il n’existe pas de nouveau refresh token, ni de nouvelle durée de session : les règles existantes de session/révocation restent applicables. Valider l’origine/state/ID de la réponse, puis ranger la session dans le coffre système, indexée par serveur et appareil. Ne pas journaliser, copier dans une URL ou accepter un jeton reçu via une prétendue URL de callback. Effacer la preuve de demande après succès/abandon ; après redémarrage du processus, recommencer plutôt que restaurer une preuve depuis le stockage web.

## 5. Annulation

```http
POST /api/auth/desktop/v1/cancel
```

Mêmes en-têtes et corps que poll. Depuis `pending` ou `approved`, réponse **200** :

```json
{"success":true,"data":{"status":"cancelled"}}
```

L’annulation répétée est idempotente tant que la demande n’est pas expirée. Après consommation, elle ne révoque pas une session déjà émise : employer le mécanisme de révocation d’appareils existant. Une demande refusée ne peut pas redevenir approuvée.

## Erreurs et quotas

Toutes les erreurs du module ont le format :

```json
{"success":false,"code":"EXPIRED","error":"Demande expirée : recommencez sur le desktop."}
```

Le gate web existant peut renvoyer ses codes habituels `UNAUTHORIZED`, `IP_CHANGED`, `DEVICE_CHANGED`, `DEVICE_REVOKED` avant prepare/authorize. Reconnexion web normale, pas de contournement.

| HTTP | Code | Action desktop/web |
| --- | --- | --- |
| 400 / 413 | `INVALID_REQUEST` | Types/champs/tailles/en-têtes invalides ; JSON max 8 Kio ; corriger le client |
| 400 | `HTTPS_REQUIRED` | Choisir une origine HTTPS ; pas de downgrade |
| 400 / 403 | `ORIGIN_MISMATCH` | Arrêter ; ne pas changer d’origine en cours de demande |
| 401 | `INVALID_PROOF` | State, PKCE, IP ou empreinte incorrects ; arrêter/recommencer, jamais fallback d’auth automatique |
| 401 | `UNAUTHORIZED` | Connexion web habituelle obligatoire |
| 403 | `CSRF_INVALID` | Nonce absente, remplacée, expirée ou mauvais acteur ; recharge de l’écran ou nouvelle demande |
| 403 | `DENIED` | Arrêter, refus explicite |
| 404 | `NOT_FOUND` | Demande absente/nettoyée ; recommencer |
| 409 | `NOT_APPROVED` | Pas encore autorisée ; revenir au polling borné |
| 409 | `CANCELLED` / `USED` | Arrêter, aucune nouvelle émission |
| 409 | `ACCOUNT_CHANGED` | Compte/rôle/credentials/appareil approbateur modifiés ; recommencer |
| 410 | `EXPIRED` | Recommencer depuis le desktop |
| 429 | `SLOW_DOWN` | Attendre le `Retry-After` (5 s) |
| 429 | `RATE_LIMITED` | Arrêter la demande ou respecter le délai serveur, pas de retry serré |
| 503 | `UNAVAILABLE` | Aucun secret dans l’erreur ; si échange incertain, recommencer sans rejouer une session depuis un callback |

Budgets persistants D1 par IP : **5 créations / fenêtre fixe de 5 minutes**, **90 autres opérations / fenêtre fixe d’1 minute**, y compris les tentatives invalides. En plus : 5 s entre polls, 60 polls max, expiration absolue 300 s. Les budgets login/OTP/QR existants sont inchangés ; seuls les chemins exacts de ce nouveau contrat utilisent ces quotas dédiés. Les chemins publics exacts sont capabilities/requests/poll/exchange/cancel ; **prepare/authorize restent derrière le gate web normal**. Aucune exemption générale d’auth ou liée à un header « native ».

Les décisions et l’échange sont aussi enregistrés dans l’audit existant (`auth.desktop_approve`, `auth.desktop_deny`, `auth.desktop_exchange`) avec identité/IP et détail fixe `desktop_v1`, sans state, nonce, verifier ou jeton. L’échange alimente le suivi de connexion existant. Les erreurs console du module ne contiennent que des codes fixes.

Les nonces et marqueurs de version des credentials sont effacés dès le refus, l’annulation ou la consommation ; aucun jeton de session n’est stocké dans ces tables.

Les tables `desktop_auth_v1` et `desktop_auth_limits_v1` sont créées de façon idempotente sur D1 existant ; pas de migration ou binding de secret supplémentaire. À chaque création, nettoyage des demandes expirées depuis plus d’une heure et des fenêtres de quotas expirées. L’expiration logique reste vérifiée à chaque opération, même avant nettoyage. Dans un déploiement non Cloudflare derrière proxy, les en-têtes d’IP doivent venir d’un proxy de confiance ; une IP `unknown` est refusée par ce protocole.

## Vérifications livrées et limites

- Tests sur le vrai Worker + SQLite D1 : session web ouverte/non ouverte, vrai login + OTP obligatoire, mauvais OTP, Turnstile non contourné, origine auto-hébergée avec port, rôle owner/user conservé, refus/annulation/expiration, state/proof/ID/origine/fingerprint/IP incorrects, CSRF, substitution de demande/acteur, double consommation concurrente, révocation/changement de compte, quotas et erreurs sans secrets.
- Tests DOM : sauvegarde/restauration du contexte au retour de connexion, absence d’approbation automatique, comparaison + clic explicite, refus, chemin de retour fixe, callback/query rejetés, fetch same-origin sans redirect/referrer, erreurs non réaffichées/loggées brutes.
- Régression du QR PC existant : création 60 s, approbation, émission et rejeu refusé. Les tests login/OTP/révocation existants restent applicables.
- Le protocole limite la substitution et impose la comparaison entre écrans ; comme tout device authorization, il ne supprime pas le phishing si l’utilisateur choisit sciemment d’approuver une demande initiée par un tiers. L’UI le signale explicitement.
- Pas de binaire desktop, d’ouverture réelle du navigateur système ou de déploiement production exécuté ici. Les tests DOM utilisent un environnement de test et le test de retour de connexion isole la page login ; le vrai OTP est testé séparément sur le Worker.

### Validation locale

Suite complète : **374 tests / 26 fichiers**, dont **42 tests ajoutés** (32 Worker, 10 DOM). Build Vite et contrôle CSS OK ; lint sans erreur. TypeScript reste à sa baseline existante de 71 erreurs Worker et 74 client, sans nouvelle erreur dans les fichiers ajoutés.
