<div align="center">
  <img src="public/atlas-logo-light.png" alt="Atlas Commerce" width="320" />
  <h1>Atlas Commerce</h1>
  <p><strong>ERP / Caisse / Facturation souverain pour commerces &amp; grossistes au Maroc</strong><br/>Stock multi-dépôts · Caisse &amp; tickets VR · Facturation TVA &amp; créances · Scan &amp; OCR · Atlas Agent IA · WebAuthn &amp; login QR</p>

<!-- Badges -->
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Version](https://img.shields.io/badge/version-0.5.1--beta-blue)
![Build](https://img.shields.io/badge/build-cloudflare%20workers-orange)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Vite%20%2B%20D1%20%2B%20R2-0a0a0a)
![Mobile](https://img.shields.io/badge/mobile-PWA%20%2B%20Android%20natif%20(Kotlin)-3ddc84)
![IA](https://img.shields.io/badge/agent-Atlas%20Agent%20IA-8b5cf6)

**Aperçu live (preview CF)** · **Ce README = documentation** · **[Signaler un bug](https://github.com/Etherealmber/atlas-commerce/issues/new)** · **[Demander une fonction](https://github.com/Etherealmber/atlas-commerce/issues/new)**

> Projet propriétaire : **loxdpy** — GitHub **[@loxdpsy](https://github.com/loxdpsy)** · Compte org : **Etherealmber**
</div>

---

## 📸 Captures d'écran réelles

Captures et enregistrement générés depuis l'application elle-même (Chromium headless, `scripts/capture-shots.mjs`).

| Tableau de bord — sombre | Tableau de bord — clair |
| --- | --- |
| ![Tableau de bord sombre](public/shots/dashboard-dark.png) | ![Tableau de bord clair](public/shots/dashboard-light.png) |

| Assistant devis (sombre) | Paramètres — apparence |
| --- | --- |
| ![Assistant devis](public/shots/devis-modal-dark.png) | ![Paramètres apparence](public/shots/settings-dark.png) |

Enregistrement d'une session complète (connexion → tableau de bord → devis) :

Captures desktop **et téléphone** (coque mobile réelle) dans `public/shots/` ; posters Instagram 1:1 avec vrais écrans dans `marketing/atlas-instagram-posters.zip`.

![Session Atlas Commerce](public/shots/demo.gif)

## 🚀 Starter — démarrer de zéro

> **Référence complète : [`SETUP.md`](SETUP.md)** — comptes, base de données D1, KV, R2,
> bindings, chaque secret avec le lien de son fournisseur (Groq, Gemini, Resend, Turnstile,
> Firebase, GitHub), déploiement **sans CLI** (Workers Builds) ou wrangler, domaine, OTP e-mail,
> rapports GitHub, passkeys et Android. Le résumé rapide ci-dessous suffit pour tester en local.

### 0. Prérequis

- **Node.js ≥ 20** et `npm`
- Un compte **Cloudflare gratuit**
- Wrangler CLI : `npx wrangler login` (une fois)

### 1. Récupérer le code

```bash
# via GitHub CLI (recommandé) : fork + clone
gh repo fork Etherealmber/atlas-commerce --clone=true
cd atlas-commerce
# ou sans gh : forkez sur github.com puis
# git clone https://github.com/VOTRE_COMPTE/atlas-commerce.git && cd atlas-commerce
npm install
```

### 2. Secrets locaux

```bash
printf 'ADMIN_USERNAME=admin\nADMIN_PASSWORD=ChangeMo123!\n' > .dev.vars
```

`.dev.vars` n'est **jamais commité** (gitignore). Choisissez un mot de passe fort.

### 3. Base locale D1

```bash
npx wrangler d1 execute DB --local --file=schema.sql   # schéma de base
npx wrangler d1 migrations apply DB --local            # migrations incrementales
```

### 4. Lancer

```bash
npm run dev -- --port 36521
```

Ouvrez **http://localhost:36521**, connectez-vous avec `admin` + votre mot de passe.
En local (sans binding e-mail) le premier appareil est approuvé automatiquement ;
en production l'**OTP par e-mail** protège chaque nouvel appareil.

Vérifiez l'API : `curl http://localhost:36521/api/health`.

### 5. Tests & captures (optionnel mais conseillé)

```bash
npm run smoke                              # suite de tests API bout-en-bout
LD_LIBRARY_PATH=... node scripts/capture-shots.mjs   # captures réelles (voir plus haut)
node scripts/make-posters.mjs              # 12 posters Instagram 1:1
```

### 6. Déployer sur Cloudflare

```bash
npx wrangler d1 create company-stock-db          # crée la D1 production
# → remplacez database_id dans wrangler.jsonc par l'id retourné
npx wrangler d1 execute DB --file=schema.sql     # schéma en production
npx wrangler d1 migrations apply DB              # migrations en production
npx wrangler r2 bucket create company-stock-images   # médias + updates Android
npx wrangler secret put ADMIN_PASSWORD           # secret production
npm run deploy                                   # deploy worker + assets
```

Bindings optionnels : `EMAIL` (SendMail/Workers Mail) pour l'OTP e-mail,
`TURNSTILE_SECRET` pour le challenge login. Sans `EMAIL`, les nouveaux
appareils distants ne pourront pas recevoir d'OTP — configurez-le en production.

### 7. App mobile (Android)

Capacitor a été supprimé : le mobile = **PWA installable** (cette app web) + **app native
Kotlin/Compose** dans le dépôt https://github.com/Etherealmber/atlas-commerce-android
(build Android Studio ou CI ; APK servis depuis R2 via le worker — `/api/app/android-update`,
Admin → Mise à jour app). Passkeys Android : `docs/webauthn.md` §4 (assetlinks automatique).

### 8. Besoin d'aide ?

- **[`docs/desktop-design-prompt.md`](docs/desktop-design-prompt.md)** : prompt maître de l'app desktop (parité stricte web + Android, valeurs exactes citées)
- **[`SETUP.md`](SETUP.md)** : installation complète de A à Z (base de données, secrets, fournisseurs de clés, déploiement sans CLI)
- `docs/reports-github.md` : crashs & signalements utilisateurs → issues GitHub (configuration dans l'app)
- `docs/webauthn.md` : passkeys (modèle de sécurité, activation, Android Credential Manager) · `docs/api-finance.md` : finance & relevés · `PARTNER_API.md` : API partenaire · `SECURITY.md` : vulnérabilités
- **Dans l'app** : À propos → « Signaler un problème » (arrive dans les issues GitHub) ; les crashs sont rapportés automatiquement
- DM **@loxdpsy** pour les vulnérabilités
- Licence **MIT © 2026 loxdpsy** — forkez, modifiez, vendez vos services, citez-nous ★

## 🌟 À propos du projet

Atlas Commerce est un ERP/POS **auto-hébergé sur Cloudflare** (Workers + D1 + R2) pensé pour les commerces, grossistes et entrepôts au Maroc : gestion du stock multi-dépôts, caisse rapide (tickets VR sans TVA), facturation TVA avec créances et remboursements, achats/réceptions, devis, employés & paie, balance/trésorerie — **sans abonnement SaaS opaque** et sans dépendre d'un serveur dédié.

Le cœur est un **worker Cloudflare** (API REST + SSR) avec une base **D1** (SQLite managé), les médias et les mises à jour Android sur **R2** (`company-stock-images`), et un front **React + Vite** thémé (clair/sombre, densités, tailles de texte) décliné en PWA installable (service worker + manifest) et en app Android native (Kotlin + Compose) ; les mises à jour APK sont servies par le worker (R2).

Points forts :

- **Scan & OCR** : un code-barres inconnu devient une demande de création produit (photo de facture/devis comprise), validée depuis la liste Produits.
- **Atlas Agent IA** : « crée un client nommé X avec email/téléphone » ouvre la fiche pré-remplie à vérifier ; confirmation explicite avant exécution.
- **Login moderne** : mot de passe + OTP, **WebAuthn/passkeys**, **login QR** PC↔téléphone (60 s, usage unique).
- **Thème sombre complet** : chaque composant (agent, menus, popups téléphone, datepickers) est thémé zinc clair/sombre.
- **Offline-first terrain** : coquille téléphone minimaliste, rôles (owner/admin/stock/terrain), actions mobile en attente.

## 🧭 Roadmap

La roadmap comparative est tenue dans la section **§Roadmap v209** plus bas : 10 chantiers S/M/L **déjà livrés** (ops scan-first, lots/FEFO, centre d'alertes, références fournisseur, pipeline statuts, étiquettes, kits/BOM, webhooks, emplacements bin). Les prochaines idées passent par les [issues](https://github.com/Etherealmber/atlas-commerce/issues).

## 🛠️ Intégration

Atlas Commerce est conçu pour être étendu :

- **API REST** `/api/*` (worker) — sessions JWT, rôles, idempotence sur les écritures.
- **Webhooks événementiels** `stock.receive`, `stock.count`, `stock.transfer`, `doc.*`, `kit.assembled`, `atlas.alert` (Settings → API).
- **Mises à jour Android** : `latest.json` / `latest.apk` servis depuis R2 via le worker (lien + APK dans Paramètres).
- **OCR & scan** : BarcodeDetector natif + OCR photos de factures/devis → données structurées.
- **Étiquettes imprimables** : `/api/products/:id/label.svg` (QR + CODE128 + prix).

## 👾 Tech Stack

<details open>
<summary>Serveur</summary>

- [Cloudflare Workers](https://workers.cloudflare.com/) (Hono) — API + SSR + cron
- [D1](https://developers.cloudflare.com/d1/) (SQLite managé) — schéma `schema.sql` + migrations
- [R2](https://developers.cloudflare.com/r2/) — médias, backups, updates Android
</details>

<details open>
<summary>Client</summary>

- [React](https://react.dev/) + [Vite](https://vitejs.dev/) + TypeScript
- PWA — service worker + manifest : installable sur l'écran d'accueil, offline-ready ; mises à jour APK servies par le worker (R2)
- CSS maison thémé (`dark-force.css` chargé en dernier)
</details>

<details>
<summary>Sécurité</summary>

- JWT + OTP, **WebAuthn/passkeys**, login QR usage unique
- Cloudflare Turnstile, rate-limit + réputation IP
- Suppressions sans mot de passe (confirmations progressives), audit log
</details>

## 🧰 Déploiement / Démarrage

```bash
npm install
cp .env.example .dev.vars        # secrets locaux (jamais commités)
npm run dev -- --port 36521      # preview local (worker + vite)
npx wrangler d1 migrations apply DB --local
npm run build                    # build client + worker
npx wrangler preview             # preview Cloudflare (CI production = previews uniquement)
npm run deploy                   # déploiement production manuel depuis main
```

Le build Cloudflare (dashboard) exécute `npm run build` puis `npx wrangler preview` : **la production n'est mise à jour que par `npm run deploy` depuis `main`**.

## 📱 App mobile

- **PWA installable** : le compagnon mobile sans store — ajout à l'écran d'accueil, fonctionnement hors-ligne, mises à jour instantanées via le service worker ; scan, caisse, stock, factures et agent inclus. Le compagnon Capacitor a été retiré : la PWA le remplace entièrement.
- **Espace téléphone optimisé (v253)** : les petits écrans, l'APK native et \`?mode=phone\` ouvrent l'app terrain \`/m\` (scan d'abord, catalogue hors-ligne, onglets) au lieu de l'ERP complet ; cibles tactiles 44px+, champs 16px (anti-zoom iOS), ripple matériau, CountUp animés, loupe Lens — composants adaptés de [React Bits](https://github.com/DavidHDev/react-bits) et [Magic UI](https://magicui.design). \`npm run lint\` (oxlint) garde 0 erreur de correction dans la CI.
- **Vérification OTP en un tap** : le bouton « Vérifier & continuer » de l’e-mail ouvre \`/verify\` (lien signé \`sig+exp\`, usage unique) qui soumet le code tout seul à \`POST /api/auth/verify-link\` ; la page détecte la PWA installée (display-mode standalone) ou tente la main à l’app native via \`atlascommerce://verify\` (fallback web automatique si absente) — aucun code à recopier.
- **Pipeline de release Android zéro upload manuel** : le workflow GitHub Actions du dépôt Android POSTe chaque APK signé sur `POST /api/admin/android-release` (Bearer = secret `ANDROID_RELEASE_TOKEN`, identique au secret GitHub `ATLAS_RELEASE_UPLOAD_TOKEN`) ; le worker streamme le binaire vers R2 (`IMAGES` → cdn1.afmarbre.com) : `app-updates/android/atlas-commerce-vX.Y.Z.apk` (immutable 1 an), `latest.apk` (60 s) et `latest.json` (no-cache) ; l'app consulte `GET /api/app/android-update?versionCode=…` (public, pré-login) et les pings `HEAD /app-updates/*` passent par `bucket.head()`.
- **Android natif (Kotlin + Jetpack Compose)** — si vous voulez un rendu 100 % natif : [Etherealmber/atlas-commerce-android](https://github.com/Etherealmber/atlas-commerce-android). Sélecteur de serveur avant connexion (presets ou adresse HTTPS personnalisée avec sonde `/api/health`), authentification mot de passe + OTP avec session chiffrée (Keystore AES-GCM), tableau de bord, catalogue produits avec cache hors-ligne, scan code-barres, panier de vente rapide VR, écrans légaux/sécurité et réglages thème + densité. Licence MIT, CI GitHub Actions, et la même API worker que l'app web.

## 🔒 Code de conduite & politique de sécurité

Merci de signaler toute vulnérabilité via une issue **privée** ou par message direct au propriétaire (**@loxdpsy**) — pas de divulgation publique avant correctif. Les secrets (`.dev.vars`, tokens) ne sont jamais commités ; les backups D1 sont chiffrés côté R2.

## 👋 Contribuer

Projet propriétaire (licence MIT © 2026 loxdpsy). Les contributions passent par **pull requests** depuis une branche `arena/*` ou `feature/*` : une PR = un lot cohérent, build vert (`npm run build`), `tsc --noEmit` sans nouvelle erreur, et description en français listant les zones touchées.

## 📜 Traduction

Interface **français** (terrain Maroc). Les libellés sont centralisés (`src/lib/labels.ts`) pour préparer une future traduction arabe/anglais.

## 💎 Remerciements

- Cloudflare, React, Vite, Hono et leurs communautés.

## ❤️ Support

Atlas Commerce est développé et maintenu par **loxdpy ([@loxdpsy](https://github.com/loxdpsy))** pour des commerces réels au Maroc (El Jadida). Usage interne & démonstrations : contactez le propriétaire via GitHub.

---

## 📚 Annexes opérationnelles

<details>
<summary><strong>Fonctionnalités (matrice)</strong></summary>

| Domaine | Couverture |
|---|---|
| Stock | multi-dépôts, emplacements bin, lots + expiration (FEFO), seuils, mouvements audités, inventaire tournant, transferts, kits/BOM |
| Caisse | tickets VR sans TVA, paiements multi-moyens, remboursements WR, solde caisse |
| Facturation | FA TVA, créances, échéances, avoirs, exports CSV, emails, pipeline statuts + journal |
| Achats | bills, réceptions, références fournisseur + paliers tarifaires |
| Tiers | clients (ICE, situation), fournisseurs, employés & paie |
| Scan/OCR | code-barres natif, demandes produit photo, OCR factures/devis |
| IA | Atlas Agent (création pré-remplie avec confirmation), permissions par action |
| Admin | utilisateurs & rôles, clés API + webhooks, backups D1→R2, audit, journal des versions |
</details>

<details>
<summary><strong>Scripts & secrets</strong></summary>

- `npm run dev` (port 36521), `npm run build`, `npm run deploy`, `npx wrangler preview`
- `.dev.vars` local : `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET` — jamais commités
- R2 bucket `company-stock-images` : médias + `latest.json`/`latest.apk`
</details>

<details>
<summary><strong>Rôles & sécurité</strong></summary>

- Rôles : owner > admin > stock > terrain ; gating API par rôle
- Suppressions : confirmation progressive, **jamais de mot de passe** ; audit log
- Login : password+OTP, WebAuthn, QR 60 s usage unique ; Turnstile + rate-limit
</details>

<details>
<summary><strong>Conventions UI</strong></summary>

- Thème sombre zinc sur **tous** les composants (agent, menus, popups téléphone, datepickers, checkboxes)
- Wizards par étapes (Continuer au même niveau, pas de Retour à l'étape 1, Annuler bien placé)
- Erreurs **sous leur champ** uniquement ; scan n'exige jamais le prix
- Sidebar = topbar (même thème) ; téléphone = minimal, cibles ≥ 40 px, safe-area
</details>

<details>
<summary><strong>Roadmap v209 — livrée</strong></summary>

| # | Fonction | Adaptation Atlas | Statut |
|---|---|---|---|
| 1 | Stock locations | emplacements bin `products.location` + dépôts existants | ✅ |
| 2 | Batch/lot + expiry FEFO | `stock_lots` + alertes | ✅ |
| 3 | Scan-first receive/transfer/count | modes Scan + `/api/stock/receive|count` + `/api/inventory/transfer` | ✅ |
| 4 | Supplier parts + price breaks | `supplier_parts` + UI Vendors | ✅ |
| 5 | Status pipeline + journal | `/api/invoices/:id/pipeline` + `status_events` + chips | ✅ |
| 6 | Label printing | `/api/products/:id/label.svg` (QR + CODE128) | ✅ |
| 7 | Alert center | `/api/alerts` + cloche + `/m/inbox` | ✅ |
| 8 | BOM + builds | `kits`/`kit_items` + assemblage | ✅ |
| 9 | Attachments QC | photos produits + OCR (existant) | ✅ |
| 10 | Webhooks | `/api/webhooks` + dispatch événementiel | ✅ |
</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

- `vite: not found` → `npm install` (node_modules non persisté)
- Preview local : recréer `.dev.vars`, relancer `npm run dev -- --port 36521`
- Production périmée → `npm run deploy` depuis `main` (la CI ne fait que des previews)
- tsc baseline ~310 erreurs préexistantes : comparer les deltas uniquement
</details>

---

## 📚 Historique des versions

## Automations GitHub — le dépôt se surveille et se répare tout seul

- `security-patrol.yml` (tous les jours 06:30 UTC + manuel) : `scripts/security-patrol.mjs` sonde la production en boîte noire (verdicts body-aware : il distingue le WAF du worker de l’edge Cloudflare, un 200 `success:false` compte comme un refus, `cf-cache-status: HIT` sur un endpoint authentiqué = fuite de cache critique) — il « essaie de pirater » le site (SQLi UNION/WAITFOR, XSS `<script>`, traversal `/etc/passwd`, Log4Shell JNDI, accès admin sans session, POST release sans Bearer), vérifie les en-têtes de sécurité (CSP, HSTS, nosniff, DENY…) et lit les compteurs WAF du canary pour remonter les **intrusions réelles détectées et bloquées**. Chaque échec ouvre/met à jour un ticket `[security-patrol]` avec un **« Fix possible »** concret ; tout vert → le ticket ouvert est fermé automatiquement ; finding critique → run rouge.
- `issue-triage.yml` : dès qu'un ticket est ouvert (plainte, bug, tentative de piratage signalée, idée), il classe par mots-clés FR/EN (`security`, `bug`, `feedback`, `enhancement`, sinon `needs-info`) et poste un accusé de réception avec les prochaines étapes — jamais sur les tickets créés par les bots.
- Formulaires de tickets (`.github/ISSUE_TEMPLATE/`) : bug, plainte/retour, demande d'évolution, signalement sécurité (+ lien vers les advisories privées pour l'exploitable).
- `branch-cleanup.yml` : suppression automatique des branches inutiles — à la fermeture d'une PR (branche fusionnée ou entièrement contenue dans `main`) + balayage hebdomadaire (lundi 05:00 UTC) de toutes les branches fusionnées sans PR ouverte (les `arena/*` de sessions incluses). Jamais de suppression si une PR est ouverte, si la branche n'est pas fusionnée, ou si elle est protégée ; `delete_branch_on_merge` est aussi activé côté dépôt.
- Jeton Cloudflare optionnel pour la patrouille (secrets `CF_API_TOKEN`, `CF_ZONE_ID` facultatif — scopes Zone Read + Cache Purge Edit + Security Events Read sur afmarbre.com) : elle purge elle-même toute réponse rejouée par le cache edge et nomme dans le ticket la règle pare-feu exacte qui bloque ses sondes.
- `auto-merge.yml` : chaque PR reçoit le label `automerge` à l'ouverture ; elle est fusionnée **automatiquement dès que TOUS les checks du commit sont verts** (aucun check en attente, aucun en échec, ≥1 check existant — jamais de merge « non vérifié »). Un check rouge → commentaire « Auto-merge held » et attente ; retirer le label `automerge` bloque le merge auto.

## CI guards — aucune erreur ne touche l'API ou le front sans passer ces portes
- `api-guard.yml` : TypeScript du worker comparé à un baseline verrouillé (`scripts/tsc-baseline.txt`, toute nouvelle erreur échoue) + `wrangler deploy --dry-run` (le worker compile et le config valide, sans rien déployer)
- `frontend-guard.yml` : build Vite obligatoire + sanity du bundle (index.html + assets hashés) + TypeScript src/ vs baseline
- `themes-css-guard.yml` : `scripts/css-check.mjs` — accolades/parenthèses équilibrées, hex valides, dark-force.css dernier import CSS obligatoire, et aucune NOUVELLE déclaration blanche dans les blocs sombres sur les PR
- Les trois tournent sur chaque pull request (et sur main) avec filters par chemin : un PR rouge ne devrait jamais être mergé, donc jamais déployé

Version actuelle : **0.6.5-beta** (gelée jusqu'au prochain ordre de push).

Cycle bêta **0.x** — la vraie release sera **1.0.0**. Historique repris depuis la première version interne ; le détail complet et vivant est dans l'app (**Nouveautés**), y compris l’ancien cycle bêta pré-renumérotation, renuméroté en **0.x** (0.0.1 → 0.4.4).

<details>
<summary>📦 Toutes les versions (0.0.1-beta → 0.5.5-beta) — cliquer pour déplier</summary>

### 0.6.5-beta
- Nouvelle identité visuelle appliquée partout : les deux logos officiels (lockup noir sur fond clair, lockup blanc sur fond sombre) remplacent l'ancien logo vectoriel — sidebar, barre du haut Paramètres, écran de connexion (lockup complet), page À propos, centres des QR codes ; bascule automatique clair/sombre par paire d'images PNG transparentes (`atlas-logo-*.png` / `atlas-icon-*.png`, fonds retirés par traitement pixel, icône découpée du lockup)
- Favicons & PWA régénérés depuis le nouveau logo : favicon 16/32 + `.ico` + variantes **sombres** servies via `prefers-color-scheme`, apple-touch 180, icônes manifest 192/512 (png+webp), og-image 1200×630 ; anciens `logo.svg` / `logo-mark.svg` / `favicon.svg` / `og-image.svg` supprimés, manifest et README mis à jour

### 0.6.4-beta
- Sécurité — `POST /api/expenses` + `POST /api/expenses/import` : audit puis verrouillage **propriétaire/admin uniquement** (403 OWNER_ONLY) — avant, tout compte authentifié (stock, user, secretaire…) pouvait insérer des écritures de trésorerie, y compris des apports/prélèvements propriétaire ; routes extraites dans `worker/routes/expenses.ts` avec re-validation de session en défense en profondeur + audit `expense.create`/`expense.import` ; tests d'autorisation et de validation (`worker/__tests__/expenses-auth.test.ts`)
- Sécurité — Atlas Agent : comptes suspendus et quotas de jetons désormais refusés **côté serveur** avant tout appel LLM (`agentAccessVerdict`) — le contrôle ne reposait que sur la SPA
- Nouvelle API `GET /api/admin/finance/period?period=AAAA-MM` (owner/admin) : ventilations **espèces/banque** des entrées/sorties, apports & prélèvements propriétaire, totaux par catégorie de dépenses — mêmes règles canoniques et même fuseau finance que le relevé (mois ouvert arrêté à aujourd'hui, miroirs et « Avoir » exclus), bloc relevé intégré + invariant revérifié à chaque appel ; moyens de paiement absents (salaires) déclarés `not_recorded`, **jamais devinés** (`worker/lib/finance.ts` `computePeriodBreakdown`, docs/api-finance.md, tests)
- Atlas Agent — extraction de documents **bornée et validée par signature binaire** (PDF ≤ 2 Mo / ≤ 30 pages, texte UTF-8 strict, ≤ 2 documents, extrait ≤ 12 000 car.) : `worker/lib/agent-docs.ts` — un PDF scanné sans texte est annoncé « non extractible » au modèle avec interdiction d'inventer ; tout document refusé rejette la requête (codes stables DOC_MIME/DOC_MAGIC/DOC_PAGES/DOC_TOO_LARGE/DOC_BINARY…)
- Atlas Agent — streaming SSE `POST /api/assist/chat/stream` (event: token/done/error) avec les mêmes verrous ; quota débité sur la consommation RÉELLE du dernier chunk ; `groqChatStream` + tests (`worker/__tests__/agent-docs.test.ts`, vitest 168/168)

### 0.6.3-beta
- Barre Rapports PDF : le champ mois affiche toujours le mois d’ancrage de la période active (« Ce mois », « 3 mois »…) au lieu de rester vide, avec info-bulle ; bascule vers un mois précis inchangée
- `docs/desktop-design-prompt.md` : prompt maître desktop — parité visuelle stricte web + Android, toutes valeurs exactes (couleurs, rayons, typo, densités, motion, règles sombres, assistants, checklist écrans, protocole de vérification) extraites des deux repos avec citations

### 0.6.2-beta
- Rapports sur mois précis : `/api/reports/combined` + sections acceptent une période `AAAA-MM` strictement validée (invalide → mois courant, jamais de dates cassées) en plus des périodes relatives ; bornes calculées dans le **fuseau finance de l’entreprise** (`finance_timezone`, défaut Africa/Casablanca) — mois courant arrêté à aujourd’hui local, mois passés complets (bissextiles sûrs) ; période propagée à toutes les sections/liens avec le ticket HMAC `rt` 30 min (JWT de session jamais accepté ni exposé, `token` supprimé défensivement) ; sélecteur de mois dans Solde ; logique pure `worker/lib/report-period.ts` + 17 tests (vitest 112/112)

### 0.6.1-beta
- Passkeys Android : acceptation des DEUX formats d’origine natifs — `android:apk-key-hash-sha256:` (Credential Manager) et le legacy `android:apk-key-hash:` (base64 du SHA-1, `WEBAUTHN_ANDROID_CERT_SHA1` optionnel) — comparaison octet par octet après décodage tolérant (base64/url-safe, padding) ; `status.data.android.origin_legacy` exposé ; 4 tests de plus, vitest 95/95 (`docs/webauthn.md` §4a)

### 0.5.9-beta
- Crash reporting automatique → **issues GitHub** : erreurs globales, promesses rejetées et crashs React (ErrorBoundary) sont capturés, assainis (secrets retirés, IP hachée), dédupliqués par empreinte (un bug = une issue) et envoyés au dépôt du projet ; sans token, tout part en file D1 et le cron quotidien vide la file dès configuration (`docs/reports-github.md`)
- Signalements utilisateurs : **À propos → « Signaler un problème »** (bug / idée / autre, contact facultatif) — chaque message devient une issue GitHub avec référence `R-<id>`, sans compte GitHub pour l'utilisateur
- Panneau propriétaire **Paramètres → Intégrations → Rapports & crashs → GitHub** : token fine-grained (validé contre GitHub avant stockage, jamais renvoyé), dépôt cible, file en attente, renvoi manuel, liste des crashs/signalements récents avec liens d'issues
- Documentation reprise de zéro : **`SETUP.md`** (comptes → D1/KV/R2 → chaque secret avec lien fournisseur → déploiement sans CLI Workers Builds → domaine/OTP → vérification → passkeys/Android), `docs/reports-github.md`, README corrigé (Capacitor supprimé, index docs à jour), `SECURITY.md` mis à jour ; nettoyage des fichiers d'état obsolètes (STATUS_REVIEW, UI_REWRITE, MONOLITH_PEEL, EDGE_EQUIVALENTS, P0_HARDENING, ARCHITECTURE_PARTNER_API_V1, ATTENDANCE_FROM_CLOUDATTEND)
- 13 nouveaux tests (assainissement, empreintes, intake D1 + dédup, file d'attente, sync GitHub stubbée, priorité env > app) — vitest 91/91

### 0.5.8-beta
- Passkeys Android Credential Manager : origines natives `android:apk-key-hash-sha256:` (dérivées de l’empreinte SHA-256 du certificat de signature Play configurée serveur) + origine web cross-origin liée au paquet signé acceptées par le vérificateur exact ; `WEBAUTHN_ANDROID_PACKAGE` préconfiguré ; `status.data.android.origin` expose la valeur acceptée ; assetlinks automatique dès l’empreinte renseignée ; sans configuration Android, vérification strictement web inchangée (`docs/webauthn.md` §4a) — 6 tests d’intégration, vitest 78/78

### 0.5.7-beta
- Passkeys WebAuthn sécurisés (`docs/webauthn.md`) : vérification cryptographique complète (challenges atomiques à usage unique liés compte/RP/origine, types `webauthn.create`/`get`, origine exacte, hash RP ID, flags UP/UV, attestation « none », clé publique ES256 stockée, signature sur authData + hash clientData, handle utilisateur = compte, compteurs anti-rejeu + règle passkeys synchronisés, doublons refusés) ; échecs de connexion = code générique unique (anti-énumération) ; `GET /api/auth/webauthn/status` (capacité client) ; `/.well-known/assetlinks.json` pour Android Credential Manager ; **désactivées en production** (`WEBAUTHN_ENABLED=false`, 503) jusqu’à la checklist §5 ; 27 tests WebAuthn réels (ES256/CBOR/replay) — vitest 72/72
- Audit miroir finance AUTOMATIQUE : `mirror_audit` (lignes miroir exclues vs `bill_payments`/`employee_payments` + flag `consistent`) embarqué dans le résumé mensuel et le relevé — la confirmation du correctif 6 000 MAD tourne seule en production, sans CLI ni PC (`docs/api-finance.md`)

### 0.5.6-beta
- Relevé mensuel serveur `GET /api/admin/finance/statement?period=` (owner/admin) : ouverture/clôture, mouvements chronologiques avec solde courant, refs assainies, pagination, statut ouvert/clos, invariant ouvrant + crédits − débits = clôturant ; résumé mensuel, relevé et PDF = UN seul calcul canonique (`docs/api-finance.md`)
- Fix double comptage finance (enquête `docs/finance-6000-investigation.md`) : lignes miroir des paiements fournisseur/salaire exclues du calcul (dépense fantôme + trou de clôture), avoirs exclus des encaissements, `paid_at` par défaut au jour local ; rétroactif, aucune donnée supprimée, 10 tests de régression
- Vitesse : Smart Placement (`wrangler.jsonc`) + `public/_headers` (bundles immuables 1 an, HTML/SW revalidés)

### 0.5.5-beta
- Téléphone terrain : l'app /m (scan d'abord, catalogue hors-ligne, barre d'onglets) se relance automatiquement sur petits écrans, APK native et ?mode=phone — le PC garde l'ERP complet ; confort tactile 44px+, anti-zoom iOS, ripple matériau (React Bits), CountUp, loupe Lens ; oxlint (0 erreur) dans la CI
- Finance serveur sûre par rôle (`docs/api-finance.md`) : `GET /api/admin/finance/monthly` (soldes ouverture/clôture, encaissements, dépenses, remboursements, créances/dettes échues, paie due — calculé du journal persistant, owner/admin uniquement), `GET /api/admin/employees/payroll` paginé (champs minimaux, jamais de données personnelles), `GET /api/admin/finance/monthly/report.pdf` généré à la demande (streamé, no-store, jamais stocké ni énumérable, audit par téléchargement) ; rappels cron quotidiens non spammeurs (jours 1/2/3 rapport puis changements seulement, échéances clients/fournisseurs/paie, paiement enregistré) avec outbox durable + clé d'idempotence (tenant, événement, période, destinataire), revérification du rôle à l'envoi, retries backoff ≤5 et montants masqués sur l'écran de verrouillage si `finance_push_amounts = 0`
- Téléphone = jumeau de l'app Android : même barre du haut (titre d'onglet + nom · rôle, menu rapide rond avec badge, avatar → profil), mêmes 5 onglets (Accueil, Produits, Scan, Vente avec badge panier, Agent — filtrés par rôle), même accueil (héros dégradé sombre adapté au rôle, Nouvelle vente/Scanner + Produits, Info Box, tuiles de statistiques Material 3, alerte stock) — palette zinc/papier/safran, coins et typographie identiques à l'APK
- Nouveautés réorganisées en versions lisibles (0.5.1 allégée, 0.5.2 → 0.5.5) ; version courante : 0.5.5-beta
- Agent Atlas : les images jointes s'ouvrent en plein écran d'un clic/tap (visionneuse portail — plus piégée dans le panneau) et **survivent au rafraîchissement** (recompression ≤1280 px, persistance locale + R2 avec repli quota, brouillons d'attachments restaurés)
- Assistant nouveau produit : photo modifiable avant création (✎ par photo déposée → atelier de recadrage `ImageWorkbench`, la version recadrée est uploadée)
- Paie employé SELF : `GET /api/me/payroll` — chaque session ne lit que SA fiche de paie via `employees.user_username` (champ « Compte lié » du formulaire employé ; 404 `PAYROLL_NOT_LINKED` / 409 `PAYROLL_AMBIGUOUS` sinon) ; doc dans `docs/api-finance.md`
- Pont FCM Android livré : `docs/android-fcm-bridge.patch` + `docs/android-fcm-bridge-prompt.md` (SDK firebase-messaging, service de réception, canal `atlas_assist`, enregistrement du jeton via `POST /api/assist/device-token` à chaque connexion ; google-services.json jamais committé, build OK sans)

### 0.5.4-beta
- Assistants sans pastilles d'étapes en haut ni défilement (2 colonnes gardées en modale même écran étroit) ; vente rapide sans double champ SKU ; zone OCR compacte sans input natif ; sombre : cartes Solde, bouton Arrêter, pastilles Aller à, Réflexion, toggle mdp thémés + aucun bouton blanc au tap
- Gardes CI sur chaque PR : TypeScript worker/src vs baseline + dry-run wrangler, build Vite + sanity du bundle, thèmes/CSS — un PR rouge ne peut plus atteindre la production
- Pipeline de release Android sans upload manuel (GitHub Actions → /api/admin/android-release → R2/CDN1 → /api/app/android-update) ; automations GitHub : patrouille de sécurité quotidienne, triage des tickets, nettoyage des branches, auto-merge uniquement tous checks verts
- Faille auth critique corrigée (58 routes enregistrées avant le middleware : l'anonyme était traité owner — middleware désormais enregistré AVANT toutes les routes) ; anti-fuite cache edge (no-store sur tout /api non public) ; /api/health + /api/canary publics ; e-mails OTP redesignés + vérification en un tap

### 0.5.3-beta
- Facture : échec de déduction de stock = facture annulée + erreur affichée (plus de stock faussé en silence) ; corruption D1 (SQLITE_CORRUPT) diagnostiquée clairement (code DB_CORRUPT, message de restauration)
- Auto-réparation FTS5 (products_fts) : corruption SQLITE_CORRUPT_VTAB reconstruite/recréée automatiquement sans perte de données + endpoint owner POST /api/admin/search-index/rebuild
- Réplication de lecture D1 (Sessions API) automatique : session par requête + cookie de bookmark (read-your-writes), sonde d'intégrité FTS en tâche de fond

### 0.5.2-beta
- Avatar via proxy same-origin (CORS cdn1 contourné) ; agent lit les fichiers dès l'envoi et reprend le dernier fichier sur « lis ça »
- Avatar instantané : cache blob partagé côté client + cache Durable Object/edge côté worker + préchargement ; WebP pour les recadrages
- Assistants sans défilement : étape « Remises volume » dédiée dans le produit ; audit de tous les wizards (chaque étape statique tient à l'écran)
- Sauvegarde produit blindée jusqu'au bout (updated_at gardé, dup-check non bloquant, SW v11 purge les caches périmés) ; appareils connectés auto-enregistrés ; UI agent sombre corrigée
- Nouveau produit : upload de photos dès l'étape Photos de la création ; avatar visible immédiatement après rafraîchissement, sans clic

### 0.5.1-beta
- Menu utilisateur portalisé (toujours visible) avec photo de profil dans l'en-tête ; avatar monogramme SVG de nouveau affiché
- Assistant produit en 5 étapes sans défilement ; numérotation 0.4.10 → 0.5.0 et 0.4.11 → 0.5.1
- Glisser-déposer des photos produit sur l'étape dédiée (zone pleine largeur, surbrillance cuivre)
- Assistant produit en 4 étapes : Variantes et Photos séparées, pied de fenêtre fixe qui ne recouvre jamais le contenu
- PUT/POST produits blindés contre les colonnes manquantes (plus de 500 « Erreur interne »)

### 0.5.0-beta
- Erreur « Erreur interne — réessayez plus tard » sur la sauvegarde d'un produit corrigée (migration optionnelle de colonne rendue non bloquante)
- Erreurs de sauvegarde affichées dans la zone prévue de la fenêtre (bannière au-dessus des boutons) sur tous les formulaires popup, plus de toast masqué
- Notifications flottantes déplacées en haut de l'écran, cause réelle des erreurs tracée dans les logs serveur

### 0.4.9-beta
- OTP par e-mail via Resend (boîte de l'utilisateur), gabarit d'e-mail brandé, plus de « E-mail indisponible » en production
- Atlas Agent : vision réelle des images jointes (Groq), miniatures dans la bulle, boutons ✎/✕ des pièces jointes visibles dans les deux thèmes
- SÉCURITÉ : codes OTP jamais renvoyés par l'API en production ; WAF applicatif sur /api/* + endpoint /api/canary
- Numérotation revue : cycle bêta 0.x, historique repris depuis la 0.0.1

### 0.4.8-beta
- Heure exacte de rafraîchissement des quotas (jour/semaine) affichée partout
- Journal D1 de consommation de jetons (agent_usage_log) ; migration D1 → D1 depuis les Paramètres
- Modales centrées + fermeture visible et thémée ; cartes permissions agent lisibles en clair/sombre

### 0.4.7-beta
- Quotas de jetons en Durable Object (persistants aux redéploiements)
- Agent : markdown rendu, pièces jointes annotables, conversations chiffrées AES-GCM dans R2
- Popups guidés unifiés (wizard) : pied droit, chip d'étape, erreurs inline, clic extérieur = annulation

### 0.4.6-beta
- Gouvernance de l'agent : 2FA, appareils connectés, suppressions gated par OTP, verrouillage anti-injection
- Plafonds de jetons jour/semaine (admin exempté et pilote)

### 0.4.5-beta
- Palette zinc unique en sombre : zéro flash blanc, boutons primaires clairs, focus et appuis zinc, transition circulaire du thème

### 0.4.4-beta
- Tous les popups suivent le même système guidé : produit (3 étapes), facture d’achat (3 étapes), remboursement WR (2 étapes), reçu et fournisseur (2 ét…

### 0.4.3-beta
- Scan : code inconnu → demande de création produit (photo comprise), validée depuis la liste Produits

### 0.4.2-beta
- Thème sombre unifié (sidebar, topbar et pages sur la même palette zinc)

### 0.4.1-beta
- États vides avec un bouton clair pour créer (devis, reçus, fournisseurs…)

### 0.4.0-beta
- Restauration de sauvegarde plus rapide (ignore ce qui existe déjà)

### 0.3.4-beta
- Shell revisité : top bar, menu avatar, notifications, recherche

### 0.3.3-beta
- Erreurs de formulaire en français dans la popup

### 0.3.2-beta
- Messagerie focus (top bar, sans sidebar app)

### 0.3.1-beta
- Recherche Paramètres (historique, aperçu)

### 0.3.0-beta
- Mode focus Paramètres / À propos / Nouveautés

### 0.2.0-beta
- Employés, cycles de paie, acomptes

### 0.1.8-beta
- Boîte mail pro (dossiers, pièces jointes, spam)

### 0.1.7-beta
- Aperçu documents (PDF / images) dans la messagerie

### 0.1.6-beta
- Rapports stock / ventes ; historique produit

### 0.1.5-beta
- Reçus, remboursements, vente rapide

### 0.1.4-beta
- Devis convertibles ; factures FA / VR

### 0.1.3-beta
- Clients, fournisseurs, crédit client

### 0.1.2-beta
- Achats fournisseurs + réception stock

### 0.1.1-beta
- Solde trésorerie (recettes, dépenses, apports)

### 0.1.0-beta
- Catalogue produits, catégories, images R2

### 0.0.4-beta
- Stabilisation auth session et cookies

### 0.0.3-beta
- Tableau de bord métriques de base

### 0.0.2-beta
- Correctifs post-publication login / routing

### 0.0.1-beta
- Première version interne (bêta) : stock, facturation et espace de travail Atlas Commerce

</details>

---

## ⚠️ Licence

Distribué sous licence **MIT** — voir [LICENSE](LICENSE). Copyright (c) 2026 **loxdpsy**.
