# Atlas Commerce — Setup complet, du tout premier départ

> Guide pas à pas pour déployer **votre** instance d'Atlas Commerce (ERP/POS auto-hébergé sur
> Cloudflare). Aucune connaissance de Cloudflare requise. Deux chemins sont documentés :
> **A. sans CLI** (tout dans le navigateur — Workers Builds + dashboard) et **B. avec wrangler**
> (terminal). Le README garde un démarrage rapide local ; ce fichier est la référence complète.

Sommaire :
1. [Prérequis & comptes](#1-prérequis--comptes)
2. [Récupérer le code](#2-récupérer-le-code)
3. [Ressources Cloudflare (base de données & stockage)](#3-ressources-cloudflare-base-de-données--stockage)
4. [Bindings `wrangler.jsonc`](#4-bindings-wranglerjsonc)
5. [Secrets & clés API — où obtenir chaque clé](#5-secrets--clés-api--où-obtenir-chaque-clé)
6. [Déployer (chemin A : sans CLI / chemin B : wrangler)](#6-déployer)
7. [Domaine personnalisé + e-mail OTP](#7-domaine-personnalisé--e-mail-otp)
8. [Premier démarrage & vérification](#8-premier-démarrage--vérification)
9. [Rapports & crashs → GitHub issues](#9-rapports--crashs--github-issues)
10. [Passkeys (WebAuthn) & app Android](#10-passkeys-webauthn--app-android)
11. [Exploitation courante](#11-exploitation-courante)

---

## 1. Prérequis & comptes

| Compte | Gratuit ? | Lien | Sert à |
|---|---|---|---|
| **GitHub** | oui | https://github.com/signup | Code, déploiement Workers Builds, issues (crashs/signalements) |
| **Cloudflare** | oui (plan Free suffit) | https://dash.cloudflare.com/sign-up | Worker, D1 (base), KV (cache), R2 (images/APK), e-mail OTP |
| Node.js ≥ 20 | — | https://nodejs.org | Uniquement pour le développement local / chemin B |

Comptes **optionnels** selon les fonctions voulues (tout est en plan gratuit au démarrage) :

| Fournisseur | Lien console | Fonction dans Atlas |
|---|---|---|
| Groq | https://console.groq.com/keys | Atlas Agent (assistant IA) — `GROQ_API_KEY` |
| Google AI Studio | https://aistudio.google.com/apikey | Vision/OCR documents — `GEMINI_API_KEY` |
| Resend | https://resend.com/api-keys | E-mails transactionnels — `RESEND_API_KEY` |
| Cloudflare Turnstile | https://dash.cloudflare.com/?to=/:account/turnstile | Anti-bot login — `TURNSTILE_SECRET_KEY` (clé publique déjà dans `wrangler.jsonc`, remplacez par la vôtre) |
| Firebase | https://console.firebase.google.com | Push notifications Android (FCM) — `FIREBASE_*` |

> Aucune de ces clés n'est obligatoire pour démarrer : sans elles, la fonction correspondante
> se désactive proprement (l'Agent répond « non configuré », pas d'OTP e-mail, etc.).

## 2. Récupérer le code

```bash
# via GitHub CLI (recommandé) : fork + clone
gh repo fork Etherealmber/atlas-commerce --clone=true
cd atlas-commerce
npm install
```

Sans terminal : **Fork** sur https://github.com/Etherealmber/atlas-commerce (bouton en haut à
droite) — le chemin A (§6) n'a besoin de rien d'autre.

## 3. Ressources Cloudflare (base de données & stockage)

Tout se crée dans le dashboard (https://dash.cloudflare.com) :

1. **D1 (base de données SQLite managée)** — *Storage & databases → D1 → Create database*
   → nom : `company-stock-db` (ou le vôtre). Notez son **database_id** (onglet Details).
   Docs : https://developers.cloudflare.com/d1/
2. **KV (cache)** — *Storage & databases → KV → Create namespace* → nom : `company-stock-cache`.
   Notez l'**id**.
3. **R2 (objets : images produits + APK/mises à jour)** — *R2 → Create bucket* →
   nom : `company-stock-images`. (R2 demande une carte mais reste gratuit sous 10 Go —
   aucune facturation en usage normal.)
4. **Worker** — créé automatiquement au premier déploiement (§6), nom `company-stock`.

Le schéma SQL est appliqué automatiquement au démarrage : le worker crée ses tables à la volée
(`CREATE TABLE IF NOT EXISTS` + colonnes ajoutées par migrations idempotentes). Vous pouvez aussi
pré-appliquer `schema.sql` et le dossier `migrations/` (§6 chemin B).

## 4. Bindings `wrangler.jsonc`

Remplacez les ids par les vôtres (les ids ne sont **pas** des secrets — l'accès exige votre
compte Cloudflare de toute façon) :

```jsonc
"d1_databases": [{ "binding": "DB", "database_name": "company-stock-db",
                   "database_id": "<VOTRE_ID_D1>" }],
"kv_namespaces":  [{ "binding": "CACHE", "id": "<VOTRE_ID_KV>" }],
"r2_buckets":     [{ "binding": "IMAGES", "bucket_name": "company-stock-images" }],
```

Les `vars` du fichier sont **publiques par conception** (configuration non sensible :
`WEBAUTHN_*`, `TURNSTILE_SITE_KEY`, `ENVIRONMENT`…). Tout ce qui est sensible va dans les
**Secrets** (§5) — jamais dans `vars`, jamais dans le dépôt.

## 5. Secrets & clés API — où obtenir chaque clé

À régler dans **Workers → company-stock → Settings → Variables and Secrets → Secret** (chemin A)
ou `npx wrangler secret put NOM` (chemin B) :

| Secret | Obligatoire ? | Où l'obtenir | Rôle |
|---|---|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | **oui** | valeurs de votre choix (mot de passe fort) | compte propriétaire initial |
| `JWT_SECRET` | **oui** | générez 64 caractères aléatoires (ex. https://1password.com/password-generator/) | signature des tokens de session |
| `CRON_SECRET` | conseillé | valeur aléatoire | protège `POST /api/cron/*` (déclencheurs externes) |
| `GROQ_API_KEY` | pour l'Agent IA | https://console.groq.com/keys (gratuit) | Atlas Agent (LLM rapide) ; `GROQ_MODEL` optionnel |
| `GEMINI_API_KEY` | pour la vision/OCR | https://aistudio.google.com/apikey (gratuit) | lecture de documents/photos (factures, CIN) |
| `RESEND_API_KEY` / `RESEND_FROM` | pour l'e-mail | https://resend.com/api-keys + domaine vérifié | OTP et rapports par e-mail (alternative au binding Send-Email CF) |
| `TURNSTILE_SECRET_KEY` | conseillé | https://dash.cloudflare.com/?to=/:account/turnstile | challenge anti-bot au login (site key publique dans `wrangler.jsonc`) |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | pour le push Android | https://console.firebase.google.com → projet → Paramètres → Comptes de service | notifications FCM |
| `ANDROID_RELEASE_TOKEN` | pour les releases APK | valeur aléatoire | ingestion des builds APK par la CI (`POST /api/admin/android-release`) |
| `PARTNER_API_KEY(S)` | pour l'API partenaire | valeur aléatoire (`atlas_…`) | authentification Partner API v1 (`PARTNER_API.md`) |
| `BACKUP_TOKEN` / `ADMIN_BACKUP_TOKEN` / `BACKUP_ENCRYPTION_KEY` | pour les sauvegardes | valeurs aléatoires | snapshots chiffrés + restauration |
| `GITHUB_ISSUE_TOKEN` | **non** — voir §9 | https://github.com/settings/personal-access-tokens/new | crashs/signalements → issues GitHub (configurable aussi dans l'app, sans CLI) |

Règle d'or : un secret ne se commit **jamais**. `.dev.vars` (local) est gitignoré.

## 6. Déployer

### Chemin A — sans CLI, 100 % navigateur (recommandé si vous n'avez pas de PC de dev)

1. Forkez le dépôt sur GitHub.
2. Dashboard Cloudflare → **Workers & Pages → Create → Import from GitHub** → votre fork.
   Docs : https://developers.cloudflare.com/workers/ci-cd/builds/
3. Build command : `npm run build` · Build output : `dist` · Worker name : `company-stock`.
   (Le fichier `wrangler.jsonc` du dépôt fournit tout le reste.)
4. Chaque `git push` sur la branche par défaut redéploie automatiquement.
5. Réglez les ids D1/KV/R2 (§4) via un commit, et les Secrets (§5) dans
   **Settings → Variables and Secrets**.

### Chemin B — wrangler (terminal)

```bash
npx wrangler login
npx wrangler d1 create company-stock-db        # → copiez l'id dans wrangler.jsonc
npx wrangler kv namespace create CACHE         # → copiez l'id
npx wrangler r2 bucket create company-stock-images
npx wrangler d1 execute DB --remote --file=schema.sql
npx wrangler d1 migrations apply DB --remote
npm run build && npx wrangler deploy
```

## 7. Domaine personnalisé + e-mail OTP

- **Domaine** : Workers → company-stock → Settings → Domains & Routes → *Add custom domain*
  (ex. `stock.votredomaine.com`). Le DNS est géré automatiquement si le domaine est sur votre
  compte Cloudflare. Mettez à jour `WEBAUTHN_RP_ID` / `WEBAUTHN_ALLOWED_ORIGINS` (§10) en conséquence.
- **E-mail OTP (binding Send-Email)** : Workers → Settings → Bindings → *Send Email* →
  destination `admin@votredomaine.com` (compte Cloudflare avec le domaine actif). Sans binding
  ni `RESEND_API_KEY`, les nouveaux appareils distants ne reçoivent pas d'OTP — en local, le
  premier appareil est approuvé automatiquement.

## 8. Premier démarrage & vérification

1. Ouvrez votre domaine (ou `company-stock.<votre-sous-domaine>.workers.dev`).
2. Connectez-vous avec `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
3. Vérifications rapides :
   - `GET /api/health` → `{ ok: true … }` (public, utilisé par l'app Android pour choisir le serveur)
   - `GET /api/canary` → smoke-test de déploiement (public, n'expose aucun secret)
   - `GET /api/auth/webauthn/status` → `{ data: { enabled: false … } }` (passkeys désactivées par défaut)
4. Réglez l'entreprise (Paramètres), créez produits/clients — les numérotations (FA/VR/devis)
   sont atomiques dès la première écriture.

## 9. Rapports & crashs → GitHub issues

L'application détecte ses propres plantages (erreurs globales + ErrorBoundary React) et propose
à chaque utilisateur « **Signaler un problème** » (page À propos). Tout arrive dans **vos issues
GitHub**, sans que l'utilisateur ait un compte GitHub.

Configuration (propriétaire, **dans l'app, sans CLI**) : Paramètres → Intégrations →
« Rapports & crashs → GitHub » :
1. Créez un PAT fine-grained : https://github.com/settings/personal-access-tokens/new
   → Repository access : votre dépôt → Permissions : **Issues — Read and Write**. (Gratuit.)
2. Collez-le dans le panneau + le dépôt cible (défaut `Etherealmber/atlas-commerce`).
3. C'est tout : les rapports en file partent immédiatement, puis en continu (cron quotidien).

Détails techniques, confidentialité et endpoints : **`docs/reports-github.md`**.

## 10. Passkeys (WebAuthn) & app Android

- Les passkeys sont **désactivées par défaut** (`WEBAUTHN_ENABLED=false` → les routes répondent
  `503 WEBAUTHN_DISABLED`). Le vérificateur est complet (signature ES256, challenges atomiques,
  anti-énumération) — la checklist d'activation est dans **`docs/webauthn.md` §5**.
- App Android native (Kotlin/Compose) : https://github.com/Etherealmber/atlas-commerce-android
  — Credential Manager nécessite `WEBAUTHN_ANDROID_PACKAGE` (déjà configuré) +
  `WEBAUTHN_ANDROID_CERT_HASH` (empreinte SHA-256 du certificat de signature, **gratuit** :
  Play Console → Setup → App integrity, ou `keytool -list -v -keystore votre.jks` pour un APK
  auto-signé). `/.well-known/assetlinks.json` est servi automatiquement dès que l'empreinte est
  renseignée — **les Digital Asset Links sont gratuits**, aucun paiement côté Google pour ça
  (les 25 $ ne concernent que l'inscription unique au Play Store si vous publiez sur Play).
- PWA : l'app web est installable telle quelle (manifest + service worker), sans store.

## 11. Exploitation courante

- **Sauvegardes** : Paramètres → Admin → Sauvegarde & restauration (snapshot chiffré AES-256-GCM
  sur R2, rétention 7 jours, cron ~30 min).
- **Finance** : `docs/api-finance.md` (règles de calcul canoniques, relevé mensuel, `mirror_audit`
  automatique) · enquête historique : `docs/finance-6000-investigation.md`.
- **CI** : chaque PR passe tsc (baseline verrouillée), oxlint 0 erreur, vitest, build Vite,
  dry-run wrangler, CodeQL, osv-scanner. Ne mergez jamais une PR rouge.
- **Mises à jour APK** : servies depuis R2 par le worker (`/api/app/android-update`), ingestées
  par la CI avec `ANDROID_RELEASE_TOKEN`.
- **Sécurité / vulnérabilités** : `SECURITY.md`.

---

*MIT © 2026 loxdpsy / Etherealmber.*
