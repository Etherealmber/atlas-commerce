# Desktop shell: pixel reference for sidebar, floating dock, dashboard and widgets, and every wizard

This is the same method as `docs/desktop-login-reference/`. Everything here was **measured from the real
production web bundle** (`src/`, the same CSS that ships to `stock.afmarbre.com`), rendered in headless
Chromium 131 at **1280×800, device-scale 1, DM Sans loaded, reduced motion**. Every box comes from
`getBoundingClientRect()` and every colour from `getComputedStyle()`. Nothing is estimated. The raw dump
for every screenshot is in `measurements.json`, keyed by PNG name without `.png`.

The data is the mocked marble-shop demo: user `amine` (owner), currency MAD, clock 2026-10-20 10:30 UTC.
The text you see is the data, not the layout. The **layout, spacing, sizes, radii, colours, fonts and
states** are the spec.

Coordinates are CSS px, which equal egui points at `pixels_per_point = 1`. The origin is the window's
top-left. The reference window is **1280×800**.

**Out of scope:** the settings / focus-route layout (`/settings*`, with a different sidebar), and the login
(see `docs/desktop-login-reference/`).

---

## 0. Reference images (pixel-compare against these: light AND dark)

| State | Light | Dark |
|---|---|---|
| Dashboard, top (default: sidebar collapsed, dock expanded) | `dashboard-light.png` | `dashboard-dark.png` |
| Dashboard scrolled to y=600 (finance KPIs, FA/VR bars, purchases/salaries) | `dashboard-scroll2-y600-light.png` | `…-dark.png` |
| Dashboard y=1200 (encaissements combo, charges h-bars, donuts) | `dashboard-scroll3-y1200-light.png` | `…-dark.png` |
| Dashboard y=1800 | `dashboard-scroll4-y1800-light.png` | `…-dark.png` |
| Dashboard y=2400 (bottom: presence, next actions, stock health) | `dashboard-scroll5-y2400-light.png` | `…-dark.png` |
| Sidebar hover on an idle item | `sidebar-hover-light.png` | `sidebar-hover-dark.png` |
| Sidebar expanded (280 px) | `sidebar-expanded-light.png` | `sidebar-expanded-dark.png` |
| Dock compact (scrolled down; title only) | `topbar-compact-light.png` | `topbar-compact-dark.png` |
| Notifications popover (bell) | `topbar-notifications-light.png` | `topbar-notifications-dark.png` |
| User menu (avatar) | `topbar-user-menu-light.png` | `topbar-user-menu-dark.png` |
| Every wizard, every step | `wizard-<name>-step<n>-light.png` | `wizard-<name>-step<n>-dark.png` |

The wizards are: `product` (5 steps), `product-edit-history` (3), `stock-adjust` (2), `client` (3), `vendor` (2), `invoice` (3),
`quote` (3), `bill` (3), `receipt` (2), `quick-sale` (3), `refund-wr` (2), `balance-recette` (2),
`balance-depense` (2), `balance-reports-dialog` (1, a dialog rather than a stepper), and `employee` (9, including step 7 « Déclaration CNSS »). That is 88 wizard PNGs.

Dashboard scroll PNGs: the dock is in **compact** mode in these because the page is scrolled. The
full-height document is **2749 px** tall at 1280×800.

## 1. Assets

- Sidebar mark (collapsed): `public/atlas-icon-light.png` (light) / `public/atlas-icon-dark.png` (dark). Draw at **28×28** at (17.5, 16).
- Sidebar lockup (expanded): `public/atlas-logo-light.png` / `public/atlas-logo-dark.png`. Draw at **105×34** at (87, 24).
- Icons: the nav icons are inline SVG paths in `src/App.tsx` (`NavIcon`, stroke **1.85**, 22×22 collapsed /
  18×18 expanded, `stroke-linecap/linejoin: round`, no fill). Copy the exact `d` strings. Everything
  else uses **lucide** icons at the sizes in the tables (e.g. 14/16/17/18). Port the SVG paths; do not substitute another icon set.
- Font: **DM Sans** everywhere, weights 400/500/600/700/750/800. Use tabular numerals for counts, KPI values and money.

## 2. Behaviour (this must match exactly, not just the pixels)

### Sidebar
- **Collapsed by default** (64 px rail). The state is persisted in `localStorage['atlas-sidebar-collapsed']` (`'1'` collapsed,
  `'0'` expanded; unset means collapsed). On desktop, persist it in your settings store.
- **Double-click the logo block** to toggle collapsed / expanded. There is no other toggle in the dock.
- Collapsed: icons only, centred, a **44×44** hit box, rows on a 48 px pitch starting at y=65. A tooltip shows the label (`data-tooltip`).
- Expanded: **280 px**, uppercase section labels, 231×40 rows, label at x=62. The list **scrolls inside the
  sidebar** when it is taller than the window (at 800 px the last items are below the fold). The window never scrolls with it.
- Active row: a **3 px inset bar on the left** (`box-shadow: inset 3px 0 0 #fafafa`) plus the active bg/colour from the tables.
- Nav order (section → label → route). Render exactly these, with permission-gated ones hidden when not allowed:
  - **Vue d'ensemble**: Tableau de bord `/dashboard`
  - **Catalogue**: Produits & stock `/products`
  - **Relation client**: Clients `/clients`
  - **Équipe**: Employés `/employees` · Présence `/attendance` · Devis `/quotes` · Vente rapide `/quick-sale` · Factures de vente `/invoices` · Remboursements `/reimbursements` · Reçus `/receipts`
  - **Achats**: Fournisseurs `/vendors` · Factures d'achat `/bills`
  - **Finance**: Solde & recettes `/balance` · Clôtures de caisse `/cash-shifts` · Paie CNSS / AMO `/payroll` · Rapports & clôture `/reports` · Ops stock `/inventory-ops`
- **No count badges in the sidebar.** `.nav-count` is `display:none !important` on web. The legacy
  collapsed-alerts strip (`.atlas-collapsed-alerts`) is also `display:none`. Do not draw either.
- Content column starts at **x = 72** collapsed (64 rail + 8) and **x = 288** expanded. The page container adds its own padding (content x = 108 collapsed).

### Floating dock (top bar)
- A centred pill over the content column (`.ac-desktop-top-row` spans x=72…1280, y=10, h=58). The **dock is centred in that row**, not in the window.
  - Expanded: 324.4×58 at (513.8, 10) collapsed-sidebar / (617.8, 10) expanded-sidebar.
- Contents, left → right: the **page title** (a button, `text-transform: capitalize`, so "Tableau de bord" renders **"Tableau De Bord"**; keep it), then the theme toggle (moon in light / sun in dark), then the bell with the red badge, then the avatar button.
- The **bell badge equals the popover header count** (badge kinds + extra alerts such as cheques due). Cap the display at 99.
- **Compact mode** (title only, 176.4 wide), from `App.tsx`:
  - Collapse to compact when scrollY > 140 **and** the user has scrolled ≥ 48 px further down since the last change.
  - Expand again after ≥ 48 px of upward scroll, or immediately when scrollY ≤ 60.
  - Clicking the title in compact mode expands the dock (it ignores scroll for 400 ms).
- Dark dock: `rgba(20,20,23,.88)` + `backdrop-filter: blur(16px) saturate(1.15)`. In egui, use a solid `#141417` fill if you have no blur.
- Popovers (notifications 336 wide, user menu 296 wide) open **8–10 px under the dock**, right-aligned to their trigger group. They close on a click on the transparent full-window backdrop, on a second click on the trigger, or when the other popover opens (bell and avatar are mutually exclusive). Web has **no** Esc handler for these; adding Esc on desktop is fine.
- Assistant FAB: 56×56, radius 18, bottom-right at (1204, 724). It is always visible on these pages.

### Wizards (FormWizard kit)
- A modal over a `rgba(10,10,12,.55)` + `blur(8px)` overlay (the same in both themes).
- Widths: **wide = 1120** (x=80) for product, product-edit-history, invoice, quote, bill, quick-sale and employee. **Normal = 880** (x=200) for client, vendor, receipt, refund-wr, balance-recette, balance-depense and stock-adjust. **Dialog = 700** (x=290) for balance-reports-dialog.
- Height is content-driven, **vertically centred**, max **752** (24 px window margin). When the content is taller, **the body scrolls and the header and footer stay pinned** (product step 2/3 shows this).
- Header: eyebrow (uppercase) → h2 title → the counter "n / N" on the right. The counter sits **48 px clear of the close X** (fixed in this PR; it used to sit under the X).
- Step pills under the header: complete = ✓ circle, current = filled number circle, upcoming = outline number. Clickable = any step ≤ the furthest step reached, **plus the next step** (the forward jump runs the same validation as Continuer). Anything further is `is-locked`: disabled, with the tooltip “Complétez les étapes précédentes avant d’y accéder”. The PNGs were captured with all steps unlocked so every step could be shown.
- Footer: a 4 px progress bar, then the chip "Étape n / N · <label>" plus the wizard name on the left, then the buttons on the right: `Annuler` (secondary), `Retour` (secondary, hidden on step 1), and the primary `Continuer` / final action (e.g. `Créer le client`, `Enregistrer`, `Enregistrer les modifications`).
- Close X: 34×34 at the modal's top-right (x = modal right − 47, y = modal top + 13).
- Required empty fields show the **warn input** (`input-warn`) plus the hint "Obligatoire" (see the form-field table).
- **Employee step 7, « Déclaration CNSS »:** two radio cards (Déclaré / Non déclaré, 2 columns, radius 14, selected = 1 px ink ring plus dot). When declared, a days panel appears: a number input 0–26 in half-day steps, chips 26 j « Mois complet » / 22 j / 13 j « Mi-temps », and a 6 px green meter. Below it are a blue info note and, if the CNSS number is empty, an amber warning that links back to the « Social & fiscal » step. Sent as `cnss_declared` (0/1) and `cnss_days` (0 when not declared).

---

## 3. Measured tables

Format: `bg` background · `text` colour · `border` width + colour (or per side) · `radius` · `shadow` (x y blur spread) · `font` size/weight, line-height, letter-spacing · `pad` T/R/B/L · `gap`.

### 3.1 Shell

#### Sidebar — collapsed rail (default)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Sidebar | 0,0 64×800 | bg #ffffff; text #0f172a; border-R 1 #e8eaef; font 16/400 lh24; pad 12/0/12/0 | bg #111113; text #e8eaf0; border-R 1 #2a2a2e; font 16/400 lh24; pad 12/0/12/0 |
| Logo block | 0,12 63×43 | text #0f172a; border-B 1 #e8eaef; font 16/400 lh24; pad 4/0/10/0; gap 4 | text #0f172a; border-B 1 rgba(255,255,255,0.08); font 16/400 lh24; pad 4/0/10/0; gap 4 |
| Logo mark img | 17.5,16 28×28 | text #0f172a; font 16/400 lh24 | text #0f172a; font 16/400 lh24 |
| Nav item — ACTIVE (Tableau de bord) | 9.5,65 44×44 | bg rgba(255,255,255,0.1); text #0f172a; radius 12; shadow #fafafa 3 0 0 0 inset; font 14/600 lh21; gap 8 | bg #202024; text #e4e7ef; border 1 rgba(255,255,255,0.09); radius 10; shadow #fafafa 3 0 0 0 inset; font 14/600 lh21; gap 8 |
| Nav icon (active) | 20.5,76 22×22 | text #0f172a; font 14/600 lh21; stroke #0f172a w1.85 | text #e4e4e7; font 14/600 lh21; stroke #e4e4e7 w1.85 |
| Nav item — idle (#2 Produits) | 9.5,113 44×44 | text #475569; radius 12; font 14/600 lh21; gap 8 | text #9ba0ae; radius 10; font 14/600 lh21; gap 8 |
| Nav icon (idle) | 20.5,124 22×22 | text #475569; font 14/600 lh21; stroke #475569 w1.85 | text #aeb6c9; font 14/600 lh21; stroke #aeb6c9 w1.85 |

> **Light-mode active/hover reads as nearly no fill.** The computed fills are white at 10% / 6% on a white rail, and the inset bar is `#fafafa`. The visible cue is the icon/text colour (`#0f172a` active vs `#475569` idle) plus the faint rounded tile in `dashboard-light.png` / `sidebar-hover-light.png` (painted by a pseudo-element, so it is not in the dump). Match the PNG pixels for that tile. Do **not** invent a stronger highlight.

#### Sidebar — hover on an idle item (Produits)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Hovered item | 9.5,113 44×44 | bg rgba(255,255,255,0.06); text #0f172a; radius 12; font 14/600 lh21; gap 8 | bg rgba(255,255,255,0.055); text #e4e7ef; radius 10; font 14/600 lh21; gap 8 |

#### Sidebar — expanded (double-click logo; persisted in atlas-sidebar-collapsed=0)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Sidebar | 0,0 280×800 | bg #ffffff; text #0f172a; border-R 1 #e8eaef; font 16/400 lh24; pad 16/12/16/12 | bg #111113; text #e8eaf0; border-R 1 #2a2a2e; font 16/400 lh24; pad 16/12/16/12 |
| Logo block | 12,16 255×83.8 | text #0f172a; border-B 1 #e8eaef; font 16/400 lh24; pad 8/10/16/10; gap 8 | text #0f172a; border-B 1 rgba(255,255,255,0.08); font 16/400 lh24; pad 8/10/16/10; gap 8 |
| Lockup img | 87,24 105×34 | text #0f172a; font 16/400 lh24 | text #0f172a; font 16/400 lh24 |
| Logo sub “STOCK & FACTURATION” “Stock & facturation” | 68,66 143×16.8 | text #64748b; font 11.2/600 lh16.8 ls0.896 UPPER | text #8b93a7; font 11.2/600 lh16.8 ls0.896 UPPER |
| Section label #1 “Vue d'ensemble” | 28,115.8 223×15 | text #94a3b8; font 10/700 lh15 ls0.6 UPPER; pad 0/12/0/12 | text #94a3b8; font 10/700 lh15 ls0.6 UPPER; pad 0/12/0/12 |
| Section label #2 “Catalogue” | 28,196.8 223×15 | text #94a3b8; font 10/700 lh15 ls0.6 UPPER; pad 0/12/0/12 | text #94a3b8; font 10/700 lh15 ls0.6 UPPER; pad 0/12/0/12 |
| Nav item ACTIVE | 24,138.8 231×40 | bg rgba(255,255,255,0.1); text #0f172a; radius 10; shadow #fafafa 3 0 0 0 inset; font 14/600 lh21; pad 9/10/9/10; gap 8 | bg #202024; text #e4e7ef; border 1 rgba(255,255,255,0.09); radius 10; shadow #fafafa 3 0 0 0 inset; font 14/600 lh21; pad 9/10/9/10; gap 8 |
| Nav icon | 34,149.8 18×18 | text #0f172a; font 14/600 lh21; stroke #0f172a w1.85 | text #e4e4e7; font 14/600 lh21; stroke #e4e4e7 w1.85 |
| Nav label (active) “Tableau de bord” | 62,148.3 108.6×21 | text #0f172a; font 14/600 lh21 | text #d4d4d8; font 14/600 lh21 |
| Nav item idle #2 | 24,219.8 231×40 | text #475569; radius 10; font 14/600 lh21; pad 9/10/9/10; gap 8 | text #9ba0ae; radius 10; font 14/600 lh21; pad 9/10/9/10; gap 8 |
| Nav label idle “Produits & stock” | 62,229.3 111.7×21 | text #475569; font 14/600 lh21 | text #d4d4d8; font 14/600 lh21 |
| Top dock (shifts right with sidebar) | 617.8,10 324.4×58 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 999; shadow rgba(0,0,0,0.07) 0 8 24 0; font 16/400 lh24; pad 6/10/6/10; gap 12 | bg rgba(20,20,23,0.88); text #f4f4f5; border 1 rgba(255,255,255,0.08); radius 999; shadow rgba(0,0,0,0.45) 0 12 32 0; font 16/400 lh24; pad 6/10/6/10; gap 12; backdrop blur(16px) saturate(1.15) |

#### Floating top dock (expanded, scrollY ≤ 60)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Top row container | 72,10 1208×58 | text #0f172a; font 16/400 lh24 | text #dfe2ea; font 16/400 lh24 |
| Dock | 513.8,10 324.4×58 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 999; shadow rgba(0,0,0,0.07) 0 8 24 0; font 16/400 lh24; pad 6/10/6/10; gap 12 | bg rgba(20,20,23,0.88); text #f4f4f5; border 1 rgba(255,255,255,0.08); radius 999; shadow rgba(0,0,0,0.45) 0 12 32 0; font 16/400 lh24; pad 6/10/6/10; gap 12; backdrop blur(16px) saturate(1.15) |
| Dock left | 524.8,17 154.4×44 | text #0f172a; font 16/400 lh24; gap 8 | text #f4f4f5; font 16/400 lh24; gap 8 |
| Page title button “Tableau de bord” | 524.8,17 154.4×44 | text #0f172a; radius 999; font 14.4/600 lh21.6 ls0.144; pad 0/20/0/20; gap 8 | text #f4f4f6; radius 999; font 14.4/600 lh21.6 ls0.144; pad 0/20/0/20; gap 8 |
| Dock right group | 691.2,19 136×40 | text #0f172a; font 16/400 lh24; gap 8 | text #f4f4f5; font 16/400 lh24; gap 8 |
| Theme toggle | 691.2,19 40×40 | bg #ffffff; text #3f3f46; border 1 #d4d4d8; radius 999; shadow rgba(24,24,27,0.06) 0 1 2 0; font 14.4/500 lh21.6 ls0.144; gap 8 | bg #202024; text #dfe2ea; border 1 rgba(255,255,255,0.1); radius 999; font 14.4/500 lh21.6 ls0.144; gap 8 |
| Bell | 739.2,19 40×40 | bg rgba(255,255,255,0.25); text #0f172a; border 1 #d6d0c6; radius 999; font 14.4/500 lh21.6 ls0.144; gap 8 | bg #202024; text #dfe2ea; border 1 rgba(255,255,255,0.1); radius 999; font 14.4/500 lh21.6 ls0.144; gap 8 |
| Bell badge “16” “17” | 752.5,24 21.7×16 | bg #ef4444; text #ffffff; border 2 #ffffff; radius 999; font 10/800 lh10 ls0.144; pad 0/4/0/4 | bg #ef4444; text #ffffff; border 2 #18181b; radius 999; font 10/800 lh10 ls0.144; pad 0/4/0/4 |
| User button | 787.2,19 40×40 | text #0f172a; border 1 rgba(15,23,42,0.12); radius 999; font 14.4/600 lh14.4 ls0.144; gap 8 | bg #3f3f46; text #f4f4f5; border 1 #52525b; radius 999; font 14.4/600 lh14.4 ls0.144; gap 8 |
| Avatar initials “A” | 788.2,20 38×38 | bg #e2e8f0; text #0f172a; radius 999; font 12.48/750 lh12.48 ls0.144 | bg #27272a; text #f4f4f5; radius 999; font 12.48/750 lh12.48 ls0.144 |
| Assistant FAB (bottom-right) | 1204,724 56×56 | bgimg linear-gradient(145deg, #1c1c1e, #0a0a0a); text #fafafa; border 1 rgba(255,255,255,0.1); radius 18; shadow rgba(0,0,0,0.28) 0 12 32 0; font 14.4/600 lh21.6 ls0.144; pad 10/18/10/18; gap 8 | bg #3f3f46; text #f4f4f5; border 1 #52525b; radius 18; shadow rgba(0,0,0,0.28) 0 12 32 0; font 14.4/600 lh21.6 ls0.144; pad 10/18/10/18; gap 8 |
| Content column | 72,74 1208×2674.8 | bg #f4f5f7; text #0a0a0a; font 13/400 lh19.5; pad 20/24/48/20 | bg #121215; text #dfe2ea; font 13/400 lh19.5; pad 20/24/48/20 |
| Page container | 92,94 1164×2606.8 | text #0a0a0a; font 13/400 lh19.5; pad 0/16/32/16 | bg #121215; text #f4f4f5; font 13/400 lh19.5; pad 0/16/32/16 |

#### Top dock — compact (after scrolling down > 140px, 48px of downward travel)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Dock (compact) | 587.8,10 176.4×58 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 999; shadow rgba(0,0,0,0.07) 0 8 24 0; font 16/400 lh24; pad 6/10/6/10; gap 12 | bg rgba(20,20,23,0.88); text #f4f4f5; border 1 rgba(255,255,255,0.08); radius 999; shadow rgba(0,0,0,0.45) 0 12 32 0; font 16/400 lh24; pad 6/10/6/10; gap 12; backdrop blur(16px) saturate(1.15) |
| Title only “Tableau de bord” | 598.8,17 154.4×44 | text #0f172a; radius 999; font 14.4/600 lh21.6 ls0.144; pad 0/20/0/20; gap 8 | text #f4f4f6; radius 999; font 14.4/600 lh21.6 ls0.144; pad 0/20/0/20; gap 8 |

#### Notifications panel (bell click)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Panel | 443.2,67 336×376.6 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.12) 0 16 48 0; font 16/400 lh24 | bg #18181b; text #dfe2ea; border 1 rgba(255,255,255,0.1); radius 14; shadow rgba(255,255,255,0.04) 0 1 0 0 inset, rgba(0,0,0,0.6) 0 24 56 0; font 16/400 lh24 |
| Header | 444.2,68 334×46.6 | bg #fafafa; text #0f172a; border-B 1 #eceef2; font 16/400 lh24; pad 12/14/12/14 | text #e4e4e7; border-B 1 rgba(255,255,255,0.08); font 16/400 lh24; pad 12/14/12/14 |
| Title “Notifications” | 458.2,80 306×21.6 | text #0f172a; font 16/400 lh24; gap 8 | text #f4f4f5; font 16/400 lh24; gap 8 |
| Count pill “17 alertes” | 694.1,80.2 70×21.3 | bg color(srgb 0.85098 0.466667 0.0235294 / 0.14); text #d97706; radius 999; font 11.52/600 lh17.28; pad 2/9/2/9 | bg rgba(251,191,36,0.16); text #fde68a; radius 999; font 11.52/600 lh17.28; pad 2/9/2/9 |
| List | 444.2,114.6 334×285.5 | text #0f172a; font 16/400 lh24; pad 6/6/6/6; gap 2 | text #f4f4f5; font 16/400 lh24; pad 6/6/6/6; gap 2 |
| Item #1 | 450.2,120.6 322×53.1 | text #0f172a; radius 10; font 14.4/600 lh21.6 ls0.144; pad 9/10/9/10; gap 10 | text #f4f4f5; radius 10; font 14.4/600 lh21.6 ls0.144; pad 9/10/9/10; gap 10 |
| Item icon tile (warn) | 460.2,131.2 32×32 | bg rgba(217,119,6,0.12); text #b45309; radius 9; font 14.4/600 lh21.6 ls0.144 | bg rgba(251,191,36,0.16); text #fde68a; radius 9; font 14.4/600 lh21.6 ls0.144 |
| Item icon tile (danger) | 460.2,186.3 32×32 | bg rgba(220,38,38,0.12); text #b91c1c; radius 9; font 14.4/600 lh21.6 ls0.144 | bg rgba(248,113,113,0.16); text #fca5a5; radius 9; font 14.4/600 lh21.6 ls0.144 |
| Item title “Notifications” | 458.2,80 90.5×21.6 | text #0f172a; font 14.4/700 lh21.6 | text #f4f4f5; font 14.4/700 lh21.6 |
| Item subtitle | — | — | — |
| Chevron | 748.2,140.2 14×14 | text #64748b; font 14.4/600 lh21.6 ls0.144; opacity 0.7; stroke #64748b w2 | text #a1a1aa; font 14.4/600 lh21.6 ls0.144; opacity 0.7; stroke #a1a1aa w2 |
| Footer “Voir la boîte d’actions” | 444.2,400.1 334×42.5 | bg #fafafa; text #0f172a; border-T 1 #eceef2; radius 999; font 13/600 lh19.5 ls0.13; pad 11/14/11/14; gap 6 | text #f4f4f5; border-T 1 rgba(255,255,255,0.08); font 13/600 lh19.5 ls0.13; pad 11/14/11/14; gap 8 |

#### User menu (avatar click)

| Element | Box @1280×800 (x,y w×h) | Light | Dark |
|---|---|---|---|
| Dropdown | 542.2,78 296×402 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 22; shadow rgba(15,23,42,0.13) 0 18 46 0, rgba(15,23,42,0.05) 0 2 6 0; font 16/400 lh24; pad 8/8/8/8 | bg #18181b; text #f4f4f5; border 1 rgba(255,255,255,0.1); radius 22; shadow rgba(0,0,0,0.58) 0 22 54 0, rgba(255,255,255,0.05) 0 1 0 0 inset; font 16/400 lh24; pad 8/8/8/8 |
| Identity card | 551.2,87 278×81.1 | bg #f8fafc; text #0f172a; border 1 rgba(15,23,42,0.06); radius 15; font 16/400 lh24; pad 11/12/11/12 | bg #202024; text #f4f4f5; border 1 rgba(255,255,255,0.08); radius 15; font 16/400 lh24; pad 11/12/11/12 |
| Avatar in card | 564.2,99 252×57.1 | text #0f172a; font 16/400 lh24; gap 11 | text #f4f4f5; font 16/400 lh24; gap 11 |
| “Bonjour” “Bonjour” | 611.2,99 42.7×12.6 | text #64748b; font 11/600 lh12.65 ls0.22 | text #a1a1aa; font 11/600 lh12.65 ls0.22 |
| Name “Amine” | 611.2,112.6 45.6×18.1 | text #0f172a; font 14.5/700 lh18.125 | text #fafafa; font 14.5/700 lh18.125 |
| Role pill “Propriétaire” | 611.2,135.8 81.7×20.3 | bg #ffffff; text #475569; border 1 #e2e8f0; radius 999; font 11/600 lh14.3; pad 2/8/2/8 | bg #27272a; text #d4d4d8; border 1 rgba(255,255,255,0.1); radius 999; font 11/600 lh14.3; pad 2/8/2/8 |
| List | 551.2,174.1 278×296.9 | text #0f172a; font 16/400 lh24; gap 2 | text #f4f4f5; font 16/400 lh24; gap 2 |
| Item “Ajouter un compte” | 551.2,174.1 278×62.9 | text #0f172a; border 1 rgba(0,0,0,0); radius 14; font 14.4/600 lh21.6 ls0.144; pad 7/10/7/10; gap 8 10 | text #e4e4e7; border 1 rgba(0,0,0,0); radius 14; font 14.4/600 lh21.6 ls0.144; pad 7/10/7/10; gap 8 10 |
| Item icon circle | 562.2,188.5 34×34 | bg #f1f5f9; text #334155; border 1 rgba(15,23,42,0.06); radius 999; font 14.4/600 lh21.6 ls0.144; gap 1 | bg #202024; text #d4d4d8; border 1 rgba(255,255,255,0.08); radius 999; font 14.4/600 lh21.6 ls0.144; gap 1 |
| Separator | 559.2,244 262×1 | bg #eef0f4; text #0f172a; font 16/400 lh24 | bg rgba(255,255,255,0.08); text #f4f4f5; font 16/400 lh24 |
| Danger item “Déconnexion” | 551.2,421 278×50 | text #0f172a; border 1 rgba(0,0,0,0); radius 14; font 14.4/600 lh21.6 ls0.144; pad 7/10/7/10; gap 8 10 | text #e4e4e7; border 1 rgba(0,0,0,0); radius 14; font 14.4/600 lh21.6 ls0.144; pad 7/10/7/10; gap 8 10 |

### 3.2 Dashboard and widgets

#### Dashboard — page & hero

Boxes in this section and the next are **document coordinates** (scrollY = 0). Viewport 1280×800, collapsed sidebar, so content x starts at 108.

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| Page | 92,94 1164×2606.8 | text #0a0a0a; font 13/400 lh19.5; pad 0/16/32/16 | bg #121215; text #f4f4f5; font 13/400 lh19.5; pad 0/16/32/16 |
| Hero | 108,94 1132×75 | text #0a0a0a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |
| Eyebrow (date · TZ) “MARDI 20 OCTOBRE · UTC” | 108,97 158.4×14 | text #0a0a0a; font 11.2/700 lh14 ls0.896 UPPER; gap 6 | text #b4b9c6; font 11.2/700 lh14 ls0.896 UPPER; gap 6 |
| Hero row | 108,117 1132×52 | text #0a0a0a; font 13/400 lh19.5; gap 12 20 | text #f4f4f5; font 13/400 lh19.5; gap 12 20 |
| Greeting h1 “Bonjour, amine .” | 108,117 479×24 | text #0f172a; font 20/800 lh24 ls-0.6 | text #f5f6fa; font 20/800 lh24 ls-0.6 |
| Lead “Surface de vente synchronisée — voici ce” | 108,147 479×22 | text #0a0a0a; font 15.2/400 lh22.04 | text #b4b9c6; font 15.2/400 lh22.04 |
| Hero controls | 710.8,123.4 529.2×45.6 | text #0a0a0a; font 13/400 lh19.5; gap 10 | text #f4f4f5; font 13/400 lh19.5; gap 10 |
| Period pills track | 710.8,125.9 262.6×40.7 | bg #ffffff; text #0a0a0a; border 1 #e8eaef; radius 999; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 4/4/4/4; gap 2 | bg #1c1c21; text #f4f4f5; border 1 #2e2e36; radius 999; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 4/4/4/4; gap 2 |
| Pill idle “7j” “7j” | 715.8,130.9 34.4×30.7 | text #64748b; radius 999; font 12.48/700 lh18.72 ls0.1248; pad 6/12/6/12; gap 8 | text #a1a1aa; radius 999; font 12.48/700 lh18.72 ls0.1248; pad 6/12/6/12; gap 8 |
| Pill ACTIVE “6m” (aria-pressed) “6m” | 794.8,130.9 43.9×30.7 | bg #0f172a; text #ffffff; radius 999; font 12.48/700 lh18.72 ls0.1248; pad 6/12/6/12; gap 8 | bg #f4f4f5; text #0f172a; radius 999; shadow rgba(0,0,0,0.35) 0 2 10 0; font 12.48/700 lh18.72 ls0.1248; pad 6/12/6/12; gap 8 |
| Date-range trigger | 983.4,123.4 256.6×45.6 | bg #ffffff; text #27272a; border 1 #d4d4d8; radius 12; font 14.4/600 lh21.6; pad 11/20/11/20; gap 8 | bg #22252e; text #dfe2ea; border 1 rgba(255,255,255,0.11); radius 12; font 14.4/600 lh21.6; pad 11/20/11/20; gap 8 |
| Date-range value “01 mai 2026 — 20 oct. 2026” | 1004.4,135.4 190.6×21.6 | text #27272a; font 14.4/600 lh21.6 | text #dfe2ea; font 14.4/600 lh21.6 |
| Date-range icon | 1203,138.2 16×16 | text #27272a; font 14.4/600 lh21.6; opacity 0.5 | text #a1a1aa; font 14.4/600 lh21.6; opacity 0.5 |

#### Dashboard — KPI rows (ac-metric)

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| KPI grid #1 | 108,189 1132×99.6 | text #0a0a0a; font 13/400 lh19.5; gap 12 | text #f4f4f5; font 13/400 lh19.5; gap 12 |
| KPI card “Produits” | 108,189 274×99.6 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/18/16/18; gap 6 | bg #18181b; text #dfe2ea; border 1 rgba(255,255,255,0.075); radius 16; shadow rgba(255,255,255,0.03) 0 1 0 0 inset, rgba(0,0,0,0.22) 0 1 3 0; font 13/400 lh19.5; pad 16/18/16/18; gap 6 |
| KPI card warn “Stock bas” | 394,189 274×99.6 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/18/16/18; gap 6 | bg #18181b; text #dfe2ea; border 1 rgba(255,255,255,0.075); radius 16; shadow rgba(255,255,255,0.03) 0 1 0 0 inset, rgba(0,0,0,0.22) 0 1 3 0; font 13/400 lh19.5; pad 16/18/16/18; gap 6 |
| KPI label row “Produits” | 127,206 236×18 | text #64748b; font 12/600 lh18 ls0.48 UPPER; gap 6 | text #8a909e; font 12/600 lh18 ls0.48 UPPER; gap 6 |
| KPI icon | 127,207 16×16 | text #0a0a0a; font 12/600 lh18 ls0.48 UPPER; opacity 0.85; stroke #0a0a0a w2 | text #a1a1aa; font 12/600 lh18 ls0.48 UPPER; opacity 0.85; stroke #a1a1aa w2 |
| KPI value “10” | 127,244 236×27.6 | text #0f172a; font 24/700 lh27.6 ls-0.48 | text #e4e7ef; font 24/700 lh27.6 ls-0.48 |
| KPI grid #2 (finance) | 108,842.7 1132×99.6 | text #0a0a0a; font 13/400 lh19.5; gap 12 | text #f4f4f5; font 13/400 lh19.5; gap 12 |

#### Dashboard — “Que faire ensuite ?” strip

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| Strip | 108,304.6 1132×110.5 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/18/16/18; gap 12 18 | bg #1c1c1f; text #f4f4f5; border 1 #2a2a2e; radius 16; font 13/400 lh19.5; pad 16/18/16/18; gap 12 18 |
| Head | 127,348.9 157.7×22 | text #0f172a; font 14/400 lh21; gap 8 | text #dfe2ea; font 14/400 lh21; gap 8 |
| Count badge “3” | 127,348.9 22×22 | bg color(srgb 0.145098 0.388235 0.921569 / 0.14); text #2563eb; radius 999; font 12/800 lh18; pad 0/7/0/7 | bg color(srgb 0.145098 0.388235 0.921569 / 0.14); text #2563eb; radius 999; font 12/800 lh18; pad 0/7/0/7 |
| Items column | 302.7,321.6 918.3×76.5 | text #0f172a; font 13/400 lh19.5; gap 8 18 | text #f4f4f5; font 13/400 lh19.5; gap 8 18 |
| Item | 302.7,321.6 535.2×20.2 | text #0f172a; font 13.44/400 lh20.16; gap 10 | text #f4f4f5; font 13.44/400 lh20.16; gap 10 |
| Item text | 302.7,321.6 469.6×20.2 | text #0f172a; font 13.44/400 lh20.16; gap 6 | text #f4f4f5; font 13.44/400 lh20.16; gap 6 |
| Link “Ouvrir →” “Ouvrir →” | 782.4,321.6 55.6×20.2 | text #0a0a0a; font 13.44/700 lh20.16; opacity 0.7 | text #a1a1aa; font 13.44/700 lh20.16; opacity 0.7 |

#### Dashboard — chart panels

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| Primary grid (cashflow + profit) | 108,429.1 1132×399.6 | text #0a0a0a; font 13/400 lh19.5; gap 14 | text #f4f4f5; font 13/400 lh19.5; gap 14 |
| Cashflow panel | 108,429.1 696.1×399.6 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/18/16/18 | bg #1c1c1f; text #f4f4f5; border 1 #2a2a2e; radius 16; font 13/400 lh19.5; pad 16/18/16/18 |
| Panel head | 127,446.1 658.1×55.6 | text #0f172a; font 13/400 lh19.5; gap 10 14 | text #f4f4f5; font 13/400 lh19.5; gap 10 14 |
| Stat pair box (Entrées/Sorties/Net) | 431,446.1 354.1×55.6 | bg #f4f5f7; text #0f172a; border 1 #e8eaef; radius 12; font 13/400 lh19.5 | bg #18181b; text #dfe2ea; border 1 rgba(255,255,255,0.08); radius 12; shadow rgba(255,255,255,0.03) 0 1 0 0 inset, rgba(0,0,0,0.22) 0 1 3 0; font 13/400 lh19.5 |
| Stat label “ENTRÉES” | 444,454.1 90.7×15 | text #64748b; font 10/700 lh15 ls0.6 | text #9aa3b5; font 10/700 lh15 ls0.6 |
| Chart wrap | 127,513.7 658.1×298 | text #0f172a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |
| Legend | 127,513.7 133.7×18 | text #0f172a; font 13/400 lh19.5; gap 12 16 | text #f4f4f5; font 13/400 lh19.5; gap 12 16 |
| Legend item “Entrées” | 127,513.7 60.6×18 | text #71717a; font 12/600 lh18; gap 6 | text #71717a; font 12/600 lh18; gap 6 |
| Canvas shell | 127,541.7 658.1×270 | text #0f172a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |
| Area chart | 127,541.7 658.1×270 | text #0f172a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |
| Profit panel | 818.1,429.1 421.9×399.6 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/18/16/18 | bg #1c1c1f; text #f4f4f5; border 1 #2a2a2e; radius 16; font 13/400 lh19.5; pad 16/18/16/18 |
| Net pill (+) “+ 173 150 MAD” | 1116.5,446.1 104.5×29.2 | bg color(srgb 0.0627451 0.72549 0.505882 / 0.14); text #059669; radius 999; font 12.8/750 lh19.2; pad 5/11/5/11 | bg rgba(16,185,129,0.12); text #4ade80; radius 999; font 12.8/750 lh19.2; pad 5/11/5/11 |
| Charts grid (4) | 108,956.3 1132×698.7 | text #0a0a0a; font 13/400 lh19.5; gap 14 | text #f4f4f5; font 13/400 lh19.5; gap 14 |
| Bar chart (FA vs VR) | 127,1055.8 521×215 | text #0f172a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |

#### Dashboard — horizontal bars, donuts, presence, lists

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| HBar list | 700,1373.3 521×264.6 | text #0f172a; font 13/400 lh19.5; pad 4/0/0/0; gap 11 | text #f4f4f5; font 13/400 lh19.5; pad 4/0/0/0; gap 11 |
| HBar row | 700,1377.3 521×34.3 | text #0f172a; font 13/400 lh19.5; gap 5 | text #f4f4f5; font 13/400 lh19.5; gap 5 |
| HBar label “Salaires” | 700,1377.3 48.4×19.2 | text #0f172a; font 12.8/600 lh19.2 | text #f4f4f5; font 12.8/600 lh19.2 |
| HBar value | 1117.3,1377.3 103.7×19.3 | text #0f172a; font 12.8/700 lh19.2; gap 7 | text #dfe2ea; font 12.8/700 lh19.2; gap 7 |
| HBar track | 700,1401.6 521×10 | bg #e8eaef; text #0f172a; radius 6; font 13/400 lh19.5 | bg rgba(255,255,255,0.09); text #f4f4f5; radius 6; font 13/400 lh19.5 |
| HBar fill | 700,1401.6 314.6×10 | bg #d4d4d4; text #0f172a; radius 6; font 13/400 lh19.5 | bg #d4d4d4; text #f4f4f5; radius 6; font 13/400 lh19.5 |
| Donut row | 108,1668.9 1132×416.3 | text #0a0a0a; font 13/400 lh19.5; gap 12 | text #f4f4f5; font 13/400 lh19.5; gap 12 |
| Donut card | 108,1668.9 267.1×416.3 | bg #ffffff; text #0a0a0a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/16/16/16; gap 8 | bg #18181b; text #dfe2ea; border 1 rgba(255,255,255,0.075); radius 16; shadow rgba(255,255,255,0.03) 0 1 0 0 inset, rgba(0,0,0,0.22) 0 1 3 0; font 13/400 lh19.5; pad 16/16/16/16; gap 8 |
| Donut subtitle “Crédit ouvert vs en retard” | 125,1711 143.8×18 | text #64748b; font 12/400 lh18 | text #a1a1aa; font 12/400 lh18 |
| Donut | 125,1741 233.1×236.5 | text #0a0a0a; font 13/400 lh19.5; pad 8/0/4/0; gap 16 | text #dfe2ea; font 13/400 lh19.5; pad 8/0/4/0; gap 16 |
| Donut ring | 165.5,1749 152×152 | text #0a0a0a; font 13/400 lh19.5 | text #dfe2ea; font 13/400 lh19.5 |
| Donut centre | 165.5,1749 152×152 | text #0a0a0a; font 13/400 lh19.5 | text #dfe2ea; font 13/400 lh19.5 |
| Donut legend | 125,1917 233.1×56.5 | text #0a0a0a; font 13/400 lh19.5; pad 0/2/0/2; gap 4 | text #dfe2ea; font 13/400 lh19.5; pad 0/2/0/2; gap 4 |
| Legend left | 135,1921 53.8×18.2 | text #64748b; font 12.16/400 lh18.24; gap 7 | text #a1a1aa; font 12.16/400 lh18.24; gap 7 |
| Legend value “7 MAD · 70%” | 275.8,1921 72.3×18.2 | text #0f172a; font 12.16/700 lh18.24 | text #a1a1aa; font 12.16/700 lh18.24 |
| Presence panel | 108,2099.2 1132×200 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 16; shadow rgba(15,23,42,0.04) 0 1 2 0; font 13/400 lh19.5; pad 16/18/16/18 | bg #1c1c1f; text #f4f4f5; border 1 #2a2a2e; radius 16; font 13/400 lh19.5; pad 16/18/16/18 |
| Presence selects | 922,2116.2 179×44 | bg rgba(255,255,255,0.35); text #0f172a; border 1 #e8eaef; radius 10; font 15.2/600; pad 0/32/0/12 | bg #18181b; text #e4e4e7; border 1 #3f3f46; radius 10; font 15.2/600; pad 0/32/0/12 |
| Lists split (actions / stock) | 108,2313.2 1132×341.5 | text #0a0a0a; font 13/400 lh19.5; gap 14 | text #f4f4f5; font 13/400 lh19.5; gap 14 |
| List row | 127,2384.8 604.3×60 | text #0f172a; border-B 1 #e8eaef; font 13/400 lh19.5; pad 10/0/10/0; gap 12 | text #f4f4f5; border-B 1 rgba(255,255,255,0.08); font 13/400 lh19.5; pad 10/0/10/0; gap 12 |
| Row avatar “ST” | 127,2404.5 14.6×19.5 | text #0f172a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |
| Row title “Entrée stock — Granit noir Zimbabwe” | 153.6,2394.8 223.7×19.5 | text #0f172a; font 13/400 lh19.5 | text #e8eef6; font 13/400 lh19.5 |
| Row sub “stock_in · 2026-10-20 08:12” | 153.6,2414.3 223.7×19.5 | text #0f172a; font 13/400 lh19.5 | text #94a3b8; font 13/400 lh19.5 |
| Row right (bad) “6” | 985.1,2394.8 38.6×39 | text #0f172a; font 13/400 lh19.5 | text #f4f4f5; font 13/400 lh19.5 |


### 3.3 Wizards

The employee wizard uses `employee-wizard__*` class names but has **identical geometry** to this kit (header 73.2 tall, pills 56, counter at x≈1075.5).

#### Wizard kit — shared chrome (reference: invoice step 2/3)

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| Overlay | 0,0 1280×800 | bg rgba(10,10,12,0.55); text #0a0a0a; font 16/400 lh24; backdrop blur(8px) | bg rgba(10,10,12,0.55); text #e4e4e7; font 16/400 lh24; backdrop blur(8px) |
| Modal (wide) | 80,139.7 1120×520.6 | bg #ffffff; text #0f172a; border 1 #e2e8f0; radius 16; shadow rgba(0,0,0,0.05) 0 1 2 0; font 16/400 lh24; pad 22/28/0/28; backdrop blur(0px) saturate(1.6) | bg #1a1a1f; text #e8eaf0; border 1 rgba(255,255,255,0.11); radius 16; shadow rgba(255,255,255,0.05) 0 1 0 0 inset, rgba(0,0,0,0.62) 0 24 64 0; font 16/400 lh24; pad 22/28/0/28; backdrop blur(0px) saturate(1.6) |
| Close X | 1153,152.7 34×34 | text #64748b; border 1 #e8eaef; radius 10; font 14.4/600 lh14.4 ls0.144; gap 8 | text #a1a1aa; border 1 #3f3f46; radius 10; font 14.4/600 lh14.4 ls0.144; gap 8 |
| Header | 109,162.7 1062×73.2 | text #0f172a; font 16/400 lh24; pad 0/48/0/0; gap 14 | text #e8eaf0; font 16/400 lh24; pad 0/48/0/0; gap 14 |
| Eyebrow “FACTURATION” | 109,162.7 280.7×22.1 | text #475569; font 14.72/750 lh22.08 ls1.472 UPPER | text #b4b9c6; font 14.72/750 lh22.08 ls1.472 UPPER |
| Title h2 “Nouvelle facture de vente” | 109,200.8 280.7×35.1 | text #0f172a; font 23.392/700 lh35.088 ls-0.46784 | text #e4e7ef; font 23.392/700 lh35.088 ls-0.46784 |
| Counter “n / N” “2 / 3” | 1075.8,184.3 47.2×30 | text #64748b; border 1 #e8eaef; radius 999; font 12/700 lh18; pad 5/10/5/10 | text #a1a1aa; border 1 #3f3f46; radius 999; font 12/700 lh18; pad 5/10/5/10 |
| Step pills track | 109,235.9 1062×56 | text #0f172a; font 16/400 lh24; pad 12/2/12/2; gap 8 12 | text #e8eaf0; font 16/400 lh24; pad 12/2/12/2; gap 8 12 |
| Step pill — complete | 111,247.9 78.6×32 | bg #f0fdf4; text #166534; border 1 #bbf7d0; radius 999; font 11.52/600 lh17.28 ls0.1152; pad 4/10/4/4; gap 6 | bg #3f3f46; text #f4f4f5; border 1 #52525b; radius 999; font 11.52/600 lh17.28 ls0.1152; pad 4/10/4/4; gap 6 |
|   circle (✓) “✓” | 116,252.9 22×22 | bg #dcfce7; text #15803d; border 1 #86efac; radius 50%; font 10.88/700 lh16.32 ls0.1152 | bg #14532d; text #86efac; border 1 #166534; radius 50%; font 10.88/700 lh16.32 ls0.1152 |
| Step pill — current | 201.6,247.9 81.5×32 | bg #18181b; text #ffffff; border 1 #18181b; radius 999; font 11.52/600 lh17.28 ls0.1152; pad 4/10/4/4; gap 6 | bg #3f3f46; text #f4f4f5; border 1 #52525b; radius 999; font 11.52/600 lh17.28 ls0.1152; pad 4/10/4/4; gap 6 |
|   circle (n) “2” | 206.6,252.9 22×22 | bg rgba(255,255,255,0.16); text #ffffff; border 1 rgba(255,255,255,0.34); radius 50%; font 10.88/700 lh16.32 ls0.1152 | bg #18181b; text #fafafa; border 1 #18181b; radius 50%; font 10.88/700 lh16.32 ls0.1152 |
|   label “Lignes” | 234.6,255.2 37.5×17.3 | text #ffffff; font 11.52/700 lh17.28 ls0.1152 | text #f4f4f5; font 11.52/700 lh17.28 ls0.1152 |
| Step pill — upcoming | 295.1,247.9 89.6×32 | bg #f8fafc; text #475569; border 1 #e2e8f0; radius 999; font 11.52/600 lh17.28 ls0.1152; pad 4/10/4/4; gap 6 | bg #3f3f46; text #f4f4f5; border 1 #52525b; radius 999; font 11.52/600 lh17.28 ls0.1152; pad 4/10/4/4; gap 6 |
|   circle “3” | 300.1,252.9 22×22 | bg #ffffff; text #475569; border 1 #cbd5e1; radius 50%; font 10.88/700 lh16.32 ls0.1152 | bg #18181b; text #d4d4d8; border 1 #52525b; radius 50%; font 10.88/700 lh16.32 ls0.1152 |
| Body | 109,291.9 1062×274.8 | text #0f172a; border-T 1 #e8eaef; font 16/400 lh24; pad 18/6/16/2 | text #e8eaf0; border-T 1 #2e2e33; font 16/400 lh24; pad 18/6/16/2 |
| Intro | 111,310.9 1054×59.7 | text #0f172a; font 16/400 lh24 | text #e8eaf0; font 16/400 lh24 |
| Intro h3 “Lignes” | 111,310.9 1054×27.6 | text #0f172a; font 18.4/700 lh27.6 ls-0.368 | text #e4e7ef; font 18.4/700 lh27.6 ls-0.368 |
| Intro p “Articles, quantités et prix selon le mod” | 111,348.5 1054×22.1 | text #475569; font 14.72/400 lh22.08 | text #b4b9c6; font 14.72/400 lh22.08 |
| Table head label “Recherche / produit” | 122,397.5 327.8×15 | text #64748b; font 10/600 lh15 | text #a1a1aa; font 10/600 lh15 |
| Input | 455.8,418.5 262.2×49.5 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 10; font 15.2/400 lh23.56; pad 12/14/12/14 | bg #18181b; text #e4e4e7; border 1 #3f3f46; radius 10; font 15.2/400 lh23.56; pad 12/14/12/14 |
| Row delete × “×” | 1118,420.3 42×46 | bg #dc2626; text #ffffff; border 1 #dc2626; radius 12; font 14.4/600 lh21.6 ls0.144; pad 11/20/11/20; gap 8 | bg #7f1d1d; text #fecaca; border 1 #991b1b; radius 12; font 14.4/600 lh21.6 ls0.144; pad 11/20/11/20; gap 8 |
| Secondary “+ Ajouter une ligne” “+ Ajouter une ligne” | 111,497.1 170.9×45.6 | bg #ffffff; text #27272a; border 1 #d4d4d8; radius 12; font 14.4/500 lh21.6 ls0.144; pad 11/20/11/20; gap 8 | bg #27272a; text #e4e4e7; border 1 #3f3f46; radius 12; font 14.4/500 lh21.6 ls0.144; pad 11/20/11/20; gap 8 |
| Footer | 81,572.7 1118×86.6 | bg #ffffff; text #0f172a; border-T 1 #e8eaef; radius 16; shadow rgba(0,0,0,0.08) 0 -10 24 0; font 16/400 lh24; pad 12/28/14/28 | bg #1c1c1f; text #e8eaf0; border-T 1 #2e2e33; radius 16; shadow rgba(0,0,0,0.45) 0 -12 28 0; font 16/400 lh24; pad 12/28/14/28; gap 10 |
| Footer progress bar | 109,585.7 1062×4 | bg rgba(113,113,122,0.22); text #0f172a; radius 999; font 16/400 lh24 | — |
| Footer nav | 109,599.7 1062×45.6 | text #0f172a; font 16/400 lh24; gap 8 10 | text #e8eaf0; font 16/400 lh24; gap 8 10 |
| Step chip | 122,612.2 121.7×20.5 | bg #0a0a0a; text #fafafa; radius 999; font 11/650 lh16.5 ls0.345; pad 2/10/2/10; gap 4 | bg #27272a; text #a1a1aa; radius 999; font 11/650 lh16.5 ls0.345; pad 2/10/2/10; gap 4 |
| Step label “· Lignes” | 190.7,614.2 43.1×16.5 | text #fafafa; font 11/650 lh16.5 ls0.345 | text #a1a1aa; font 11/650 lh16.5 ls0.345 |
| Btn Annuler (secondary) “Annuler” | 859.5,599.7 95.4×45.6 | bg #ffffff; text #27272a; border 1 #d4d4d8; radius 999; font 14.4/500 lh21.6 ls0.144; pad 11/20/11/20; gap 8 | bg #27272a; text #e4e4e7; border 1 #3f3f46; radius 999; font 14.4/500 lh21.6 ls0.144; pad 11/20/11/20; gap 8 |
| Btn Retour “Retour” | 962.8,599.7 87.5×45.6 | bg #ffffff; text #27272a; border 1 #d4d4d8; radius 999; font 14.4/500 lh21.6 ls0.144; pad 11/20/11/20; gap 8 | bg #27272a; text #e4e4e7; border 1 #3f3f46; radius 999; font 14.4/500 lh21.6 ls0.144; pad 11/20/11/20; gap 8 |
| Btn Continuer (primary) “Continuer” | 1058.3,599.7 112.7×45.6 | bg #18181b; text #fafafa; border 1 #18181b; radius 999; font 14.4/600 lh21.6 ls0.144; pad 11/20/11/20; gap 8 | bg #3f3f46; text #f4f4f5; border 1 #52525b; radius 999; font 14.4/600 lh21.6 ls0.144; pad 11/20/11/20; gap 8 |

#### Wizard kit — form fields (reference: client step 1/3)

| Element | Box (x,y w×h) | Light | Dark |
|---|---|---|---|
| Form row | 229,322 818×95.2 | text #0f172a; font 16/400 lh24 | text #e8eaf0; font 16/400 lh24 |
| Label “Nom *” | 229,322 818×19.5 | text #64748b; font 13/600 lh19.5 | text #d4d4d8; font 13/600 lh19.5 |
| Input (required, empty → warn) | 229,347.5 818×49.5 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 10; font 15.2/400 lh23.56; pad 12/14/12/14 | bg #18181b; text #e4e4e7; border 1 #3f3f46; radius 10; font 15.2/400 lh23.56; pad 12/14/12/14 |
| Field hint “Obligatoire” | 229,401 818×16.2 | text #64748b; font 12/400 lh16.2 | text #a1a1aa; font 12/400 lh16.2 |
| Input (normal) | 229,549.7 818×49.5 | bg #ffffff; text #0f172a; border 1 #e8eaef; radius 10; font 15.2/400 lh23.56; pad 12/14/12/14 | bg #18181b; text #e4e4e7; border 1 #3f3f46; radius 10; font 15.2/400 lh23.56; pad 12/14/12/14 |


### 3.4 Per-wizard step tables

Every box below is measured at 1280×800 in light mode (dark mode uses identical geometry; check the dark PNG for colours). `Modal` = the `.modal` box. The modal is **vertically centred**, so its y changes with content height, and its width is fixed per wizard.


#### `product` — CATALOGUE PRODUIT · “Nouveau produit” (5 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,43.2 1120×713.7 | Identité / Nom, référence SKU et description catalogue. | Nom * → input 111,315.5 1054×49.5<br>Référence (SKU) → input 111,406.5 1054×49.5<br>Description → textarea 111,497.6 1054×73.1 | Annuler 954.9,696.2 95.4×45.6<br>Continuer 1058.3,696.2 112.7×45.6 | `wizard-product-step1-light.png` |
| 2 | 80,24 1120×752 | Classement / Catégorie, unités et traçabilité. | Catégorie → select 111,296.3 1054×44<br>Unité (m², ML…) * → select 111,381.8 1054×44<br>Deuxième unité (facultatif) → select 111,467.3 1054×44<br>Quantité par unité → input 111,552.8 1054×49.5<br>Code-barres → input 111,643.9 1054×49.5<br>N° lot (épicerie) → input 111,734.9 1054×49.5<br>Date limite (DLC) → button 111,825.9 1054×45.6 | Annuler 859.5,715.4 95.4×45.6<br>Retour 962.8,715.4 87.5×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-product-step2-light.png` |
| 3 | 80,24 1120×752 | Prix & stock / Tarifs, TVA, stock initial et seuil d’alerte. | Prix de vente * → input 111,296.3 1054×49.5<br>Coût → input 111,387.4 1054×49.5<br>Stock initial ( unité ) → input 111,478.4 1054×49.5<br>Entrepôt / emplacement → select 111,569.4 1054×44<br>Seuil d'alerte → input 111,654.9 1054×49.5<br>Taux TVA % → input 111,746 1054×49.5<br>Prix sur facture → select 111,837 1054×44<br>Suivre le stock pour ce prod → input 111,897 20×20 | Annuler 859.5,715.4 95.4×45.6<br>Retour 962.8,715.4 87.5×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-product-step3-light.png` |
| 4 | 80,25.7 1120×748.6 | Remises volume / Paliers de remise automatique selon la quantité. | Palier 1 — Qté min → input 111,326 1054×49.5<br>Palier 1 — Remise % → input 111,417.1 1054×49.5<br>Palier 2 — Qté min → input 111,508.1 1054×49.5<br>Palier 2 — Remise % → input 111,599.1 1054×49.5 | Annuler 859.5,713.7 95.4×45.6<br>Retour 962.8,713.7 87.5×45.6<br>Continuer 1058.3,713.7 112.7×45.6 | `wizard-product-step4-light.png` |
| 5 | 80,173.7 1120×452.6 | Photos / Ajoutez une ou plusieurs photos pour le catalogue. | button “+ Ajouter des photos” 111,446.6 186.2×45.6<br>button “Enregistrer” 1051.1,565.7 119.9×45.6 | Annuler 852.3,565.7 95.4×45.6<br>Retour 955.7,565.7 87.5×45.6<br>Enregistrer 1051.1,565.7 119.9×45.6 | `wizard-product-step5-light.png` |

#### `product-edit-history` — CATALOGUE PRODUIT · “Modifier les détails — Marbre Carrara blanc 2cm” (3 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,24 1120×752 | Identité / Nom, catégorie, références et description catalogue. | Nom * → input 111,296.3 1054×49.5<br>Catégorie → select 111,387.4 1054×44<br>SKU / Référence → input 111,472.9 1054×49.5<br>Code-barres → input 111,563.9 1054×49.5<br>Description → textarea 111,654.9 1054×73.1 | Générer la description (IA) 111,741 247.1×45.6<br>Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-product-edit-history-step1-light.png` |
| 2 | 80,24.5 1120×751 | Unités & stock / Unité principale, deuxième unité et suivi de stock. | Unité principale → select 111,296.8 1054×44<br>Seuil d’alerte → input 111,382.3 1054×49.5<br>Deuxième unité (optionnel) → input 111,473.3 1054×49.5<br>Coefficient (1 m² = …) → input 111,564.4 1054×49.5<br>Suivre le stock pour ce prod → input 111,629.9 20×20 | Annuler 859.5,714.9 95.4×45.6<br>Retour 962.8,714.9 87.5×45.6<br>Continuer 1058.3,714.9 112.7×45.6 | `wizard-product-edit-history-step2-light.png` |
| 3 | 80,42.5 1120×715 | Tarifs & TVA / Prix de vente, coût d’achat et régime de TVA. | Prix de vente * → input 111,314.8 1054×49.5<br>Coût → input 111,405.8 1054×49.5<br>Taux TVA % → input 111,496.9 1054×49.5<br>Prix sur facture → select 111,587.9 1054×44 | Annuler 727.4,696.9 95.4×45.6<br>Retour 830.7,696.9 87.5×45.6<br>Enregistrer les modifications 926.2,696.9 244.8×45.6 | `wizard-product-edit-history-step3-light.png` |

#### `stock-adjust` — STOCK PRODUIT · “Ajuster le stock — Marbre Carrara blanc 2cm” (2 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,116.5 880×567.1 | Mouvement / Choisissez le sens du mouvement et la quantité. | Type de mouvement → select 229,422.9 818×44<br>Quantité → input 229,508.4 818×49.5 | Annuler 836.9,622.9 95.4×45.6<br>Continuer 940.3,622.9 112.7×45.6 | `wizard-stock-adjust-step1-light.png` |
| 2 | 200,159.2 880×481.6 | Motif / Précisez le motif pour la traçabilité du stock. | Motif / note → input 229,465.6 818×49.5 | Annuler 734.3,580.2 95.4×45.6<br>Retour 837.7,580.2 87.5×45.6<br>Enregistrer 933.1,580.2 119.9×45.6 | `wizard-stock-adjust-step2-light.png` |

#### `client` — FICHE CLIENT · “Nouveau client” (3 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,75.1 880×649.7 | Identité / Nom du client et identifiants fiscaux. | Nom * → input 229,347.5 818×49.5<br>ICE → input 229,458.7 818×49.5<br>IF → input 229,549.7 818×49.5 | Annuler 836.9,664.3 95.4×45.6<br>Continuer 940.3,664.3 112.7×45.6 | `wizard-client-step1-light.png` |
| 2 | 200,39.7 880×720.6 | Contact / Adresse, ville, téléphone et e-mail. | Adresse → input 229,312 818×49.5<br>Ville → input 229,403.1 818×49.5<br>Téléphone → input 229,494.1 818×49.5<br>E-mail → input 229,585.1 818×49.5 | Annuler 741.5,699.7 95.4×45.6<br>Retour 844.8,699.7 87.5×45.6<br>Continuer 940.3,699.7 112.7×45.6 | `wizard-client-step2-light.png` |
| 3 | 200,146.3 880×507.5 | Options / Exonération TVA et plafond de crédit. | Exonéré de TVA (tax exempt)  → input 229,393.1 20×20<br>Limite de crédit (0 = illimi → input 229,454.6 818×49.5 | Annuler 712.7,593.1 95.4×45.6<br>Retour 816.1,593.1 87.5×45.6<br>Créer le client 911.5,593.1 141.5×45.6 | `wizard-client-step3-light.png` |

#### `vendor` — FICHE FOURNISSEUR · “Nouveau fournisseur” (2 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,85.2 880×629.5 | Identité / Nom du fournisseur et identifiants fiscaux. | Nom * → input 229,357.6 818×49.5<br>ICE / Identifiant fiscal → input 229,448.6 818×49.5<br>IF → input 229,539.6 818×49.5 | Annuler 836.9,654.2 95.4×45.6<br>Continuer 940.3,654.2 112.7×45.6 | `wizard-vendor-step1-light.png` |
| 2 | 200,39.7 880×720.6 | Contact / Adresse, ville, téléphone et e-mail. | Adresse → input 229,312 818×49.5<br>Ville → input 229,403.1 818×49.5<br>Téléphone → input 229,494.1 818×49.5<br>E-mail → input 229,585.1 818×49.5 | Annuler 642.6,699.7 95.4×45.6<br>Retour 746,699.7 87.5×45.6<br>Enregistrer dans la base 841.4,699.7 211.6×45.6 | `wizard-vendor-step2-light.png` |

#### `invoice` — FACTURATION · “Nouvelle facture de vente” (3 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,24 1120×752 | Client / Client, coordonnées et dates du document. | Client enregistré → input 111,296.3 1054×49.5<br>Date d'émission → button 111,387.4 1054×45.6<br>Date d'échéance → button 111,474.5 1054×45.6<br>Nom du client * → input 111,561.6 1054×49.5<br>ICE / Identifiant fiscal → input 111,652.6 1054×49.5<br>Adresse → input 111,743.7 1054×49.5<br>Ville → input 111,834.7 1054×49.5<br>E-mail → input 111,925.7 1054×49.5<br>Téléphone → input 111,1016.8 1054×49.5 | Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-invoice-step1-light.png` |
| 2 | 80,139.7 1120×520.6 | Lignes / Articles, quantités et prix selon le mode TVA du produit. | input “” 122,418.5 208×49.5<br>input “” 455.8,418.5 262.2×49.5<br>input “” 724,418.5 70×49.5<br>input “” 800,418.5 100×49.5<br>input “” 906,418.5 100×49.5<br>button “×” 1118,420.3 42×46<br>button “+ Ajouter une ligne” 111,497.1 170.9×45.6 | Annuler 859.5,599.7 95.4×45.6<br>Retour 962.8,599.7 87.5×45.6<br>Continuer 1058.3,599.7 112.7×45.6 | `wizard-invoice-step2-light.png` |
| 3 | 80,120.2 1120×559.6 | Options / Régime TVA et notes sur le document. | Exonéré de TVA (tax exempt)  → input 111,367 20×20<br>Notes → textarea 111,428.5 1054×73.1 | Annuler 819.7,619.2 95.4×45.6<br>Retour 923,619.2 87.5×45.6<br>Créer la facture 1018.5,619.2 152.5×45.6 | `wizard-invoice-step3-light.png` |

#### `quote` — ESTIMATION · “Nouveau devis” (3 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,57.2 1120×685.6 | Client / Client, date et régime TVA du devis. | Client * → input 111,329.5 1054×49.5<br>Nom client (libre) → input 111,420.6 1054×49.5<br>Date → button 111,511.6 1054×45.6<br>TVA activée (désactiver pour → input 111,573.2 20×20 | Annuler 954.9,682.2 95.4×45.6<br>Continuer 1058.3,682.2 112.7×45.6 | `wizard-quote-step1-light.png` |
| 2 | 80,139 1120×522.1 | Lignes / Produits, quantités et prix catalogue / client. | input “” 122,419.3 208×49.5<br>input “” 425.2,419.3 324.8×49.5<br>input “” 758,419.3 70×49.5<br>input “” 836,419.3 90×49.5<br>input “” 934,419.3 90×49.5<br>button “✕” 1110,421.3 44×45.6<br>button “+ Ligne” 111,497.8 91×45.6 | Annuler 859.5,600.4 95.4×45.6<br>Retour 962.8,600.4 87.5×45.6<br>Continuer 1058.3,600.4 112.7×45.6 | `wizard-quote-step2-light.png` |
| 3 | 80,112 1120×576 | Notes / Remarques et vérification des totaux. | Notes → textarea 111,384.3 1054×73.1 | Annuler 795,627.4 95.4×45.6<br>Retour 898.4,627.4 87.5×45.6<br>Enregistrer le devis 993.8,627.4 177.2×45.6 | `wizard-quote-step3-light.png` |

#### `bill` — ACHAT FOURNISSEUR · “Nouvelle facture d'achat” (3 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,24 1120×752 | Fournisseur / Scanner une facture ou renseigner le fournisseur. | Fournisseur enregistré → input 111,394.3 1054×49.5<br>Date d'émission → button 111,485.4 1054×45.6<br>Nom du fournisseur * → input 111,572.5 1054×49.5<br>ICE / Identifiant → input 111,663.5 1054×49.5<br>Adresse → input 111,754.5 1054×49.5 | Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-bill-step1-light.png` |
| 2 | 80,24 1120×752 | Fournisseur / Scanner une facture ou renseigner le fournisseur. | Fournisseur enregistré → input 111,394.3 1054×49.5<br>Date d'émission → button 111,485.4 1054×45.6<br>Nom du fournisseur * → input 111,572.5 1054×49.5<br>ICE / Identifiant → input 111,683.7 1054×49.5<br>Adresse → input 111,774.7 1054×49.5 | Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-bill-step2-light.png` |
| 3 | 80,24 1120×752 | Fournisseur / Scanner une facture ou renseigner le fournisseur. | Fournisseur enregistré → input 111,394.3 1054×49.5<br>Date d'émission → button 111,485.4 1054×45.6<br>Nom du fournisseur * → input 111,572.5 1054×49.5<br>ICE / Identifiant → input 111,683.7 1054×49.5<br>Adresse → input 111,774.7 1054×49.5 | Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-bill-step3-light.png` |

#### `receipt` — ENCAISSEMENT · “Nouveau reçu” (2 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,88 880×624 | Client & montant / Associez une facture ou saisissez le client et le montant. | Lier à une facture (optionne → select 229,360.3 818×44<br>Nom du client * → input 229,445.8 818×49.5<br>Montant * → input 229,536.9 818×49.5 | Annuler 836.9,651.4 95.4×45.6<br>Continuer 940.3,651.4 112.7×45.6 | `wizard-receipt-step1-light.png` |
| 2 | 200,74.7 880×650.6 | Paiement & notes / Mode de règlement, date et remarques. | Mode de paiement → select 229,347 818×44<br>Date → button 229,432.5 818×45.6<br>Notes → textarea 229,519.6 818×73.1 | Annuler 642.6,664.7 95.4×45.6<br>Retour 746,664.7 87.5×45.6<br>Enregistrer dans la base 841.4,664.7 211.6×45.6 | `wizard-receipt-step2-light.png` |

#### `quick-sale` — VENTE RAPIDE · “Nouvelle vente rapide (caisse)” (3 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,24 1120×752 | Client / Client, coordonnées et date d’émission (aucune TVA sur les t | Client enregistré → input 111,296.3 1054×49.5<br>Nom du client * → input 111,387.4 1054×49.5<br>ICE / Identifiant fiscal → input 111,478.4 1054×49.5<br>Téléphone → input 111,569.4 1054×49.5<br>Date d'émission → button 111,660.5 1054×45.6 | Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-quick-sale-step1-light.png` |
| 2 | 80,139.7 1120×520.6 | Articles / Recherchez vos produits, prix et quantités. | input “” 122,418.5 208×49.5<br>input “” 455.8,418.5 262.2×49.5<br>input “” 724,418.5 70×49.5<br>input “” 800,418.5 100×49.5<br>input “” 906,418.5 100×49.5<br>button “×” 1118,420.3 42×46<br>button “+ Ajouter une ligne” 111,497.1 170.9×45.6 | Annuler 859.5,599.7 95.4×45.6<br>Retour 962.8,599.7 87.5×45.6<br>Continuer 1058.3,599.7 112.7×45.6 | `wizard-quick-sale-step2-light.png` |
| 3 | 80,114.2 1120×571.6 | Paiement / Mode de règlement, total et notes. | Notes → textarea 111,480.1 1054×73.1 | Annuler 816.7,625.2 95.4×45.6<br>Retour 920.1,625.2 87.5×45.6<br>Encaisser · 0 DH 1015.5,625.2 155.5×45.6 | `wizard-quick-sale-step3-light.png` |

#### `refund-wr` — AVOIR / RETOUR · “Créer un remboursement (WR)” (2 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,145 880×510 | Document d’origine / Choisissez la facture FA ou le ticket VR concerné. | Document d’origine * → select 229,485.4 818×44 | Annuler 836.9,594.4 95.4×45.6<br>Continuer 940.3,594.4 112.7×45.6 | `wizard-refund-wr-step1-light.png` |
| 2 | 200,75.5 880×649 | Lignes & motif / Quantités remboursées, retour en stock et explication. | Motif * → select 229,347.8 818×44<br>Mode de remboursement (si pa → select 229,433.3 818×44<br>Explication détaillée * → textarea 229,518.8 818×73.1 | Annuler 638.5,663.9 95.4×45.6<br>Retour 741.9,663.9 87.5×45.6<br>Créer le remboursement 837.3,663.9 215.7×45.6 | `wizard-refund-wr-step2-light.png` |

#### `balance-recette` — TRÉSORERIE · “Nouvelle écriture — Recette” (2 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,90.8 880×618.5 | Type & libellé / Entrée de trésorerie (affichée en vert, signe +). | Type → select 229,363.1 818×44<br>Catégorie → select 229,448.6 818×44<br>Libellé * → input 229,534.1 818×49.5 | Annuler 836.9,648.6 95.4×45.6<br>Continuer 940.3,648.6 112.7×45.6 | `wizard-balance-recette-step1-light.png` |
| 2 | 200,28 880×744 | Montant & paiement / Montant, date, mode de paiement et notes. | Montant * → input 229,300.3 818×49.5<br>Date → button 229,391.4 818×45.6<br>Mode de paiement → select 229,478.5 818×44<br>Tiers / note → input 229,564 818×49.5<br>Notes → textarea 229,655 818×73.1 | Annuler 734.3,711.4 95.4×45.6<br>Retour 837.7,711.4 87.5×45.6<br>Enregistrer 933.1,711.4 119.9×45.6 | `wizard-balance-recette-step2-light.png` |

#### `balance-depense` — TRÉSORERIE · “Nouvelle écriture — Dépense” (2 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 200,90.8 880×618.5 | Type & libellé / Sortie de trésorerie (affichée en rouge, signe −). | Type → select 229,363.1 818×44<br>Catégorie → select 229,448.6 818×44<br>Libellé * → input 229,534.1 818×49.5 | Annuler 836.9,648.6 95.4×45.6<br>Continuer 940.3,648.6 112.7×45.6 | `wizard-balance-depense-step1-light.png` |
| 2 | 200,28 880×744 | Montant & paiement / Montant, date, mode de paiement et notes. | Montant * → input 229,300.3 818×49.5<br>Date → button 229,391.4 818×45.6<br>Mode de paiement → select 229,478.5 818×44<br>Tiers / note → input 229,564 818×49.5<br>Notes → textarea 229,655 818×73.1 | Annuler 734.3,711.4 95.4×45.6<br>Retour 837.7,711.4 87.5×45.6<br>Enregistrer 933.1,711.4 119.9×45.6 | `wizard-balance-depense-step2-light.png` |

#### `balance-reports-dialog` —  · “Rapports PDF & exports” (1 step)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 290,175.8 700×448.5 | — | select “” 330,322.3 220.7×44<br>input “” 562.7,326.3 220.7×40 | — | `wizard-balance-reports-dialog-step1-light.png` |

#### `employee` — FICHE EMPLOYÉ · “Nouvel employé” (9 steps)

| Step | Modal box | Intro h3 / p | Fields & controls (label → control box) | Footer buttons | PNG |
|---|---|---|---|---|---|
| 1 | 80,24 1120×752 | Personnel / Les informations de base de votre collaborateur. | Prénom → input 111,296.3 1054×49.5<br>Nom de famille → input 111,387.4 1054×49.5<br>Date de naissance → button 111,498.6 1054×45.6<br>Genre → select 111,585.7 1054×44<br>Nationalité → select 111,671.2 1054×44<br>Situation familiale → select 111,756.7 1054×44 | Annuler 954.9,715.4 95.4×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-employee-step1-light.png` |
| 2 | 80,30.9 1120×738.3 | Identité / Ses pièces d’identité et justificatifs. | Statut d’identité / séjour → select 111,303.2 1054×44<br>CIN / pièce d’identité → input 111,388.7 1054×49.5<br>Permis de conduire → input 111,479.7 1054×49.5<br>Fichier CIN / passeport (PDF → input 111,570.8 1054×50.6 | Annuler 859.5,708.5 95.4×45.6<br>Retour 962.8,708.5 87.5×45.6<br>Continuer 1058.3,708.5 112.7×45.6 | `wizard-employee-step2-light.png` |
| 3 | 80,84.2 1120×631.5 | Social & fiscal / Numéro fiscal, CNSS et couverture santé. | Identifiant fiscal → input 111,356.6 1054×49.5<br>CNSS / Social → input 111,447.6 1054×49.5<br>Assurance maladie → input 111,538.6 1054×49.5 | Annuler 859.5,655.2 95.4×45.6<br>Retour 962.8,655.2 87.5×45.6<br>Continuer 1058.3,655.2 112.7×45.6 | `wizard-employee-step3-light.png` |
| 4 | 80,24 1120×752 | Poste / Son rôle et sa date d’arrivée. | Intitulé du poste → input 111,296.3 1054×49.5<br>Département → input 111,387.4 1054×49.5<br>Catégorie → select 111,478.4 1054×44<br>Statut d’emploi → select 111,563.9 1054×44<br>Date d’embauche → button 111,649.4 1054×45.6 | Annuler 859.5,715.4 95.4×45.6<br>Retour 962.8,715.4 87.5×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-employee-step4-light.png` |
| 5 | 80,24 1120×752 | Contact / Ses coordonnées et son adresse. | Adresse → input 111,296.3 1054×49.5<br>Ville → input 111,387.4 1054×49.5<br>Pays → input 111,478.4 1054×49.5<br>Mobile → input 111,569.4 1054×49.5<br>E-mail → input 111,660.5 1054×49.5 | Annuler 859.5,715.4 95.4×45.6<br>Retour 962.8,715.4 87.5×45.6<br>Continuer 1058.3,715.4 112.7×45.6 | `wizard-employee-step5-light.png` |
| 6 | 80,131.7 1120×536.6 | Salaire / Définissez le montant et la fréquence de paiement. | Montant (MAD) → input 111,404 1054×49.5<br>Fréquence de paiement → button 111,495.1 101.2×45.6 | Annuler 859.5,607.7 95.4×45.6<br>Retour 962.8,607.7 87.5×45.6<br>Continuer 1058.3,607.7 112.7×45.6 | `wizard-employee-step6-light.png` |
| 7 | 80,36.9 1120×726.1 | Déclaration CNSS / Est-il déclaré à la CNSS, et combien de jours par mois ? | Jours déclarés par mois | Annuler 859.5,702.5 95.4×45.6<br>Retour 962.8,702.5 87.5×45.6<br>Continuer 1058.3,702.5 112.7×45.6 | `wizard-employee-step7-light.png` |
| 8 | 80,41.5 1120×717 | Contrat / Les conditions de travail et les coordonnées bancaires. | Type de contrat → select 111,313.8 1054×44<br>Période d’essai (jours) → input 111,399.3 1054×49.5<br>Durée hebdomadaire (h) — lég → input 111,490.3 1054×49.5<br>RIB (versement salaire) → input 111,581.4 1054×49.5 | Annuler 859.5,697.9 95.4×45.6<br>Retour 962.8,697.9 87.5×45.6<br>Continuer 1058.3,697.9 112.7×45.6 | `wizard-employee-step8-light.png` |
| 9 | 80,43.6 1120×712.8 | Détails / Complétez les informations utiles à la fiche. | Compte lié (identifiant de c → input 111,315.9 1054×49.5<br>Description du poste / fonct → textarea 111,427.2 1054×73.1<br>Notes → textarea 111,548.7 1054×73.1 | Annuler 819.3,695.8 95.4×45.6<br>Retour 922.6,695.8 87.5×45.6<br>Créer l’employé 1018.1,695.8 152.9×45.6 | `wizard-employee-step9-light.png` |

---

## 4. Acceptance (the same bar as the login)

- Overlay your 1280×800 screenshot on each PNG here (light AND dark). **Every box must be within ≤ 2 px** of the tables above, and every colour must be an exact hex match.
- Produce a table in the PR covering every row of section 3 with these columns: web box, desktop box, Δx, Δy, Δw, Δh, colour match ✓/✗. Any row with Δ > 2 is a fail.
- The behaviours in section 2 (collapse persistence, dock compact thresholds, popover close rules, wizard pinning and scrolling, step-pill clickability, badge = popover count) must each be demonstrated, with a screenshot or short clip per item.
