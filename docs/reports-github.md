# Rapports & crashs → GitHub issues (v260, canaux + triage IA en 0.9.3)

Deux files (crashs automatiques, signalements utilisateurs), **deux canaux** depuis 0.9.3 :

| Canal | Origine | Dépôt par défaut | Secret | Clé app (D1 `app_config`) |
|---|---|---|---|---|
| **web** | app web (ordinateur + navigateur du téléphone, client bureau) | `Etherealmber/atlas-commerce` | `GITHUB_WEB_ISSUE_TOKEN` (+ `GITHUB_WEB_ISSUE_REPO`) | `github_web_reports_token` / `_repo` |
| **android** | app Android native | `Etherealmber/atlas-commerce-android` | `GITHUB_ISSUE_TOKEN` (+ `GITHUB_ISSUE_REPO`) | token Android historique |

Chaque canal a **son propre token** : le token Android n'est jamais utilisé pour le dépôt web
(et inversement). Un canal sans token garde ses lignes en file ; rien n'est perdu.

Classement (`classifyReportChannel`) : `platform` / `client` explicite d'abord (le front envoie
`platform: 'web'`, ou `'android'` dans un shell natif) ; sinon User-Agent — `okhttp`, `dalvik`,
`retrofit`, `atlas-android` ou WebView (`; wv)`) → android, `Mozilla/…` → web ; inconnu → android
(comportement historique). Au premier démarrage 0.9.3, les crashs **en attente** venant d'un
navigateur sont reclassés une fois vers `web` : ils attendent donc le secret web.

Aucun compte GitHub n'est requis côté utilisateur, aucun CLI côté propriétaire — la
configuration se fait dans l'app.

## 1. Ce qui est rapporté

### Crashs automatiques (`crash_reports`)
Le front installe trois capteurs (`src/lib/crashReporter.ts`) :
- `window.addEventListener('error')` — erreurs globales non capturées ;
- `unhandledrejection` — promesses rejetées (le bruit réseau « failed to fetch » est ignoré,
  l'ErrorBoundary le traite déjà côté UX) ;
- `ErrorBoundary.componentDidCatch` — crashs React, avec la pile de composants.

Limites côté client : **max 5 envois par session**, dédupliqué par message+première frame,
`fetch keepalive` avec repli `sendBeacon`, n'interrompt jamais l'UI.

### Signalements utilisateurs (`user_reports`)
Page **À propos → « Signaler un problème »** (tout utilisateur connecté, tout rôle) :
type (bug / idée / autre), message libre (5–2000 caractères), contact facultatif, page courante
et version ajoutées automatiquement. Réponse : référence `R-<id>`, lien éventuel, `already_reported` et `issue_status`.

## 2. Confidentialité & assainissement (avant stockage ET avant GitHub)

- `redactSecrets()` retire : `Bearer …`, JWT (`eyJ…`), tokens GitHub (`ghp_`, `github_pat_`,
  `gho_`), clés Atlas (`atlas_`), `sk-…`, `gsk_…`, `re_…` et longs blobs base64/hex (data URLs).
- Troncatures : message 400, stack 4000, componentStack 2000, route 200, UA 200.
- IP des crashs : **SHA-256 tronqué** (contrôle d'abus uniquement, jamais l'IP en clair).
- Signalements utilisateur : uniquement le username/rôle du compte qui envoie (son propre compte).
- Le token GitHub n'est **jamais** renvoyé par l'API (statut `configured: true/false` seulement),
  jamais écrit dans les logs, et validé contre `GET api.github.com/user` avant stockage.

## 3. Déduplication & file d'attente

- Empreinte de crash = `sha256(message + 3 premières frames)` (16 hex). Une empreinte = une
  ligne D1 avec compteur d'occurrences ; côté GitHub, une **issue ouverte** portant l'empreinte
  dans le titre est recherchée avant création → un bug = une issue (les occurrences suivantes
  incrémentent le compteur D1).
- Signalements utilisateur : avant de créer une issue, le Worker déduplique par compte authentifié, dépôt configuré, type et message assaini **exact** (après suppression des espaces en début/fin). Des modifications du message, type ou dépôt créent un signalement distinct. Ce n'est pas une recherche sémantique ni une recherche globale des issues GitHub ; les signalements d'autres comptes et les anciennes lignes sans identité vérifiable ne sont pas rapprochés. Les messages contenant des secrets expurgés ne sont pas rapprochés afin d'éviter de confondre deux textes différents. Les identifiants de compte viennent du serveur, jamais du corps de la requête.
- Les doublons renvoient `already_reported: true` et la référence d'origine sans créer de nouvelle issue. Si le lien existe, une lecture GitHub vérifie son état actuel : `issue_status` vaut `open` ou `closed` avec `issue_url` validé. En attente, sans accès GitHub ou si la vérification échoue, les deux valent `null` : cela ne signifie pas que l'issue est ouverte ou fermée. Une première soumission renvoie `already_reported: false` et `issue_status: null` (même si une issue a été créée). Les créations simultanées identiques du même compte sont arbitrées en D1 avant l'appel GitHub. Les résultats externes après une coupure réseau restent indéterminés : GitHub n'offre pas de garantie d'exactement une création lors des reprises.
- La table `user_report_dedup` est initialisée automatiquement ; les outils de sauvegarde/copie applicatifs l'omettent. Une sauvegarde au niveau D1 est nécessaire pour préserver les empreintes, en plus des liaisons d'identité de `work_status_report_owners`. Après restauration/import, la réutilisation d'ID de compte ou la perte de ces tables peut affecter l'isolation et la déduplication.
- Sans token configuré (ou si GitHub échoue) : le rapport reste en file (`status pending`) et
  **rien n'est perdu** — `retryPendingReports()` rattrape la file :
  - via le **cron quotidien** (07:35 UTC, même déclencheur que les rappels finance) ;
  - via le bouton **« Renvoyer la file »** (Paramètres → Intégrations → Rapports & crashs) ;
  - automatiquement au prochain rapport envoyé une fois le token configuré.
- Labels créés automatiquement : `crash-report`, `user-report`, `from-app` (+ `severity:*` /
  `area:*` quand le triage IA est actif).
- **Budget par envoi** : un drain fait au plus `REPORTS_SUBREQUEST_BUDGET` appels sortants
  (défaut **40** ; le plan gratuit Workers autorise 50 sous-requêtes par invocation). Coût : ~4 par
  nouveau crash (recherche + triage + création + labels), ~3 par signalement. Au-delà, la réponse
  contient `more: true` et le reste part au prochain clic / cron.
- **Regroupement** : un même bug arrive souvent sous plusieurs empreintes (les frames contiennent
  les noms de bundle / numéros de ligne propres à chaque build). Dans un même drain, les crashs
  au **message identique** sont rattachés à **une seule issue**.

### Correctif 0.9.3 — « Renvoyer la file » créait 0 issue
Les appels GitHub utilisaient `fetch(…, { redirect: 'error' })`, que le runtime Workers **refuse**
(`TypeError` immédiate) : chaque appel échouait avant d'atteindre GitHub et la file restait
`pending`. Tout le code Worker utilise désormais `redirect: 'manual'` (une 3xx est traitée comme un
échec) — test `worker/__tests__/worker-fetch-redirect.test.ts`. Le même bug touchait l'envoi
d'e-mails Resend et la vérification anti-robot du client bureau.

## 3 bis. Triage IA des nouvelles issues (Groq, offre gratuite)

Facultatif. Chaque **nouvelle** issue (jamais les doublons ni les occurrences suivantes) passe
par un modèle Groq qui renvoie un JSON validé : titre clair, gravité, zone, résumé, cause probable,
pistes de correction, étapes de reproduction. Le corps reçoit une section « ### Analyse
automatique » et les labels `severity:{critical,high,medium,low}` / `area:*`. Si Groq échoue,
l'issue est créée telle quelle : le triage ne bloque jamais l'envoi.

| Variable | Défaut | Rôle |
|---|---|---|
| `GROQ_ISSUES_API_KEY` | repli sur `GROQ_API_KEY` | clé https://console.groq.com/keys (gratuite) |
| `GROQ_ISSUES_MODEL` | `openai/gpt-oss-120b` | meilleur modèle de l'offre gratuite pour ce raisonnement |
| `GROQ_ISSUES_DAILY_LIMIT` | `40` (max 900) | plafond quotidien d'analyses (compteur D1) |
| `GROQ_ISSUES_ENABLED` | activé si une clé existe | `false` pour couper |

Économie de quota (offre gratuite `gpt-oss-120b` : 30 req/min, 1 000 req/jour, 8 000 tokens/min,
200 000 tokens/jour) : prompt compact (stack tronquée, aucune donnée personnelle, secrets déjà
expurgés), `max_tokens` 700, `reasoning_effort: low`, `temperature` 0.2, sortie `json_object`,
délai 9 s, plafond quotidien, et **pause automatique** de 60 s à 6 h après un 429 (`retry-after`
respecté). Une clé séparée `GROQ_ISSUES_API_KEY` évite de consommer le quota d'Atlas Agent
(les limites Groq sont par organisation et par modèle : utiliser une autre organisation Groq
pour une isolation complète).

## 3 ter. Assistant GitHub Actions : analyse, prompt de correction, PR liées, fermeture

Workflow `.github/workflows/issue-ai.yml` (script `scripts/issue-ai.mjs`, aide pure
`scripts/issue-ai-lib.mjs`, tests `src/__tests__/issue-ai-lib.test.ts`). Il complète le triage
du worker : il tourne **dans GitHub**, donc aussi pour les tickets ouverts à la main.

| Événement | Action |
|---|---|
| Issue ouverte / rouverte / label `bug` ou `crash-report` | si c'est un bug (labels ou texte) : assignation (propriétaire du dépôt ou `ISSUE_ASSIGNEE`), extraction du contexte code (route → page, identifiants de la stack → `git grep` sur `src/` + `worker/`, ≤ 4 extraits), appel Groq, **un seul commentaire** : résumé, gravité/zone/confiance, cause probable, fichiers, étapes, correctif, vérification et un **prompt de correction** prêt à coller dans un agent de code (il exige un test, `tsc`, `vitest` et `Fixes #n`). Labels `ai-triaged`, `severity:*`, `area:*` (+ `needs-info` si le ticket est trop vague). |
| Commentaire `/atlas-triage` (OWNER / MEMBER / COLLABORATOR) ou « Run workflow » | relance l'analyse et **met à jour** le même commentaire. |
| PR ouverte / modifiée | chaque ticket cité reçoit « 🔗 Correctif en cours » (une fois par PR), le label `in-progress`, et l'auteur de la PR est assigné si la PR le ferme. |
| PR fusionnée | les tickets cités avec `Fixes/Closes/Resolves #n` (ou une branche `fix/123-…`, `issue-123`) reçoivent « ✅ Corrigé par #PR (sha) », le label `fixed`, et sont **fermés** (`completed`). PR fermée sans fusion : `in-progress` retiré. |

Configuration : secret de dépôt **`GROQ_API_KEY`** (Settings → Secrets and variables → Actions).
Variables facultatives : `GROQ_MODEL` (`openai/gpt-oss-120b`), `GROQ_DAILY_LIMIT` (25/jour,
compté via les commentaires marqués du jour), `GROQ_ENABLED=false`, `ISSUE_ASSIGNEE`.

Garde-fous : jamais sur les tickets `security` ni `no-ai` ; texte expurgé avant envoi (tokens,
JWT, jetons démo, e-mails, téléphones, IP) ; prompt ≤ ~10 000 caractères (≈ 2,5 k tokens,
compatible 8 k tokens/min) ; `reasoning_effort: low`, `max_completion_tokens` 1 100 ; un 429
Groq est simplement ignoré (rien n'est posté) ; le workflow ne **checkout jamais le code de la
PR** (`pull_request_target` lit seulement les métadonnées, checkout de la branche par défaut) et
n'échoue jamais à cause de l'assistant. Utiliser la même organisation Groq que le worker partage
le quota de 1 000 req/jour du modèle : prévoir une clé d'une autre organisation pour isoler.

## 4. Configuration des tokens (propriétaire, dans l'app)

Un token **par canal** :
1. https://github.com/settings/personal-access-tokens/new → **Fine-grained token**
   → Repository access : **uniquement** le dépôt du canal (`atlas-commerce` pour le web,
   `atlas-commerce-android` pour Android) → Permissions : **Issues — Read and Write**. Gratuit.
2. App → **Paramètres → API & Clés → « Rapports & crashs → GitHub »** → carte **App web** ou
   **App Android** → coller le token (+ dépôt optionnel) → Enregistrer.
3. Alternative ops : secrets `GITHUB_WEB_ISSUE_TOKEN` / `GITHUB_ISSUE_TOKEN` (+ `…_REPO`) —
   un secret **a priorité** sur le token du même canal configuré dans l'app (la carte affiche
   alors « Géré par le secret du Worker »).

## 5. Endpoints

| Endpoint | Auth | Rôle |
|---|---|---|
| `POST /api/crash-reports` | publique (rate-limitée) | intake crash — 202, `{reference, deduped}` ; n'échoue jamais côté app |
| `POST /api/reports` | session (tout rôle, rate-limité) | signalement utilisateur — 201, `data: {reference, issue_url, already_reported, issue_status}` |
| `GET /api/admin/github-token` | owner | `{configured, source, repo, channels: {web, android}, triage}` — jamais le token |
| `PUT /api/admin/github-token` | owner | `{token, repo?, channel?: web/android}` — validé contre GitHub avant stockage ; `token` vide efface |
| `GET /api/admin/reports?limit=` | owner/admin | crashs + signalements récents (D1, déjà assainis, avec `channel`) + `pending` + `pending_by_channel` |
| `POST /api/admin/reports/retry` | owner | vide la file vers GitHub — `{crashes, user_reports, more, by_channel}` ; 409 `GITHUB_NOT_CONFIGURED` sans aucun token |

Format d'intake crash : `{message, stack?, componentStack?, route?, version?, ua?, platform?}` (JSON).
Le client web ignore le bruit des extensions navigateur (`chrome-extension://`, `moz-extension://`…).

## 6. Tests

`worker/__tests__/reports.test.ts` : assainissement (Bearer/JWT/ghp_/atlas_ redactés,
troncatures), empreinte stable et distincte, intake D1 (insert + dédup `count=2`), file
d'attente sans token (`pending`), drain avec token via `fetch` stubbé (issue créée → `linked`
+ `issue_url`, échec GitHub → reste `pending`), priorité `env` > app pour le token, vue
admin (`listReports` + compteur `pending`).

`worker/__tests__/reports-channels.test.ts` : classement web/android, secrets séparés (le token
Android jamais utilisé pour le dépôt web), file web en attente du secret web, reclassement des
anciens crashs navigateur, regroupement par message + budget de sous-requêtes, triage Groq
(prompt sans données personnelles, parsing JSON, plafond quotidien, pause sur 429).
