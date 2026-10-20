<div align="center">
  <img src="public/logo-mark.svg" alt="Atlas Commerce" width="96" height="96" />
  <h1>Atlas Commerce</h1>
  <p><strong>ERP / Caisse / Facturation souverain pour commerces &amp; grossistes au Maroc</strong><br/>Stock multi-dépôts · Caisse &amp; tickets VR · Facturation TVA &amp; créances · Scan &amp; OCR · Atlas Agent IA · WebAuthn &amp; login QR</p>

<!-- Badges -->
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Version](https://img.shields.io/badge/version-1.4.5--beta-blue)
![Build](https://img.shields.io/badge/build-cloudflare%20workers-orange)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Vite%20%2B%20D1%20%2B%20R2-0a0a0a)
![Mobile](https://img.shields.io/badge/mobile-Capacitor%20Android-3ddc84)
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

![Session Atlas Commerce](public/shots/demo.gif)

## 🌟 À propos du projet

Atlas Commerce est un ERP/POS **auto-hébergé sur Cloudflare** (Workers + D1 + R2) pensé pour les commerces, grossistes et entrepôts au Maroc : gestion du stock multi-dépôts, caisse rapide (tickets VR sans TVA), facturation TVA avec créances et remboursements, achats/réceptions, devis, employés & paie, balance/trésorerie — **sans abonnement SaaS opaque** et sans dépendre d'un serveur dédié.

Le cœur est un **worker Cloudflare** (API REST + SSR) avec une base **D1** (SQLite managé), les médias et les mises à jour Android sur **R2** (`company-stock-images`), et un front **React + Vite** thémé (clair/sombre, densités, tailles de texte) décliné en coquille téléphone (Capacitor) et en app Android avec mises à jour OTA servies par le worker.

Points forts :

- **Scan & OCR** : un code-barres inconnu devient une demande de création produit (photo de facture/devis comprise), validée depuis la liste Produits.
- **Atlas Agent IA** : « crée un client nommé X avec email/téléphone » ouvre la fiche pré-remplie à vérifier ; confirmation explicite avant exécution.
- **Login moderne** : mot de passe + OTP, **WebAuthn/passkeys**, **login QR** PC↔téléphone (60 s, usage unique).
- **Thème sombre complet** : chaque composant (agent, menus, popups téléphone, datepickers) est thémé zinc clair/sombre.
- **Offline-first terrain** : coquille téléphone minimaliste, rôles (owner/admin/stock/terrain), actions mobile en attente.

## 🧭 Roadmap

La roadmap comparative (inspirée d'[InvenTree](https://github.com/inventree/InvenTree)) est tenue dans la section **§Roadmap v209** plus bas : 10 chantiers S/M/L **déjà livrés** (ops scan-first, lots/FEFO, centre d'alertes, références fournisseur, pipeline statuts, étiquettes, kits/BOM, webhooks, emplacements bin). Les prochaines idées passent par les [issues](https://github.com/Etherealmber/atlas-commerce/issues).

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
- [Capacitor](https://capacitorjs.com/) — app Android (OTA via R2)
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

Compagnon Android (Capacitor) : coquille terrain minimaliste (Accueil, Stock, Scan, Caisse, Factures, Agent), scan code-barres, réceptions/transferts/inventaire, notifications = centre d'alertes. Mises à jour via Paramètres → lien + APK (R2, servies par le worker).

## 🔒 Code de conduite & politique de sécurité

Merci de signaler toute vulnérabilité via une issue **privée** ou par message direct au propriétaire (**@loxdpsy**) — pas de divulgation publique avant correctif. Les secrets (`.dev.vars`, tokens) ne sont jamais commités ; les backups D1 sont chiffrés côté R2.

## 👋 Contribuer

Projet propriétaire (licence MIT © 2026 loxdpsy). Les contributions passent par **pull requests** depuis une branche `arena/*` ou `feature/*` : une PR = un lot cohérent, build vert (`npm run build`), `tsc --noEmit` sans nouvelle erreur, et description en français listant les zones touchées.

## 📜 Traduction

Interface **français** (terrain Maroc). Les libellés sont centralisés (`src/lib/labels.ts`) pour préparer une future traduction arabe/anglais.

## 💎 Remerciements

- **[InvenTree](https://github.com/inventree/InvenTree)** — inspiration de la roadmap stock (ops scan-first, lots/FEFO, BOM, webhooks, emplacements).
- **[PartKeepr](https://github.com/partkeepr/PartKeepr)** via InvenTree, pour l'esprit « stock low-level ».
- Cloudflare, React, Vite, Hono, Capacitor et leurs communautés.

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
<summary><strong>Roadmap v209 (inspirée d'InvenTree) — livrée</strong></summary>

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

## ⚠️ Licence

Distribué sous licence **MIT** — voir [LICENSE](LICENSE). Copyright (c) 2026 **loxdpsy**.
