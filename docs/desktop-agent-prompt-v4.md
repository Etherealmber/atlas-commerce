# Atlas Commerce Desktop — agent prompt v4 (strict)

> Paste this whole file as the task for the agent working in `Etherealmber/atlas-commerce-desktop`.
> It replaces every earlier desktop prompt. Where it conflicts with an older prompt, this file wins.

---

## 0. Read this first: why v4 exists

The last report said **M1–M5: none finished** and the **parity table had 0 rows**. That is a failed delivery. v4 removes every way to declare success without doing the work:

- Each screen has a **reference PNG** (light and dark, 1280×800) and a **measured element table**. "Looks close" does not count. The rule is: **same elements, same text, same order, same position, same spacing, same colours.**
- The parity table (§12) is **mandatory**. One row per screen per theme. A report without it is rejected, whatever else it contains.
- You may **not** mark a milestone done while any of its screens is missing, uses placeholder text, or differs from its PNG by more than the tolerances in §2.
- No excuse text in the UI. Never write "not available on desktop", "open in browser", "coming later" or similar. The only allowed "soon" UI is the **Langue → Bientôt** popup, which the web has too.

If something truly needs the server to change, **do not fake it on the client**. Stop and write a backend prompt (§13), then keep going on everything else.

---

## 1. Sources of truth (all in the web repo `Etherealmber/atlas-commerce`, branch `main`)

| What | Path | Use it for |
|---|---|---|
| Login, pixel spec | `docs/desktop-login-reference/SPEC.md` + PNGs + `measurements.json` | Login, OTP, QR, error states. **Already specified; keep it identical.** |
| Shell, pixel spec | `docs/desktop-shell-reference/SPEC.md` + PNGs + `measurements.json` | Sidebar, floating dock, notifications, user menu, dashboard widgets, **every wizard** (per-step tables). |
| Every page and every Settings section | `docs/desktop-pages-reference/` | `page-*.png`, `settings-*.png`, `agent-*.png`, `ui-*.png` (light and dark, 1280×800). Scroll slices are named `*-y720-*`, `*-y1440-*`, and so on (slice *n* = scrolled to y = n×720). |
| Element inventory | `docs/desktop-pages-reference/INVENTORY.md` | Every heading, label, control and table column per screen, in reading order, with x/y/w/h, light and dark bg/fg, radius, border and font. |
| Raw measurements | `docs/desktop-pages-reference/measurements.json` | Same data, machine-readable, plus slice lists. Use it for automated diffing. |
| Behaviour | `src/pages/*.tsx`, `src/components/**`, `src/styles/*.css` | When a PNG does not show a state (hover, focus, validation), the web code is the spec. |
| How the references were made | `scripts/capture-desktop-reference.mjs` | Same fixtures (Atlas Marbre SARL, 4 clients, 3 suppliers, 8 products…). Seed the desktop with the **same data** before capturing, so screenshots are comparable. |

Reference viewport is **1280×800 at scale 1**, with the sidebar collapsed (64 px rail), font **DM Sans**, `prefers-reduced-motion: reduce`.

---

## 2. Global rules (apply to every screen)

### 2.1 Tolerances (pixel parity)

- Positions and sizes: **±2 px** against `INVENTORY.md` / `measurements.json`.
- Colours: **exact** hex/rgb from the inventory (ΔE < 2 if anti-aliasing is involved).
- Radius, border width, font size and font weight: **exact**.
- Text: **exact French strings**, including typographic apostrophes (’), non-breaking spaces before `:` `?` `!`, « guillemets », ellipses (…), and the casing in the PNG (column headers are UPPERCASE because of CSS `text-transform`, not the source string).
- Both themes. Dark is **not** an inverted light. Use the dark values from the inventory.

### 2.2 Design tokens (measured; light / dark)

| Token | Light | Dark |
|---|---|---|
| Window/page background | `rgb(234,237,241)` | `rgb(15,15,18)` |
| Main content area | `rgb(244,245,247)` | `rgb(18,18,21)` |
| Sidebar rail | 64×800, `#ffffff` | `rgb(17,17,19)` |
| Floating dock | 336.9×58 at x 507.5, y 10, radius 999, padding 6/10, gap 12; `#ffffff`, 1 px `rgb(232,234,239)` | `rgba(20,20,23,.88)` |
| Panel (`ac-panel`) | radius 16, padding 14/16, `#ffffff` | `rgb(28,28,31)`, border `rgb(42,42,46)` |
| Table header `th` | 10.88 px / 700 / UPPERCASE, padding 12/14 | same metrics |
| Table cell `td` | 14 px, padding 12/14 | same metrics |
| Input | height 49.6 (settings) / 40 (filters), radius 12 | — |
| Secondary button | height 46, radius 12 | — |
| Primary button | height 45.6, radius 12, `rgb(24,24,27)` | `rgb(63,63,70)` |
| Pager | pill, padding 3, step buttons 32×32 round | — |
| Segmented control (`7j 1m 6m 1a 2a YTD`) | track radius 999, padding 4, buttons 12.48 px, padding 6/12 | — |

If a token here disagrees with `INVENTORY.md` for a given screen, the inventory wins (it is per element).

### 2.3 Never

- Never ship a screen with Lorem ipsum, "TODO" or English placeholder text.
- Never replace a web control with a different widget type (a segmented control stays segmented; a select stays a select; a toggle stays a toggle).
- Never move an action into a different place than the web (for example, row actions stay in the ACTIONS column, page actions stay top-right).
- Never show buttons that look like links. Buttons are filled or outlined, never underlined.
- Never add focus rings to non-interactive headings.

---

## 3. Deletions (do these first, in this order; each must compile)

1. **Delete** `browser_auth.rs` and every `webview_auth*.rs`, plus their modules, features, dependencies and call sites. The desktop never opens a browser or webview for auth.
2. **Delete** `Route::Settings` from the router and the sidebar. **Settings was never in the sidebar.** It opens only from the user menu → **Paramètres**, as a **modal popup** (§7).
3. Delete any "open in browser" fallback, any "not supported on desktop" string, and any dead screen stub not listed in §6.

Proof required in the report: `git grep -n "browser_auth\|webview_auth\|Route::Settings"` returns nothing.

---

## 4. Authentication (keep v3 exactly; restate)

- Native login identical to the web login PNGs: **password**, **passkey** (Windows Hello; no Mac passkeys, because there is no paid Apple Team ID) and **QR approved from the phone**.
- OTP by e-mail through the existing mail service (the same Resend key the site uses).
- DPoP-bound tokens, refresh rotation with reuse detection, revocation and rate limits.
- **« Rester connecté »**: opt-in on each login, 12 h by default, **30 days maximum absolute expiry enforced by the server**, never extended by refresh.
- No browser flows. No weakening of auth.

---

## 5. Shell (sidebar, dock, user menu, overlays)

Follow `docs/desktop-shell-reference/SPEC.md` §2–§3.1 to the pixel. Additions in v4:

### 5.1 User menu (avatar in the dock) — reference `ui-user-menu-{light,dark}.png`

A card anchored under the dock, right-aligned to the dock's right edge, width 296, radius 16. Top to bottom:

1. Identity block (tinted card): "Bonjour" (small, muted) / **display name** / role pill ("Propriétaire", "Admin", "Secrétaire", "Magasinier" or "Utilisateur").
2. **Ajouter un compte**, subtitle "Se connecter avec un autre compte", chevron.
3. Divider.
4. **Paramètres**, "Compte et préférences", chevron. Opens the **Settings modal** (§7).
5. **Langue**, "Arabe et anglais bientôt", with a **Bientôt** pill. Opens the Langue popup (§5.3).
6. **Nouveautés**, "Journal des versions", chevron.
7. **À propos**, "Version et légal", chevron.
8. Divider.
9. **Déconnexion** (red), "Terminer la session". It **does not log out directly**: it opens the confirmation (§5.2).

Each row: 32 px round icon tile, title 14/600, subtitle 12 muted, hover tint. Escape or a click outside closes the menu.

### 5.2 Logout confirmation — reference `ui-logout-confirm-{light,dark}.png`

A modal `alertdialog` over a dimmed backdrop, card width ≈380, radius 16:

- Red icon tile (log-out glyph), title **Se déconnecter ?**
- Message: **La session actuelle sera fermée. Les données du serveur ne seront pas supprimées.**
- Close × at top-right.
- Buttons, right-aligned: **Annuler** (outlined, **focused by default**) and **Se déconnecter** (red, filled).
- Escape, ×, a backdrop click or Annuler cancels. Only **Se déconnecter** revokes the session (server revoke, then clear local tokens).

### 5.3 Langue popup — reference `ui-language-soon-{light,dark}.png`

Title **Langue**, subtitle **Bientôt disponible — l’arabe et l’anglais arrivent.** List: **Français** "Langue actuelle" with a check; **العربية** "Arabe", Bientôt pill; **English** "Anglais", Bientôt pill. One button: **Compris**. The interface stays French.

### 5.4 Guided tour — references `ui-onboarding-{dashboard,sidebar,products}-{light,dark}.png`

After the first successful login on a device (equivalent of the web "Explorer Atlas Commerce"), run the tour **once**. Persist `{status: 'pending'|'done', step}` locally. 9 steps; each opens its page and spotlights the target:

| # | Page | Target (spotlight) | Title | Body |
|---|---|---|---|---|
| 1 | Tableau de bord | hero (date, greeting, period pills) | Votre tableau de bord | Chiffre d’affaires, encaissements, stock bas et prochaines actions : tout part d’ici. Changez la période avec 7j · 1m · 6m · 1a. |
| 2 | Tableau de bord | sidebar Produits icon | Allez dans Produits | Toutes les pages sont dans la barre latérale. Commençons par le catalogue : Produits & stock. (hint: Cliquez sur l’icône, ou sur Suivant.) |
| 3 | Produits | **Ajouter un produit** button | Créez votre premier produit | Nom, prix, stock, catégorie et code-barres, en quelques étapes… (hint: la visite reprend quand vous fermez l’assistant.) |
| 4 | Clients | **Ajouter un client** | Ajoutez un client | ICE, téléphone et adresse : la fiche sert ensuite aux devis, aux factures et aux relances d’impayés. |
| 5 | Factures | **Créer une facture** | Créez une facture | Choisissez le client et les produits : la TVA, le stock et le PDF sont calculés pour vous. |
| 6 | Vente rapide | **Nouvelle vente** | Encaissez une vente rapide | Pour le comptoir : un ticket, un paiement, et le stock comme la caisse sont à jour. |
| 7 | Solde | KPI grid | Suivez votre caisse | Recettes, dépenses, apports, prélèvements et rapprochement : le solde reste toujours cohérent. |
| 8 | (current) | Atlas Agent button | Demandez à Atlas Agent | « Nouveau client », « Rapport du jour », « Dépense de 200 DH »… L’agent prépare l’action, vous la confirmez. |
| 9 | (current) | avatar | Votre compte et les paramètres | Paramètres, Nouveautés, À propos et Déconnexion sont dans ce menu. Vous pourrez revoir cette visite depuis Paramètres → Mon profil. |

Card: width 340, radius 18, kicker "VISITE GUIDÉE · n / 9", × close, title 16/700, body 13.5, optional bold hint, 9-segment progress bar, footer **Passer** (left) and **Précédent** / **Suivant** (last step: **Terminer**). The spotlight is a 3 px ring (light `#18181b` / dark `#e4e4e7`) around the target with a dim (`rgba(9,9,11,.42)` light / `rgba(0,0,0,.58)` dark). The page stays clickable. The card hides while any wizard or modal is open and comes back when it closes. Escape or Passer = done. **Revoir la visite guidée** in Settings → Mon profil restarts it.

### 5.5 Density « Compacte » — references `ui-compact-{products,invoices}-{light,dark}.png`

Settings → Mon profil has **Densité d’affichage**: segmented **Confortable / Compacte**. Compact must visibly shrink, with **no colour change**:

- buttons 34 px (row actions 28 px);
- inputs and selects 34 px;
- KPI cards padding 11/13 (radius 12);
- panels padding 11/13;
- `th` padding 7/10 at 10.4 px, `td` padding 6/10 at 13 px;
- pager steps 27 px;
- period pills 26 px;
- dock height 44 (title 34, icons 32);
- sidebar rail items 38×38 centred;
- focus-sidebar items 25 px.

Persist per device.

---

## 6. Pages (every one is required; each row of §12 cites its PNGs)

Common anatomy for list pages, top to bottom:

1. Page actions, top-right: **Actualiser** (icon button) + the page's primary actions.
2. KPI grid (`ac-metric`: UPPERCASE label, value, optional hint).
3. Filter panel (search with a leading icon + selects/segments).
4. Table panel: "N éléments · 20 par page" on the left, pager on the right, then the table, with an empty state when there are no rows.

Pager: `‹ 1 2 … n ›`, current page filled, keyboard ← → Home End.

| Screen | PNGs | Actions (top-right) | KPIs | Filters | Columns | Row actions / empty state |
|---|---|---|---|---|---|---|
| **Tableau de bord** | `page-dashboard*` (+3 slices) | period pills **7j 1m 6m 1a 2a YTD** + date-range button "01 juin 2026 — 25 nov. 2026" | Row 1: PRODUITS · STOCK BAS · À TRAITER · VENTES DU JOUR. Row 2: SOLDE ACTUEL · CRÉANCES · DETTES · PROFIT PÉRIODE | — | — | Hero: "MERCREDI 25 NOVEMBRE · UTC" / "Bonjour, amine." / "Surface de vente synchronisée — voici ce qui mérite votre attention." Then "Que faire ensuite ?" strip, then charts 2×2 (Flux de trésorerie, Évolution du profit, Ventes FA vs VR / vente rapide, Achats fournisseurs & salaires), then Encaissements & nouveaux clients, **Répartition des charges (always shown, 0 MAD rows when empty; no empty CTA)**, Créances clients, Dettes fournisseurs, Santé stock, Prochaines actions. "Voir …" actions are **buttons** with an arrow, never links. See shell SPEC §3.2. |
| **Produits & stock** | `page-products*` | Actualiser · **Ajouter un produit** | PRODUITS · AFFICHÉS · SKU / CB · OK · STOCK BAS · RUPTURE (with hints: catalogue total, filtre actuel, références, au-dessus du seuil…) | search "Nom, référence ou code-barres…", Toutes catégories, Tous les niveaux (En stock / Stock bas / Rupture); legend OK / BAS / RUPTURE; grid/list toggle | NOM · RÉFÉRENCE · CATÉGORIE · PRIX · COÛT · STOCK · STATUT · ACTIONS | Ajuster · Modifier · Étiquette · Supprimer. Empty: "Aucun produit" + **Ajouter mon premier produit**. Wizard `product` (5 steps). |
| **Clients** | `page-clients*` | Actualiser · **Ajouter un client** | SOLDE TOTAL DÛ · NOUVEAUX CE MOIS · COMPTES ACTIFS | search "Nom, ICE ou ville…" | NOM · ICE · VILLE · SOLDE · STATUT · TÉLÉPHONE · E-MAIL · TVA · CRÉDIT | Factures, edit, delete. Wizard `client` (3 steps). |
| **Fournisseurs** | `page-vendors*` | Actualiser · **Nouveau fournisseur** | SOLDE TOTAL DÛ · NOUVEAUX CE MOIS · FOURNISSEURS ACTIFS | search "Rechercher par nom ou identifiant..." | NOM · ICE / IDENTIFIANT · VILLE · SOLDE · STATUT · TÉLÉPHONE · E-MAIL | Wizard `vendor` (2 steps). |
| **Factures de vente** | `page-invoices*` | Actualiser · **Remboursement (WR)** · **Créer une facture** | TOTAL LISTE · OUVERTES · PAYÉES · RESTE DÛ | search "Rechercher par numéro ou nom de client...", status select | NUMÉRO · CLIENT · DATE · ÉCHÉANCE · STATUT · TOTAL · PAYÉ · CRÉDIT (RESTE) · ACTIONS | Modifier · BL · status. Wizards `invoice` (3), `refund-wr` (2). |
| **Devis** | `page-quotes*` | Actualiser · **Nouveau devis** | DEVIS · EN COURS · EXPIRÉS · MONTANT DEVIS | search "Rechercher n°, client, statut…" | N° · CLIENT · DATE · STATUT · TOTAL | Modifier · Facturer · Annuler. Wizard `quote` (3). |
| **Reçus** | `page-receipts*` | Actualiser · **Nouveau reçu** | — | search | NUMÉRO · CLIENT · MONTANT · MODE · DATE · FACTURE · ACTIONS | Reçu détail · Ticket minimal · PDF · Situation QR. Wizard `receipt` (2). |
| **Factures d’achat** | `page-bills*` | Actualiser · **PDF Dettes** · **Nouvelle facture d'achat** | — | search "Rechercher par numéro ou nom de fournisseur...", status select | NUMÉRO · FOURNISSEUR · DATE · STATUT · TOTAL · PAYÉ · ACTIONS | Imprimer · Réception · Paiement… · Tout payer. Wizard `bill` (3) incl. OCR steps. |
| **Vente rapide** | `page-quick-sale*` | Actualiser · **Remboursement (WR)** · **Nouvelle vente** | TICKETS · OUVERTS · PAYÉS · SOLDE CAISSE | search, "Tous les tickets / Non soldés / Partiels / Encaissés / Annulés" | NUMÉRO · CLIENT · DATE · STATUT · TOTAL · PAYÉ · RESTE · ACTIONS | Modifier · Imprimer · Annuler. Wizard `quick-sale` (3). |
| **Remboursements** | `page-reimbursements*` | Actualiser · **Remboursement (WR)** | — | search "Rechercher n°, client…" | N° · CLIENT · DATE · STATUT · TOTAL | Empty: "Aucun remboursement" / "Créez un avoir WR via le bouton « Remboursement (WR) »." |
| **Solde & recettes** | `page-balance*` | Actualiser · **Recette · Apport · Prélèvement · Dépense** · **Rapports PDF & exports** | SOLDE ACTUEL · ENTRÉES · SORTIES · FLUX NET (+ Caisse (espèces) / Banque & virements / Apports propriétaire / Prélèvements) | "Toutes les écritures / Recettes / Dépenses / Apports / Prélèvements", "Rechercher…" | Transactions récentes table | Charts: Sorties par catégorie, Répartition par type, Entrées (recettes + apports), Sorties (dépenses + prélèvements). Reconcile banner **"Cohérent"** (dark header must be dark). Wizards `balance-recette`, `balance-depense`, `balance-reports-dialog`. |
| **Employés** | `page-employees*` | Actualiser · **Imprimer fiche d’embauche** · **Ajouter un employé** | ACTIFS · À PAYER · MASSE (ACTIFS) | search "Rechercher nom, n° employé, poste, téléphone, CIN…", categories (Magasin, Bureau, Chantier, Direction), **Actifs / Démissionnaires / Tous** | NOM · N° · POSTE · SALAIRE · CYCLE · DERNIER PAIEMENT · PROCHAINE ÉCHÉANCE · PIÈCE ID · ACTIONS | Fiche · Situation · Marquer payé. Wizard `employee` (9). |
| **Pointage / Présence** | `page-attendance*` | — | — | — | — | Disabled state: "Module Présence désactivé" + **Activer maintenant**. Enabled state follows web `Attendance.tsx`. |
| **Paie** | `page-payroll*` | Actualiser · **Paramètres CNSS / AMO** · **Générer le lot de paie** | LOTS GÉNÉRÉS · MASSE BRUTE · NET À PAYER · COÛT EMPLOYEUR | "Période (mois)" 2026-11 | # · PÉRIODE · TYPE · STATUT · BRUT · NET · COÛT EMPLOYEUR · ACTIONS | Sections "Générer un lot de paie", "Historique des lots de paie". |
| **Clôtures de caisse** | `page-cash-shifts*` (+2 slices) | — | SESSIONS OUVERTES · SESSIONS CLÔTURÉES · ATTENDU ESPÈCES · ÉCART CUMULÉ | — | Totals: MOYEN · ENTRÉES · SORTIES · ATTENDU · COMPTÉ · ÉCART. History: # · CAISSE · OPÉRATEUR · OUVERTURE · CLÔTURE · FOND · STATUT · RAPPORTS | "Ouvrir une session de caisse" (Caisse CAISSE-1, Fond d'ouverture (DH), Notes d'ouverture, **Ouvrir la caisse**), Sessions ouvertes (Détails, Rapport X, Imprimer Rapport X), "Mouvement manuel sur session" (Sens, Moyen, Montant (DH), Libellé, **Ajouter le mouvement**), "Clôturer la session (Rapport Z)" with denomination counters 200…0.5 DH and **Clôturer & Générer Rapport Z**, Historique des sessions. |
| **Opérations stock** | `page-inventory-ops*` (+3 slices) | Actualiser · **Exécuter transferts auto** | ENTREPÔTS · UNITÉS EN STOCK · VALEUR (COÛT MOYEN) · TRANSFERTS AUTO | "PÉRIMÈTRE ENTREPÔT": Tous les entrepôts (consolidé) | category/product/warehouse tables | Transfert inter-emplacements (**Transférer**), Inventaire physique (**Enregistrer le comptage**), Rapport stock consolidé, Emplacements / entrepôts (**Ajouter un entrepôt**), Valorisation, Transferts automatiques (**Exécuter maintenant**, Nouvelle règle, **Enregistrer la règle**). |
| **Rapports** | `page-reports*` (+2 slices) | Actualiser · **Balance âgée** · **Paie PDF** · **Pack rapports** + period pills + Choisir une période | CRÉANCES OUVERTES · TVA NETTE · COGS PÉRIODE · À RÉAPPROVISIONNER | — | per section | Balance âgée, Récapitulatif TVA, Ventes, Avoirs WR, À réapprovisionner (Créer brouillon d'achat, Copier le message fournisseur), COGS & FIFO, Clôture de période fiscale, Export FEC (Vérifier l’équilibre, Télécharger l’archive FEC (.zip)). Export buttons: Imprimer / PDF, Excel / CSV, CSV. |
| **Boîte d’actions** | `page-actions*` | Actualiser | EN ATTENTE · NOUVEAUX PRODUITS · CONTRÔLES STOCK · CLÔTURÉES | segment **En attente / Terminées / Toutes** | — | Empty: "Aucune action" / "Les nouvelles demandes produit, ventes rapides et contrôles…" |

**Missing native screens today (all are required in this delivery):** attendance, quotes, quick-sale, receipts, reimbursements, bills, balance, cash-shifts, payroll, reports, inventory-ops, actions.

Every wizard listed above must match its per-step table in `docs/desktop-shell-reference/SPEC.md` §3.4: eyebrow, title, step count, step labels, fields, footer (**Annuler**, **Retour**, primary).

---

## 7. Settings = modal popup (NOT a route, NOT in the sidebar)

### 7.1 Container

Opened from user menu → **Paramètres**. A large centred modal over a dimmed backdrop, about 1120×720 at 1280×800 (keep 40 px margins), radius 20. Escape or × closes it. If anything is unsaved, the floating save bar shows first (§7.4).

Visual reference for the **airy layout**: `image-404` (Cider settings). Use:

- a search pill at the top of the left column;
- small uppercase group labels;
- items as icon + title (+ subtitle where the web has one);
- a selected item as a filled pill;
- on the right, a title pill, then **row cards** (label + help on the left, control on the right) with **generous gaps** (16–20 px between cards, 14/16 inside).

The **content and controls are exactly the web ones**. Only the container is a popup.

### 7.2 Left column: exactly these groups and items, in this order

- **Search** "Rechercher un réglage…"
- **COMPTE & SOCIÉTÉ:** Mon profil · Langue *(Bientôt)* · Société · Présence · Paie CNSS / AMO
- **FACTURATION & STOCK:** Facturation · Légal & TVA · Plan comptable (FEC) · Relances impayés · Documents PDF · Entrepôts · Catégories
- **SYSTÈME & IA:** Atlas Agent *(IA)* · API & Clés · Mise à jour app · Administration · Journal d’audit
- **Footer:** Nouveautés · À propos · Support

That is 16 sections plus 3 footer links. Same icons as web `FocusSidebar.tsx`. Item metrics (from the web, scaled into the modal): 224×29, radius 9, 12.96 px / 600, badge pills 10.24 px.

### 7.3 Right side: section content equal to web `src/pages/Settings.tsx`

Each section has PNGs `settings-<tab>-{light,dark}.png` plus slices. Top of every section: a KPI row with SECTION ACTIVE · COMPTE ACTIF · SOCIÉTÉ · SYNCHRONISATION. Then:

| Section (tab id) | Must contain (exact labels; see INVENTORY for every field) |
|---|---|
| Mon profil (`profile`) | Profile bar (name, e-mail, **Modifier le profil**); **Densité d’affichage** Confortable/Compacte; **Visite guidée** → **Revoir la visite guidée**; Base de données & migration; Mes clés d'accès (passkeys) **+ Ajouter une passkey**; Sécurité d'accès (WebAuthn / FIDO2); Sécurité du compte (Double authentification (2FA), Appareils connectés → **Voir les appareils (n)**); Langue → **Changer de langue · Bientôt** |
| Langue | Opens the Langue popup (§5.3) |
| Société (`company`) | Informations de la société: Nom de la société *, Forme juridique, Adresse, Ville, Code postal, Pays, Téléphone, E-mail, Site web, URL du logo, Notes par défaut (factures), Pied de page des rapports PDF |
| Présence (`attendance`) | Module toggles (Présence activée, Paie liée à la présence); Horaires & pointage (Seuil retard 09:15, Départ anticipé avant 18:00, Heures / jour ouvrable 8, Majoration heures sup. 1.25, half-days 09:00-13:00 / 14:00-18:00); Paie liée à la présence (mode de calcul); Discipline (Retards → avertissement 3 / blâme 6); Acomptes (5 % / 15 % and weekly %); **Enregistrer toutes les règles** |
| Paie CNSS / AMO (`payroll`) | Barème paie Maroc (CNSS / AMO / IGR): **Charger les taux**, **Afficher & modifier les taux CNSS / AMO** |
| Facturation (`invoicing`) | Numérotation: style, digits, prefixes FA- / EMP- / DEV- / ACH- / REC- / WR- / VR-, next numbers; Clôture de période fiscale (**Enregistrer la clôture**, **Rouvrir**); Aperçu PDF tabs Facture · Devis · Reçu · Achat · Avoir · Rapport · Fiche employé |
| Légal & TVA (`legal`) | ICE, IF, RC, Patente, CNSS, Taux de TVA (%), purge days, decimals, QR validity, retention, footer note, Mentions légales toggle, Devise principale MAD, Devise secondaire, Taux, Format de date |
| Plan comptable (FEC) (`fec`) | **Charger les comptes**, **Afficher & configurer le plan comptable** |
| Relances impayés (`dunning`) | **Charger la config relances**, **Afficher & configurer les relances** |
| Documents PDF (`documents`) | Toggles (logo, QR, QR on all receipts, RIB, signature & cachet, promo line), Couleur d’accent #1a1814, Texte bas de page, Signature (URL / import), Cachet (URL / import) |
| Entrepôts (`warehouse`) | Multi-entrepôts activé, sales/purchase location IDs, Méthode CMP / FIFO |
| Catégories (`categories`) | Form (name, description, **+ Ajouter**), table NOM · DESCRIPTION · SOURCE, Unités de mesure (**+ Ajouter unité**), empty states |
| Atlas Agent (`agent`) | Mémoire & savoir (**Mémoriser**), Atlas Agent & Sécurité (statut, données, **Supprimer toutes mes conversations (OTP)**), Permissions (**Gérer les permissions**), Atlas Agent · Groq |
| API & Clés (`integrations`) | Clés API (**Créer une clé**, table NOM · PRÉFIXE · SCOPES · CRÉÉE), Webhooks (URL · EVENTS · ALERTE · SEUIL · ACTIVE · TEST), Rapports & crashs → GitHub |
| Mise à jour app (`app`) | Platform segment **Android (APK) · Windows · macOS · Linux**; per platform: R2 rows, Copier URL latest.json / latest.apk, latest.json editor (versionCode, versionName, apkUrl, mandatory, minimum version, notes), upload |
| Administration (`admin`) | Guide d’accueil, Sauvegarde & restauration (R2 / .abk), Administrateur principal, Comptes de l'équipe (table + **+ Ajouter un utilisateur**), Équipe & rôles (matrix 4 roles × 13 actions), Journal d'audit, Pack mensuel, Intégrité & régression E2E, Zone sensible, Serveur |
| Journal d’audit (`audit`) | Range **24 h · 7 j · 30 j · Tout**, Actualiser, Export CSV, charts (Activité dans le temps, Types d’action), table HORODATAGE · ACTION · RESSOURCE · ACTEUR · IP · DÉTAIL, pager |

### 7.4 Save bar

When a value changes, a floating bar appears at the bottom of the modal with **Annuler** and **Enregistrer**, then confirms **Paramètres enregistrés**. The SaveToggle states (À jour / Enregistrer / En cours… / Erreur) follow the web.

---

## 8. Atlas Agent — references `agent-open-empty-*`, `agent-open-conversation-*`

- **FAB:** 56×56 at (1204, 724), radius 18, sparkle icon.
- **Panel:** right side, 380×800 at x 900. Background `rgb(250,250,250)` light / `rgb(24,24,27)` dark.
- **Header** (h 74): "Atlas Agent" / "Je suis là pour vous aider…". Icon buttons 36×36, radius 12 (dark `#27272a`): history, new conversation, settings, and close (red).
- **Empty state:** "PAGE ACTUELLE" card (current page name), greeting "Bonsoir" (by time of day), quick chips **Nouveau client · Dépense · Rapport du jour**.
- **Conversation:** user bubbles on the right, assistant on the left with a **Copier** button inside the bubble, and action cards ("Action préparée : …" with **Confirmer** / **Annuler**).
- **Composer:** "Écrire un message…", send button. Quota line shows `used / limit` and never "NaN" (unknown limit: hide the percentage, do not block sending).
- Threads persist per user. Actions require confirmation, as on the web.

---

## 9. Floating dock behaviours

Per the shell SPEC:

- The title is **not** a button-looking element. Tapping it grows the dock with animation.
- Compact after scrolling down more than 140 px.
- On Settings-like focus screens, a back arrow appears.
- Notifications panel on the bell.

---

## 10. Milestones (each one needs its §12 rows **green** before the next starts)

- **M1 — Clean-up and shell.** §3 deletions; sidebar, dock, user menu, logout confirmation, Langue popup; light and dark tokens.
- **M2 — Settings modal.** All 16 sections and their content, save bar, search.
- **M3 — Core pages.** Dashboard, Produits, Clients, Fournisseurs, Factures, Devis, Reçus, Factures d’achat, Vente rapide, Remboursements, with all their wizards.
- **M4 — Money and staff.** Solde, Clôtures de caisse, Employés, Présence, Paie, Rapports, Opérations stock, Boîte d’actions.
- **M5 — Agent, tour and density.** Atlas Agent, guided tour, Compacte, plus the final visual pass (both themes, 1280×800 and 1440×900).

---

## 11. Verification you must run

1. Seed the same fixtures as `scripts/capture-desktop-reference.mjs`.
2. Capture each desktop screen at 1280×800, light and dark, sidebar collapsed, same scroll slices.
3. Diff each against the reference PNG. Report the % of pixels that differ by more than ΔE 4, and the worst region.
4. Element diff: for each node in `measurements.json` (same text), compare x/y/w/h and colours with your layout dump.
5. `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`: all green; 0 warnings.

---

## 12. Parity table (MANDATORY — copy and fill; one row per screen per theme)

| # | Screen | Theme | Reference PNG(s) | Desktop capture | Pixel diff % | Max element offset (px) | Missing elements | Extra elements | Text mismatches | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Login | light | desktop-login-reference/default-light-1280x800.png | … | … | … | none | none | none | ✅/❌ |
| … | … | … | … | … | … | … | … | … | … | … |

**Required rows (×2 themes each):**

- **Shell:** login (default, error, otp, claimed), sidebar collapsed, sidebar hover, sidebar expanded, dock, dock compact, notifications, user menu, logout confirmation, Langue popup.
- **Pages:** dashboard and its 3 slices, plus each page in §6 with its slices.
- **Wizards:** every wizard in shell SPEC §3.4.
- **Settings:** each of the 16 sections plus slices.
- **Agent:** empty, conversation.
- **Tour:** steps 1, 2 and 3.
- **Compacte:** products, invoices.

Status ✅ only when: diff ≤ 3 %, max offset ≤ 2 px, and no missing, extra or mismatched elements. Anything else is ❌ with the reason. **A report with 0 rows, or with rows marked ✅ without numbers, is a failed report.**

---

## 13. If the backend must change

Do not invent endpoints and do not stub data. Write `BACKEND_REQUEST.md` with: the endpoint, method, request/response JSON, auth (DPoP scope), rate limit, error codes, and which screen needs it. Paste it at the top of your report. Continue with every other screen meanwhile.

---

## 14. Report format (exactly this order)

1. Backend requests (if any).
2. Deletions proof (the `git grep` output).
3. Milestone status M1–M5, each with its parity rows.
4. The full §12 table.
5. Known differences that are still ❌, with a plan.
6. Commands run and their results (fmt, clippy, test, capture, diff).
