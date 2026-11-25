# Android (native) prompt: scan screen, KPI cards, bottom toasts, D1 read budget

Copy-paste prompt for the Android (Kotlin / Jetpack Compose) app, to match web 0.9.3.
**Do not bump the app version for this work.**

---

## 1. Scan screen

Match the mobile web `/m/scan` page.

1. **Header row** (directly under the top bar, above the camera card):
   - Do not show « En ligne ». Show a red pill **« Hors ligne »** (dot + text, 26dp tall, fully
     rounded, red at 10% alpha on a red-700 label) on the left, and **only** when
     `ConnectivityManager` reports no validated network.
   - Right-aligned primary pill button **« Ajouter un produit »** (36dp, `+` icon 16dp, label 13sp
     semibold). Light theme: slate-900 fill with white text. Dark theme: zinc-100 fill with
     zinc-950 text. Tapping it stops the camera and opens the existing "new product" sheet,
     blank. The sheet title is « Ajouter un produit », and there is no « Code … » line unless
     a code exists.
2. **Remove** the « Image » (import a barcode photo) and « Contrôle rayon » buttons.
3. **Manual code card** (« Code-barres ou SKU » field + « Rechercher »): hidden by default. Show it
   only after a scan **failed**, meaning any of:
   - the camera permission was denied, or there is no camera;
   - the camera failed to start;
   - the scanner reported an error;
   - « Photo » found no code.

   When it appears, put an amber notice above it: « Lecture impossible — saisissez le
   code-barres ou le SKU. » The card stays visible while its field contains text.
4. **Remove** the « Envoyés aujourd’hui » section and its « Rien aujourd’hui » empty state.
5. Toast copy no longer mentions « Image ». Use « … saisissez le code » instead.

## 2. KPI cards (Home, Employés, Clients, Scan)

Use swipeable metric cards, the same as web (`src/mobile/PhoneKpis.tsx`):
- `LazyRow` with snap-to-item, card width ≈ 46% of the screen (min 158dp), 10dp gap.
- On tablets (sw ≥ 600dp, including the tablet-mode sidebar layout), use an adaptive grid
  (min 170dp) instead of a row. The cards must not slide under the sidebar rail: lay the grid
  out inside the content pane, not the full window.
- Card: 16dp radius, 1dp hairline border, 12dp padding, 48dp bottom area for the sparkline.
  Contents:
  - label (12sp semibold, muted); flow metrics add « · 7 j »;
  - value (19sp bold, tabular figures) + trend chip;
  - an edge-to-edge sparkline at the bottom with a soft gradient fill.
- Data: **one** call to `GET /api/metrics/daily?days=7`, shared by all four screens and cached
  in memory for 60 s. Never call it once per card or once per screen.
  - Flow metrics show the sum of the last `days` points.
  - Level metrics show the latest non-null point.
  - Keys missing from the response (role-filtered) are skipped.
  - When no data is available, the sparkline shows a flat line with « Aucune donnée ».
- Trend chip: compare the current 7 days with the previous 7. Green when good, red when bad;
  `invert` swaps the colours.

| Screen   | Cards (key → label) |
|----------|---------------------|
| Accueil  | `sales` Ventes (money) · `money_in` Encaissements (money) · `stock_moves` Mouvements de stock · `low_stock` Stock bas (invert) · `pending_actions` Demandes en attente (invert) |
| Employés | `employees_active` Employés actifs · `att_present` Présences · `att_absent` Absences (invert) |
| Clients  | `clients_total` Clients · `clients_new` Nouveaux clients · `receivables` Créances (money, invert) · `receipts` Encaissé (money) |
| Scan     | `stock_moves` Mouvements · `actions_new` Envois au PC · `low_stock` Stock bas (invert) · `products` Produits actifs (shown only while the camera is off) |

## 3. Toasts / snackbars

All snackbars, errors included, sit at the **bottom**: above the bottom navigation bar, and
above any floating "unsaved changes" bar. Newest is closest to the edge. Use a 280ms
slide-up and fade with easing `cubic-bezier(0.22, 1, 0.36, 1)`; with reduced motion, show
them without animation.

## 4. D1 read budget (important)

The worker now protects D1 rows-read. The app must not undo that:
- After a local write (scan, stock adjustment, sale), **do not** immediately refetch
  `/api/metrics/daily`. Mark the cache stale, wait 4 s to coalesce bursts, and refetch at
  most once every 30 s, only while a KPI card is on screen and the app is in the foreground.
- Keep the existing polling intervals (actions 90 s, badges 120 s), paused in the background.
  Do not add new pollers.
- Never trigger `/api/cron/backup-execute` from the app. Backups run every 12 h on the server
  only.
