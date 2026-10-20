# Atlas Commerce

ERP web + mobile pour commerces et entrepôts au Maroc — stock, caisse, facturation, achats, RH et finance dans une seule application.

- **Frontend** : React 18 + Vite + TypeScript (SPA servie par le Worker)
- **Backend** : Cloudflare Worker (Hono) — un seul déploiement, `worker/index.ts` + `worker/routes/`
- **Données** : Cloudflare D1 (SQLite) — migrations dans `migrations/`, schéma local `schema.sql`
- **Fichiers** : Cloudflare R2 (`company-stock-images`) — photos produits, pièces d'identité chiffrées, APK de mise à jour
- **Mobile** : Capacitor (Android) — build web identique, coquille native fine
- **Thème** : clair/sombre unifié (palette zinc), densité compact/confort, échelle de texte

## Fonctionnalités principales

| Module | Détails |
| --- | --- |
| Catalogue | Produits, codes-barres, scan (caméra), demandes de création produit depuis le scan |
| Ventes | Caisse rapide, devis → factures → reçus, avoirs, ventes par employé |
| Achats | Fournisseurs, factures d'achat, réassorts, réceptions |
| Finance | Trésorerie, balance, dépenses, remboursements, échéancier client |
| RH | Employés (formulaire guidé par étapes), pointage (module optionnel), salaires, acomptes |
| Clients | CRM, ICE/IF, plafond de crédit, relances mail |
| Atlas Agent | Assistant conversationnel : navigation, rapports, création d'entités **avec fiche pré-remplie à valider** (jamais d'écriture aveugle) |
| Admin | Utilisateurs + rôles, permissions agent, mises à jour Android (lien + APK via le serveur), sauvegardes/restauration |

Sécurité : login + OTP, sessions bearer, audit log, pièces d'identité chiffrées AES côté serveur (R2 `.id`), CSP stricte.

## Développement local

```bash
npm install          # npm ci échoue parfois sur ce repo — utiliser npm install
npm run dev          # frontend Vite (proxy /api → 127.0.0.1:8787)
npm run preview      # Worker complet en local (wrangler dev, D1 local + assets dist)
```

Pièges connus du dev local :

- La base D1 locale ne persiste pas entre sessions : réappliquer `schema.sql` si besoin.
- Supprimer `.wrangler/deploy` et `dist/company_stock` avant un run local si un déploiement a eu lieu.
- Le champ du vérificateur OTP est `otp` (`POST /api/auth/verify-otp`).
- Tests de bout en bout : `npm run smoke:local` (worker local) / `npm run smoke:prod`.

## Déploiement (Cloudflare)

```bash
npm run build        # vite build → dist/
npm run deploy       # wrangler deploy — Worker + assets en une fois
```

`wrangler.jsonc` configure le Worker `company-stock`, le D1 `company-stock-db`, les buckets R2 et le KV. **Ne pas modifier les IDs de ressources.** Les valeurs sensibles (mots de passe, clés API) vont dans les Secrets Cloudflare, jamais dans le repo.

> Déployez depuis `main` : un bundle de production périmé renvoie des 404 sur des routes pourtant présentes dans le code (`/api/vendors`, `/api/admin/agent/threads`…).

### Mises à jour Android (R2)

Le client mobile interroge `GET /api/app-update` (public) :

```json
{ "success": true, "updateAvailable": true, "versionCode": 12, "versionName": "1.4.4",
  "apkUrl": "https://cdn1.afmarbre.com/app-updates/android/latest.apk", "mandatory": false, "notes": "…" }
```

La gestion se fait dans **Paramètres → Application** (compte owner/admin) : édition de `latest.json` et upload de `latest.apk` vers R2, sans redéploiement. Build mobile : `npm run cap:sync` puis Android Studio (projet `android/` généré hors repo).

## Structure

```
src/
  pages/            # 33 écrans (Dashboard, QuickSale, Employees, Scan, Settings…)
  components/       # UI partagée (PasswordConfirm = confirmation simple, modales, agent…)
  styles/           # dark-force.css (dernière feuille chargée : cohérence du thème sombre)
  mobile/           # coquille téléphone (PhoneApp)
  lib/              # helpers (api, assist, welcome, whatsNew, density…)
worker/
  index.ts          # monolithe Hono : routes métier + gates par module
  routes/           # mailbox (threads Atlas Agent), partner v1, clients…
migrations/         # migrations D1 versionnées
scripts/            # smoke tests
```

Conventions UI :

- Les suppressions/actions sensibles demandent une **simple confirmation** — jamais de mot de passe (la session + OTP sont la barrière).
- Les formulaires longs sont **guidés par étapes** avec une barre d'actions fixe (`Retour` / `Continuer` toujours au même endroit).
- Le thème de la sidebar suit celui de la topbar ; une seule palette zinc en sombre (`#111113` → `#fafafa`).

Version courante : `src/version.ts` (`APP_VERSION`), journal détaillé dans la page **Nouveautés** (`src/pages/WhatsNew.tsx`).
