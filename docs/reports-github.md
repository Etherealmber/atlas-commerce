# Rapports & crashs → GitHub issues (v260)

Deux files, un seul destinataire : **les issues de votre dépôt GitHub** (défaut
`Etherealmber/atlas-commerce`). Aucun compte GitHub n'est requis côté utilisateur, aucun CLI
côté propriétaire — la configuration se fait dans l'app.

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
- Labels créés automatiquement : `crash-report`, `user-report`, `from-app`.

## 4. Configuration du token (propriétaire, dans l'app)

1. https://github.com/settings/personal-access-tokens/new → **Fine-grained token**
   → Repository access : le dépôt cible → Permissions : **Issues — Read and Write**
   (le compte doit pouvoir créer des issues sur ce dépôt). Gratuit.
2. App → **Paramètres → Intégrations → « Rapports & crashs → GitHub »** → coller le token
   (+ dépôt optionnel, défaut `Etherealmber/atlas-commerce`) → Enregistrer.
3. Alternative ops : secret d'environnement `GITHUB_ISSUE_TOKEN` (+ `GITHUB_ISSUE_REPO`) —
   le secret **a priorité** sur le token configuré dans l'app.

## 5. Endpoints

| Endpoint | Auth | Rôle |
|---|---|---|
| `POST /api/crash-reports` | publique (rate-limitée) | intake crash — 202, `{reference, deduped}` ; n'échoue jamais côté app |
| `POST /api/reports` | session (tout rôle, rate-limité) | signalement utilisateur — 201, `data: {reference, issue_url, already_reported, issue_status}` |
| `GET /api/admin/github-token` | owner | `{configured, source: env\|app, repo}` — jamais le token |
| `PUT /api/admin/github-token` | owner | `{token, repo?}` — validé contre GitHub avant stockage ; `token:""` efface |
| `GET /api/admin/reports?limit=` | owner/admin | crashs + signalements récents (D1, déjà assainis) + `pending` |
| `POST /api/admin/reports/retry` | owner | vide la file vers GitHub — 409 `GITHUB_NOT_CONFIGURED` sans token |

Format d'intake crash : `{message, stack?, componentStack?, route?, version?, ua?}` (JSON).

## 6. Tests

`worker/__tests__/reports.test.ts` : assainissement (Bearer/JWT/ghp_/atlas_ redactés,
troncatures), empreinte stable et distincte, intake D1 (insert + dédup `count=2`), file
d'attente sans token (`pending`), drain avec token via `fetch` stubbé (issue créée → `linked`
+ `issue_url`, échec GitHub → reste `pending`), priorité `env` > app pour le token, vue
admin (`listReports` + compteur `pending`).
