# Atlas Commerce

ERP web + mobile pour commerces et entrepôts au Maroc — **stock, caisse, facturation, achats, RH et finance** dans une seule application, pensée pour le terrain (scan code-barres, mode téléphone minimal, fonctionnement rôles) et pour le bureau (tableaux de bord, éditions PDF/Excel, comptabilité).

- **Frontend** : React 18 + Vite + TypeScript (SPA servie par le Worker)
- **Backend** : Cloudflare Worker (Hono) — un seul déploiement : `worker/index.ts` + `worker/routes/`
- **Données** : Cloudflare D1 (SQLite) — migrations dans `migrations/`, schéma local `schema.sql`
- **Fichiers** : Cloudflare R2 (`company-stock-images`) — photos produits, pièces d'identité chiffrées, APK de mise à jour
- **Mobile** : Capacitor (Android) — même build web, coquille native fine + écrans téléphone dédiés
- **Thème** : clair/sombre unifié (palette zinc `#111113 → #fafafa`), densité compact/confort, échelle de texte

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Captures & parcours d'accueil](#captures--parcours-daccueil)
3. [Architecture](#architecture)
4. [Démarrage rapide](#démarrage-rapide)
5. [Scripts](#scripts)
6. [Variables & secrets](#variables--secrets)
7. [Rôles & permissions](#rôles--permissions)
8. [Modèle de sécurité](#modèle-de-sécurité)
9. [Scan & création produit](#scan--création-produit)
10. [OCR (factures & pièces)](#ocr-factures--pièces)
11. [Atlas Agent](#atlas-agent)
12. [Mises à jour Android (R2)](#mises-à-jour-android-r2)
13. [Sauvegardes & restauration](#sauvegardes--restauration)
14. [Tests & smoke](#tests--smoke)
15. [Déploiement Cloudflare](#déploiement-cloudflare)
16. [Structure du repo](#structure-du-repo)
17. [Conventions UI](#conventions-ui)
18. [Dépannage](#dépannage)

---

## Fonctionnalités

| Domaine | Détails |
| --- | --- |
| **Catalogue** | Produits, variantes, codes-barres/SKU, catégories, unités, seuils de stock bas, photos (R2), impressions étiquettes |
| **Scan** | Recherche instantanée code-barres/SKU (caméra ou douchette) ; code inconnu → **demande de création produit** avec fiche minimale (nom, unité, quantité, catégorie, photo) — le prix reste saisi sur PC |
| **Ventes** | Caisse rapide, tickets VR, devis → factures → reçus, avoirs, encaissements partiels, échéancier client, PDF & impression thermique 32/48 mm |
| **Achats** | Fournisseurs, factures d'achat, **OCR photo/PDF** (fournisseur, date, numéro, ICE, total, lignes), réceptions, réassorts |
| **Finance** | Trésorerie multi-comptes, balance, dépenses, remboursements, clôtures journalières, rapports Excel/PDF |
| **RH** | Employés en **formulaire guidé par étapes**, pièce d'identité chiffrée + OCR, pointage (module optionnel), salaires, acomptes plafonnés |
| **Clients** | CRM, ICE/IF, plafond de crédit, score de risque, relances e-mail, historique complet |
| **Atlas Agent** | Assistant conversationnel (Groq) : navigation, rapports, création d'entités **via la vraie fiche pré-remplie à valider** — jamais d'écriture aveugle |
| **Admin** | Utilisateurs & rôles, permissions agent, audit log, sauvegardes/restauration, **mises à jour Android** (latest.json + APK via R2) |
| **Connexion** | Mot de passe + **OTP e-mail**, passkeys/WebAuthn, **QR login** 60 s à usage unique, appareils de confiance |

## Captures & parcours d'accueil

L'app embarque un **parcours d'accueil** (page Welcome) avec aperçus vectoriels des écrans clés — tableau de bord, caisse, scan, catalogue — qui suivent le thème clair/sombre choisi par l'utilisateur. La page **Nouveautés** (`/whats-new`) journalise chaque version (fonctionnalités, améliorations, corrections) avec modal « quoi de neuf » à chaque mise à jour.

> Pour de vraies captures d'écran marketing : `npm run dev` puis captures navigateur — les mockups vectoriels de la Welcome servent de gabarits cohérents (classes `.wshot-*`).

## Architecture

```
┌───────────────┐   HTTPS    ┌──────────────────────────────┐
│  Navigateur / │───────────▶│  Cloudflare Worker (Hono)    │
│  Capacitor    │            │  worker/index.ts + routes/   │
│  (Android)    │◀───────────│  • gates par rôle & module   │
└───────────────┘  JSON/API  │  • OTP, sessions, audit      │
                             └───────┬──────────┬───────────┘
                                     │          │
                              ┌──────▼───┐  ┌───▼────────────┐
                              │ D1 (SQL) │  │ R2 (fichiers)  │
                              │ company- │  │ photos, .id    │
                              │ stock-db │  │ chiffrés, APK  │
                              └──────────┘  └────────────────┘
                                     │
                              ┌──────▼───┐  ┌────────────────┐
                              │ KV cache │  │ Workers AI (opt.)│
                              └──────────┘  │ vision OCR      │
                                            └────────────────┘
```

- **Un seul artefact déployé** : le Worker sert à la fois l'API `/api/*` et le SPA (assets `dist/`, `run_worker_first: true` → aucune route API ne renvoie d'HTML).
- **Durable Objects** SQLite free-tier : `MobileHub` (boîte d'actions mobile), `RestoreHub` (restauration), `NumberHub` (numérotation documents).
- **CDN** : assets Workers + domaine R2 custom (`cdn1.afmarbre.com`) pour images & APK.

## Démarrage rapide

```bash
npm install          # npm ci échoue parfois sur ce repo — utiliser npm install
npm run dev          # frontend Vite + worker local (plugin Cloudflare) — port 36521 si --port
npm run preview      # worker complet seul (wrangler dev, D1 local + assets dist)
```

Pièges connus du dev local :

- La base D1 locale **ne persiste pas** entre sessions : réappliquer `schema.sql`
  (`npx wrangler d1 execute company-stock-db --local --file=schema.sql`).
- Supprimer `.wrangler/deploy` et `dist/company_stock` avant un run local après un déploiement.
- Champ du vérificateur OTP : `otp` (`POST /api/auth/verify-otp`) ; en local le code est lisible dans la table `otp_codes`.
- Secrets locaux via `.dev.vars` (gitignoré) : `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`.
- Vite dev accepte les hosts de proxy (`server.allowedHosts: true`) pour les aperçus tunnelisés.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Vite dev (SPA + worker local via plugin Cloudflare) |
| `npm run build` | Build Vite → `dist/` |
| `npm run preview` | `wrangler dev` (worker + assets + D1/KV/R2 locaux) |
| `npm run deploy` | `wrangler deploy` — **production** (Worker + assets) |
| `npm run smoke:local` / `smoke:prod` | Smoke tests API bout-en-bout (P0 + risques client + types de facture + numérotation) |
| `npm run smoke:risk` / `smoke:invoice` / `smoke:partner` | Sous-suites ciblées |
| `npm run cap:sync` / `cap:open` / `cap:add` / `cap:copy` | Build web + synchronisation/ouverture du projet Android Capacitor |
| `npm run cf-typegen` | Régénère les types Wrangler (`Env`) |

## Variables & secrets

Config non sensible dans `wrangler.jsonc` (`vars`) : `ENVIRONMENT`, `CACHE_TTL_SECONDS`, `TURNSTILE_SITE_KEY`.

Secrets (`wrangler secret put`, **jamais dans le repo**) :

| Secret | Rôle |
| --- | --- |
| `ADMIN_PASSWORD` | Mot de passe du compte propriétaire |
| `ADMIN_USERNAME` | Identifiant propriétaire (défaut `admin`) |
| `JWT_SECRET` | Signature des sessions bearer |
| `MAIL_BODY_ENCRYPTION_KEY` | Chiffrement des corps d'e-mails stockés |
| clés Resend / SMTP | Envoi des OTP & e-mails documents |

Bindings : D1 `DB`, KV `CACHE`, R2 `IMAGES`, Send Email `EMAIL`, DO `MOBILE_HUB/RESTORE_HUB/NUMBER_HUB`, **optionnel** Workers AI `AI` (décommenter `"ai": { "binding": "AI" }` pour la vision OCR).

## Rôles & permissions

| Rôle | Portée |
| --- | --- |
| `owner` | Tout + onglet équipe/app-update + secrets |
| `admin` | Gestion complète hors réglages propriétaire |
| `secretaire` | Ventes, clients, facturation ; écritures autorisées |
| `stock` / `magasinier` | Scan, stock, demandes produit ; **pas de caisse ni prix** |
| `user` | Lecture selon modules |

Chaque module peut être désactivé (ex. Pointage) : les routes renvoient 403 et le client **skip silencieusement** (pas de bruit console).

## Modèle de sécurité

- Login + **OTP e-mail** (60 s/5 min selon flux), rate-limiting & réputation IP (`ip_reputation`).
- Sessions bearer signées (`JWT_SECRET`) ; appareils de confiance & passkeys WebAuthn.
- **Aucune suppression ne demande de mot de passe** : la confirmation simple + session + gates de rôle sont la barrière (décision produit).
- Pièces d'identité : chiffrées AES côté serveur, stockées R2 en `.id`, hors D1.
- CSP stricte ; secrets hors repo ; audit log des actions sensibles.
- QR login : code 60 s **à usage unique**, affiché seulement à la demande.

## Scan & création produit

1. Scan douchette/caméra → recherche instantanée.
2. Code inconnu → popup de **demande** : code-barres + SKU auto, unité (select `/api/units`), quantité, catégorie, photo optionnelle. Obligatoires : **nom, unité, quantité**.
3. Demande listée sur Scan (desktop) ; création réelle depuis Produits → formulaire pré-rempli (sku, unité, stock, catégorie) — **le prix est saisi sur PC**.
4. API : `GET/POST /api/stock/product-requests`, `POST /:id/close` (rôles stock/admin/owner).

## OCR (factures & pièces)

- `POST /api/bills/parse-document` : photo/PDF → fournisseur, date, numéro, ICE, total, lignes.
  - Avec binding `AI` : vision Workers AI (`@cf/llava-hf/llava-1.5-7b-hf`).
  - Sans : heuristiques texte (regex ICE/date/totaux) — dégrade proprement.
- `POST /api/employees/parse-id` : même pattern pour CIN/passeports.
- UI : bouton « 📷 Scanner une facture » dans la modale d'achat → pré-remplit, **rien n'est enregistré sans relecture humaine**.

## Atlas Agent

- Intent parser local (sans LLM) pour les actions UI courantes + Groq pour le conversationnel.
- Création d'entités : l'agent **n'écrit jamais en base** — il ouvre la vraie modale pré-remplie (client, produit, employé, facture, devis) via `sessionStorage` (`atlas-agent-draft`) ; l'utilisateur ajuste puis enregistre.
- Threads synchronisés : `GET/PUT/DELETE /api/admin/agent/threads` (routes mailbox).
- Permissions réglables (mode « Demander avant » / « Automatiquement ») + outils autorisés.

## Mises à jour Android (R2)

Contrat public `GET /api/app-update` :

```json
{ "success": true, "updateAvailable": true, "versionCode": 103, "versionName": "1.4.4",
  "apkUrl": "https://cdn1.afmarbre.com/app-updates/android/latest.apk",
  "mandatory": true, "notes": "…" }
```

Gestion server-mediated dans **Paramètres → Application** (owner/admin) : édition de `latest.json` + upload `latest.apk` vers R2, sans redéploiement. Build mobile : `npm run cap:sync` (projet `android/` généré hors repo).

## Sauvegardes & restauration

- Export complet D1 → R2 (chiffré) + restauration incrémentale via `RestoreHub` (ignore l'existant, progression détaillée).
- Restauration complète réservée owner ; sauvegardes planifiables.

## Tests & smoke

```bash
npm run smoke:local    # contre wrangler dev (ATLAS_SMOKE_BASE auto)
npm run smoke:prod     # contre la production
```

Suites : formes API P0, auth, risques client, types de facture (VR/FA), numérotation & stock, partner v1 (401 sans clé).

## Déploiement Cloudflare

```bash
npm run build && npm run deploy     # production
```

- **Workers Builds** (dashboard) : la commande `npx wrangler preview` ne déploie que des **previews de branche** (bloc `previews` requis dans `wrangler.jsonc`, déjà configuré) — **la production ne bouge que via `wrangler deploy` depuis `main`**.
- `wrangler.jsonc` : ne pas modifier les IDs de ressources ; valeurs sensibles en Secrets.
- Migrations D1 : `migrations/` appliquées par wrangler au deploy ; le code utilise aussi `addColumnIfMissing` (migrations douces).

## Structure du repo

```
src/
  pages/            # 33 écrans (Dashboard, QuickSale, Employees, Scan, Settings, Welcome…)
  components/       # UI partagée (PasswordConfirm = confirmation simple, AtlasAgent, QR…)
  styles/           # dark-force.css — dernière feuille chargée : cohérence des thèmes
  mobile/           # coquille téléphone (PhoneApp, phone.css) — usage minimal
  lib/              # api, assist, agentDraft, welcome, whatsNew, density, formValidate…
worker/
  index.ts          # monolithe Hono : routes métier + gates par module/rôle
  routes/           # employees, clients, invoices, mailbox (agent), partner-v1, stock…
migrations/         # migrations D1 versionnées
scripts/            # smoke tests
```

## Conventions UI

- **Erreurs sous leur champ** — jamais de toast ni de message haut-de-modale pour la validation.
- Suppressions/actions sensibles : **confirmation simple**, compte à rebours annulable lisible dans les deux thèmes.
- Formulaires longs : **étapes guidées** avec barre d'actions épinglée (Annuler / Retour / Continuer-Créer toujours au même niveau).
- Thème : une seule palette zinc en sombre ; sidebar = topbar ; chaque composant suit `data-theme`.
- Téléphone : écrans dédiés, données minimales (2 stats accueil, listes sans sous-lignes techniques).

## Dépannage

| Symptôme | Cause probable |
| --- | --- |
| 404 sur des routes existantes (`/api/vendors`, `/api/admin/agent/threads`) | Bundle de production périmé → redéployer depuis `main` |
| 403 `/api/attendance/weekly` | Module Pointage désactivé (gate normal ; client skip) |
| `ERR_BLOCKED_BY_CLIENT` | Extension bloqueur de pub côté utilisateur |
| Police bloquée (CSP) d'un domaine externe | CSP fonctionne comme prévu (overlay tiers) |
| Login local impossible | `.dev.vars` manquant ou D1 locale sans `schema.sql` |

---

Version courante : `src/version.ts` (`APP_VERSION`) · Journal détaillé : page **Nouveautés** · Créateur : etherealmber (El Jadida, Maroc).
