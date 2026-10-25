# MASTER PROMPT — Atlas Commerce Desktop : parité visuelle STRICTE avec le web et l'Android

> **Comment l'utiliser** : colle ce document ENTIER comme prompt système/tâche de l'IA qui
> construit l'app desktop (Tauri/Electron/autre). Chaque valeur ci-dessous est EXTRAITE des deux
> repos sources cités — l'IA n'a **rien à deviner**. Règle d'or : **toute valeur manquante =
> ouvrir le fichier cité ; si inaccessible, réutiliser le token cité le plus proche et le
> signaler en commentaire `// SOURCED-FROM: <fichier>` — JAMAIS inventer.**

---

## 0. CONTRAT — non-négociables

1. **Zéro invention.** Palette, rayons, tailles, durées : uniquement les valeurs de ce document
   (sources : `Etherealmber/atlas-commerce` = web/worker, `Etherealmber/atlas-commerce-android` = APK).
2. **UNE seule palette zinc + noir** (`#0a0a0a` / `#fafafa` / gris zinc). **Jamais de teal, vert ou
   bleu comme couleur de marque.** Le vert/rouge/ambre existent UNIQUEMENT en sémantique
   financière (tuiles, statuts) — jamais sur un bouton de marque.
3. **UI 100 % française** (libellés, erreurs, dates `fr-FR`, montants `fr-FR` + devise de l'entreprise).
4. **Thème sombre = parité totale** : chaque élément a sa valeur sombre (§3). Aucun flash blanc,
   aucun fond blanc dur en sombre.
5. **Aucun texte d'interface sélectionnable/copiable** (boutons, libellés, tuiles) — seuls les
   champs de saisie le sont. Source web : `src/styles/dark-force.css:2611`
   (`html body button, html body .btn { user-select: none; }`).
6. **Aucun bouton rogné** : hauteur minimale garantie, libellé en ellipsis si nécessaire,
   padding horizontal ≥ 14 px.
7. **Cibles ≥ 44 px** de haut sur tout élément cliquable (48–50 px pour les boutons principaux).
8. **Fenêtre** : barre de titre personnalisée affichant `Atlas Commerce — <serveur>` ;
   **choix du serveur au premier lancement** (liste + champ URL, mémorisé) ; mises à jour
   **uniquement via GitHub Releases** (jamais de store).
9. **Popups = assistants pas-à-pas** : bouton Continuer au même niveau visuel, pas de « Retour »
   sur la première page, actions du pied **à droite**, pied collant sans chevauchement,
   pastille « Étape » compacte, pied arrondi en haut, **aucun scroll dans l'assistant**,
   clic extérieur / overlay = annuler + réinitialiser.
10. Si une spécification de ce document contredit ton habitude : **ce document gagne**.

## 1. Sources de vérité (fichiers à ouvrir en cas de doute)

| Sujet | Web (`atlas-commerce`) | Android (`atlas-commerce-android`) |
|---|---|---|
| Tokens densité/couleurs ERP | `src/components/erp/atlas-tokens.css` | `app/.../ui/theme/Theme.kt` |
| Coquille (topbar, sidebar) | `src/styles/theme.css`, `src/styles/shell.css` | `app/.../ui/shell/MainShell.kt` |
| Boutons/cartes/tuiles | `src/index.css`, `src/styles/overrides-final.css` | `app/.../ui/components/AtlasComponents.kt` |
| Sombre (source unique, chargée DERNIÈRE) | `src/styles/dark-force.css` | `Theme.kt` (dark colorScheme) |
| Motion | `src/styles/motion-polish.css` | `Theme.kt` + composants (ripple) |
| Accueil héro | `src/pages/Dashboard.tsx` | `app/.../ui/screens/home/HomeScreen.kt` |
| Densités | `src/lib/density.ts` | `Theme.kt` (Atlas.density compact/regular) |

## 2. COULEURS — table unique (clair / sombre)

Rôle | Clair | Sombre | Source
---|---|---|---
Fond applicatif | `#f4f5f7` (web `--ac-bg`) · alt `#f8fafc` (atlas) | `#111113` | theme.css:7 / dark-force.css
Surface/papier (cartes, modales) | `#ffffff` | `#1c1c1f` | theme.css:8
Encre (texte principal) | `#0f172a` | `#f4f4f5` | theme.css:9
Texte secondaire/muted | `#64748b` (web) · `#71717a` (atlas) | `#a1a1aa` | theme.css:10
Lignes/bordures | `#e8eaef` | `#2a2a2e` | theme.css:11
Sidebar fond / bord | `#ffffff` / `#eceef2` | `#111113` / `#2a2a2e` | theme.css:12-13
Nav inactif / hover / actif fond / actif | `#475569` / `#f1f5f9` / `#f1f5f9` / `#0f172a` | `#a1a1aa` / `#27272a` / `#27272a` / `#fafafa` | theme.css:14-17
**Marque / bouton primaire** | `#0a0a0a` (fg `#fafafa`) | `#fafafa` (fg `#0a0a0a`) | theme.css:18-19
Hover primaire | `#2a3040` | `#a5b4bc`→ utiliser `#a5b4fc` SEULEMENT en accent-lien sombre | atlas-tokens.css
Accent chaud (badges, compteurs) | `#f59e0b` (Saffron) | `#f59e0b` | Theme.kt:28
Papier chaud (fonds hero secondaires) | `#f5f2eb` (Paper) | — | Theme.kt:29
Warning | `#d97706` | `#fbbf24` | theme.css:22
Danger | `#dc2626` | `#f87171` | theme.css:23
OK/succès (zinc, PAS vert) | `#52525b` | `#a1a1aa` | theme.css:21
Sémantique financière (tuiles SEULEMENT) : positive `#0f7b4f`/soft `#e6f6ec` · warning `#b45309`/soft `#fef3c7` · danger `#b91c1c`/soft `#fee2e2` · info `#1d4ed8`/soft `#e0eaff` | sombre : `#34d399`/`#10362a` · `#fbbf24`/`#3a2a0b` · `#f87171`/`#3a1414` · `#93c5fd`/`#16233f` | Theme.kt:62-92
Surfaces Android (référence mobile) | Paper `#f5f2eb`, Surface `#ffffff`, Elevated `#faF8f4` | DarkBg `#0a0a0c`, DarkSurface `#141414`, DarkElevated `#1a1a1a`, outline `#27272a` | Theme.kt:29-41

**Règles d'usage** : ombres clair `0 1px 2px rgba(15,23,42,0.04)` ; **sombre = aucune ombre**
(`--ac-shadow: none`). Glass/blur : **désactivé** (`--glass-blur: 0px`, fonds transparents —
`src/lib/density.ts:80-82`).

## 3. TYPOGRAPHIE

- Familles web : sans = **'DM Sans'** (repli `system-ui, -apple-system, sans-serif`) ;
  mono = **'Spline Sans Mono'** (repli `ui-monospace, SFMono-Regular, Menlo`) avec
  `font-variant-numeric: tabular-nums` pour TOUT montant/quantité (atlas-tokens.css).
- Échelle web (densité ERP) : base **13 px**, sm **12 px** ; titres de page 19–22 px bold.
- Échelle Android (sp, Theme.kt:199-205) : displaySmall **32 Bold**, headlineMedium **26 Bold**,
  headlineSmall **22 Bold**, titleLarge **19 Bold**, titleMedium **16 SemiBold**,
  titleSmall **14 Medium**, bodyLarge **14**, body **14/13/12** (regular/compact).
- **Desktop** : DM Sans ; corps 13–14 px ; titres d'écran 19 px Bold ; titres de section 16 px
  SemiBold ; libellés secondaires 12 px ; montants en Spline Sans Mono tabular-nums.
- Interlettrage : `0.01em` sur les libellés de boutons/chips (index.css:284).

## 4. FORMES, ESPACEMENTS, DENSITÉ

Rayons | Web | Android | **Desktop (à appliquer)**
---|---|---|---
Carte | 10 px (`index.css:37`) | 18 dp (AtlasCard) | **14 px**
Input / select | 10 px (`index.css:69`) | 14 dp | **12 px**
Bouton | 12 px (`index.css:284`) | 14 dp | **12 px**
Grand panneau / modale | 16 px (`--ac-radius-lg`) | 24 dp | **18 px** (pied arrondi HAUT seulement)
Chip / badge / pastille | 999 px | 999 dp | **999 px**
Tuile statistique | — | 14 dp | **14 px**
Héro accueil | — | 20 dp | **20 px**

Espacements Android (Theme.kt:113-131) — **compact** = desktop par défaut :
screenPadding 12 · cardMargin 8 · cardPadding 12 · sectionGap 12 · itemGap 8 ·
barHorizontal 12 · barVertical 8 · icônes 22 px. (regular = 18/12/16/18/10/16/10/24 si
l'utilisateur active « confortable ».)
Coquille web (theme.css:26-29, shell.css) : topbar **56 px** sticky · sidebar **280 px**
(repliée **72 px**) · recherche topbar max **420 px** · bouton-icône **40×40 px** ·
badge compteur **16 px** pill top-right.

## 5. COMPOSANTS — specs exactes

- **Bouton primaire** : fond marque (§2), fg inversé, r12, **h44 px desktop / minH 50 dp android**,
  padding h 16–20 px, poids SemiBold, hover = translation Y −1 px + ombre douce 0.25 s,
  press = ripple matériau, disabled = opacité 0.5 + curseur interdit. Sombre : inverser fond/fg.
- **Bouton secondaire** : fond transparent, bord 1 px ligne, r12, h40–44 px ; hover fond hover-token.
- **Carte** : fond papier, bord 1 px ligne, r14 desktop, padding 12–16, ombre §2 (aucune en sombre).
- **Tuile statistique** : r14, padding 12, valeur 22–26 px Bold mono tabular, delta 12 px muted,
  icône 22 px dans pastille accent-soft.
- **Héro accueil** : dégradé `#171717 → #2b2b2b` (clair) / `#1f1f23 → #0e0e11` (sombre), r20,
  padding bas 28, titre 26–32 px Bold blanc, sous-titre 13 px `#a1a1aa`, actions en Row gap 8–10.
- **Topbar** : h56, sticky, fond papier, bord bas ligne ; gauche = titre d'onglet +
  `nom · rôle` ; centre = recherche (max 420) ; droite = boutons-icônes 40 px + avatar rond.
- **Sidebar** : 280 px, fond sidebar, bord droit ; items h40 r10, icône 20 px + libellé 13 px ;
  actif = fond nav-active-bg + encre SemiBold ; badges saffron pill.
- **Tables** : en-têtes 12 px muted uppercase-like (pas de transformation de casse : libellés
  français tels quels), lignes h44, zébrure hover seulement, montants à droite en mono.
- **Modales/assistants** : voir contrat §9 ; largeur 480–720 px ; pied collant fond papier,
  bord haut ligne, rayon haut 18, actions à droite (Annuler secondaire puis Continuer primaire).
- **Toasts** : bas-centre ou haut-droite, r12, fond encre inversé, texte papier, 4 s, une action max.
- **Icônes** : famille Material Outlined côté Android (Home, Inventory2, QrCodeScanner,
  ShoppingCart, AutoAwesome — MainShell.kt:73-77) ; web = lucide-react. Desktop : lucide,
  trait 20–24 px, couleur muted (actif = encre).

## 6. MOTION (motion-polish.css)

- Courbe UNIQUE : `cubic-bezier(0.2, 0, 0, 1)`.
- Hover (transform+ombre) **0.25 s** · menus/dropdowns **0.22 s** (`ac-drop-in`) ·
  panneaux **0.32 s** (`ac-panel-in`) · grands panneaux/modales **0.36 s**.
- Changement de thème = **révélation circulaire** depuis le bouton bascule.
- Statistiques = CountUp 0.6–0.9 s à l'entrée d'écran ; ripple matériau au press.
- `prefers-reduced-motion` : tout couper sauf opacités.

## 7. THÈME SOMBRE — règles

1. Fichier/layer sombre chargé **EN DERNIER** (équivalent `dark-force.css`), valeurs `!important`
   uniquement pour les variables de surface (§2).
2. Glassmorphisme **off** : blur 0, saturate 1, fonds transparents.
3. Aucune NOUVELLE déclaration blanche dans les blocs sombres (garde CI web).
4. Champs de saisie sombres : fond `#1c1c1f`, bord `#2a2a2e`, texte `#f4f4f5`, placeholder `#71717a`.
5. Scrollbars fines zinc `#27272a` ; sélection de texte `rgba(250,250,250,0.2)`.

## 8. RÈGLES DESKTOP SPÉCIFIQUES

- Premier lancement : écran « Choisir le serveur » (détection + liste + URL personnalisée),
  mémorisé, modifiable depuis Paramètres ; badge du serveur courant dans la barre de titre.
- Mises à jour : GitHub Releases uniquement (manifeste JSON signé par tag) ; jamais de store ;
  bouton « Vérifier les mises à jour » dans Paramètres → À propos.
- Raccourcis clavier : `Ctrl/Cmd+K` recherche, `Ctrl/Cmd+,` paramètres, `F2` vente rapide,
  `Ctrl/Cmd+P` impression du document ouvert.
- État hors-ligne : bandeau zinc discret + reprise automatique des requêtes GET.
- Impression/PDF : reprendre les shells HTML existants (`reportShell`) — même en-tête/pied.
- Fenêtre min 1024×680 ; sous 1180 px la sidebar passe en icônes (72 px).

## 9. CHECKLIST DE PARITÉ PAR ÉCRAN (web ↔ android ↔ desktop)

Accueil/Dashboard (héro + tuiles + alertes stock) · Produits (grille + scan) · Scan (camera
stub + saisie manuelle) · Vente rapide (panier + ticket) · Factures/Devis/Reçus · Clients ·
Fournisseurs · Employés & paie · Pointage · Solde & trésorerie (barre rapports + sélecteur de
mois + libellé « Période : … ») · Rapports · Opérations stock · Agent (chat persistant,
images jointes ouvrables) · Paramètres (sections, intégrations, rapports GitHub) · À propos
(signalements) · Nouveautés · Login/OTP/QR.
Pour chacun : mêmes libellés FR, mêmes colonnes/champs, mêmes vides (« Aucun … »), mêmes
codes couleur sémantiques, light **et** dark.

## 10. PROTOCOLE DE VÉRIFICATION (définition of done)

1. Grep du thème desktop : **aucun hex hors §2** (script allow-list ; tout écart = échec).
2. Captures light + dark de chaque écran §9 ; comparaison côte-à-côte avec le web
   (`https://<serveur>`) et l'APK : pipette sur fond/carte/bouton/ligne = valeurs §2 exactes.
3. Mesures : topbar 56 · boutons ≥ 44 · cartes r14 · inputs r12 · cibles ≥ 44 · aucun rognage
   à 100 % et 125 % de zoom.
4. Texte : aucun libellé de bouton sélectionnable (test sélection = vide) ; aucun texte anglais.
5. Motion : courbe unique vérifiée dans le CSS généré ; reduced-motion respecté.
6. Sombre : zéro blanc pur (`#ffffff`) hors champs de saisie clairs intentionnels ; zéro ombre.
7. Premier lancement : choix serveur présent ; update via Releases seulement.
8. Rapport final : tableau écran → statut → captures ; toute valeur « SOURCED-FROM » listée.

**Si une seule case échoue : corriger avant de livrer. Ne jamais « approximer » une valeur.**

---

*Extrait automatiquement des repos le 2026-10-26 (web `aa74287`, android HEAD) —
MIT © 2026 loxdpsy / Etherealmber.*
