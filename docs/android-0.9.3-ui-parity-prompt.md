# Atlas Commerce Android: same buttons, pickers, wizards and unsaved-changes guard as web (strict prompt)

> Paste this whole file as the task for the agent working in `Etherealmber/atlas-commerce-android`.
> Goal: the Android app gets **every UI change shipped on web and mobile web in this batch**. That means the same step wizards, the same "bounce" on unsaved or invalid dialogs, the same Settings guard and top save button, the same date picker, the same Products grid, and the same sheet buttons and fields. Match the copy, order, sizes and colours, in light **and** dark.
> If this file conflicts with an older Android prompt, this file wins. Do not touch the welcome and guided tour from `docs/android-welcome-onboarding-prompt.md`; they stay as they are.

---

## 0. Rules (read first)

- **Copy, do not reinterpret.** Use the same French text verbatim (including `’`, `…` and `—`), the same step labels and the same button order. Do not shorten, reword or add steps.
- **No excuse text.** Never show "bientôt", "non disponible", "ouvrir dans le navigateur" or similar in these screens. The only "coming soon" text allowed is the existing language line: "Bientôt disponible — l’arabe et l’anglais arrivent."
- **Annuler never reloads anything.** It closes or resets locally.
- **Buttons never look like links.** Every action is a filled or tonal pill. No bare underlined text actions.
- **Buttons in one row share one height and one style.**
- **Light mode must stay exactly as it is today wherever this prompt does not change it.** Dark mode must look finished. Check every screen in both.
- **0 lint warnings and 0 errors** (`./gradlew lint ktlintCheck detekt`, or whatever the repo already runs). All existing tests must stay green. Add tests for every rule in §2–§7.
- **Do not bump `versionName` or `versionCode`.** The version stays **0.9.3**. The release date is **25 Nov 2026**.
- **No AI-generated images anywhere** (no stock photos, no generated product photos). Product images come only from the user's catalogue.
- **No backend changes are needed.** If you think one is, stop and write a separate backend prompt instead of faking it on the client.

---

## 1. Sources of truth (web repo `Etherealmber/atlas-commerce`, branch `main`)

| What | Path |
|---|---|
| Unsaved-changes guard and bounce animation | `src/lib/unsavedGuard.ts` |
| Date / range / month picker (popover on desktop, bottom sheet on phones) | `src/components/DatePicker.tsx`, `src/styles/form-controls.css` (`.ac-dp-*`, tokens `--pk-*`) |
| Time picker | `src/components/TimePicker.tsx` (`.ac-tp-*`) |
| Wizard shell (steps, progress, footer) | `src/components/ui/FormWizard.tsx`, `src/components/ui/form-wizard.css` |
| Invoice wizard (5 steps) / quick sale (4) / purchase bill (5) | `src/pages/Invoices.tsx`, `src/pages/QuickSale.tsx`, `src/pages/Bills.tsx` |
| Settings guard and top save | `src/pages/Settings.tsx` (`settingsDirty`, `discardSettings`, `.settings-top-save`) |
| Products grid | `src/pages/Products.tsx`, `src/pages/products-catalog.css` (`.pc-*`) |
| Mobile web: product wizard, sheet footers, dialog bounce | `src/mobile/PhoneProductCreate.tsx`, `src/mobile/PhoneDialog.tsx`, `src/mobile/phone.css` (`.ph-wz-*`, "Mobile sheet footers") |
| Mobile web: date fields | `src/mobile/PhoneBalance.tsx`, `src/mobile/PhoneReportBundle.tsx` |

Open these files and copy exact values from them. Where this prompt gives a number, it was taken from those files.

---

## 2. The "bounce": dialogs refuse to close instead of losing data

Every bottom sheet, dialog and full-screen form that has unsaved input, or that is showing an error, **shakes once instead of closing or advancing**.

### 2.1 Animation (exact)

- Horizontal translate keyframes: `0 → -10dp (14%) → 9dp (30%) → -6dp (46%) → 4dp (62%) → -2dp (78%) → 0`.
- Duration **480 ms**, easing `cubic-bezier(.36,.07,.19,.97)`.
- Apply it to the dialog **surface**, not the scrim.
- **Reduced motion** (system "Remove animations" / `ANIMATOR_DURATION_SCALE == 0`): do not move. Flash a red outline instead: `3dp` of `rgba(239,68,68,.55)`, 650 ms, ease-out, fading in at 35% then out.
- Add haptic feedback `HapticFeedbackConstants.REJECT` on API 30+ and `LONG_PRESS` below that.

### 2.2 When to bounce

1. **Dirty dialog:** the user changed any field in the sheet (typing, a picker value, a toggle, a selected file), then tries any of these:
   - tapping the scrim;
   - swiping the sheet down;
   - pressing system Back or using predictive back;
   - tapping the close "X".

   The sheet stays open and bounces. Only an explicit **Annuler** (or **Retour** on step 1) closes it.

   Back is the important case on Android. Use `BackHandler` / `OnBackPressedCallback` (and `PredictiveBackHandler` on API 34+) so that a predictive-back gesture on a dirty sheet **snaps back and bounces** instead of committing.
2. **Error shown:** whenever a validation or server error message appears in a dialog, or its text changes, the dialog bounces once. Web does this by observing any `role="alert"` node inside the dialog. On Android, trigger it from the same state change that shows the error text.
3. **Skipping steps:** in a wizard, tapping a later step chip, or **Continuer**, while the current step is invalid. Stay on the step, show the error, and bounce.
4. **Not dirty:** scrim, swipe and Back close the sheet normally. Do not ask, do not bounce.

**What counts as "dirty":** any user edit since the sheet opened. Search fields and filters never count. Opening a picker and closing it without changing the value does not count.

**A picker open inside a dirty sheet:** Back or the scrim first closes the **picker only**. The sheet stays open and does **not** bounce. A second Back then applies rule 1.

---

## 3. Wizards: short steps, no scrolling

Long forms are split into steps so that **no step needs vertical scrolling** on a 360×740 dp phone with the keyboard closed. Every field stays in memory across steps; submission happens only on the last step.

### 3.1 Shell (same on every wizard)

- **Header:** title, then a row of **step chips**. Each chip is a 34 dp pill: a numbered 24 dp circle plus a label, 12 sp bold.
  - Current chip: filled `#0f172a` with white text. Dark: `#f4f4f5` with text `#0f172a`.
  - Completed chips: normal text colour.
  - Upcoming chips: muted `#71717a` (dark `#a1a1aa`) on white (dark `rgb(32,32,36)`), with a 1 dp border of `rgb(232,234,239)` (dark `rgba(255,255,255,.12)`).
  - When there are 3 steps, the chips share the width equally (grid, no horizontal scroll). With more steps, the row scrolls horizontally and keeps the current chip visible.
- **Progress bar:** 4 dp tall, full radius, filled to `(step+1)/total`. Track `rgba(15,23,42,.08)` (dark `rgba(255,255,255,.1)`); fill `#0f172a` (dark `#f4f4f5`). Animate width over 250 ms.
- **Step change animation:** fade in plus slide 8 dp from the end, 200 ms. Off when reduced motion is on.
- **Footer:** see §6. On step 1 the left button is **Annuler**; on later steps it is **Retour**. The right button is **Continuer**, and on the last step it becomes the real action (for example "Créer le produit" or "Enregistrer").
- **Tapping a chip:** going back is always allowed. Going forward validates every step in between, stops at the first invalid one, shows its error and bounces (§2.2.3).
- **IME "Next"/Enter on the last field of a step** acts like **Continuer**. It never submits early.

### 3.2 Wizards to build or re-split

| Wizard | Steps (labels verbatim) |
|---|---|
| Nouvelle facture de vente | 5 steps; copy the step labels and field split from `src/pages/Invoices.tsx`. The client details are spread over short steps so that the client page never scrolls. |
| Nouvelle vente rapide (caisse) | 4 steps, same rule; source `src/pages/QuickSale.tsx`. |
| Nouvelle facture d’achat | `Scanner` · `Fournisseur` · `Adresse & date` · `Articles` · `Notes & validation`. Step 1 (scan) is optional and can be skipped. **After a successful scan that filled at least one field, wait 700 ms, then move to `Fournisseur` automatically** so the user reviews the pre-filled data. A failed scan stays on step 1 and shows the failing OCR stage inside the dialog. |
| Créer un produit / Demander un produit à l’Admin | `Produit` · `Stock` · `Prix` (for a user who cannot create directly, step 3 is `Photo`). Step 1: name (required), barcode and category for direct creation. Step 2: unit, initial stock (≥ 0), optional second unit and quantity per unit. Step 3: prices for direct creation, plus an optional photo. Errors are verbatim: "Indiquez au moins le nom du produit." / "Indiquez une unité et un stock initial valides (≥ 0)." |
| Nouvelle écriture (Balance) | Keep the existing 2 steps. Step 2 uses the new date picker (§5). |

---

## 4. Settings: block leaving while unsaved, save at the top

- **Remove the "Langue" entry from the Settings list.** The language line stays only where it already lives (profile and user menu), with the "coming soon" text from §0.
- **Top save button:** the old bottom bar ("Cette section est à jour" plus the "À jour" button) is gone. Each section gets its actions **top-right in the app bar**, just like the floating actions on Products:
  - A 40 dp **top-actions** pill group (radius 12).
  - While dirty: a tonal **Annuler** that discards locally, never reloads and has the tooltip "Annuler les modifications", plus a filled **Enregistrer** (tooltip "Enregistrer cette section"). While saving, the label is "Enregistrement…".
  - When clean: a muted tonal **À jour** chip, 36 dp, radius 999, not clickable, with the tooltip "Cette section est à jour". After a save it reads **Enregistré** for 2 s, then returns to **À jour**.
- **Leave guard:** while a section is dirty, leaving that section is blocked. That includes:
  - another Settings entry;
  - a bottom-nav tab;
  - Back or predictive back;
  - a deep link;
  - closing the Settings sheet.

  In each case, stay on the section, **bounce the top-actions group** and show a compact banner under the app bar: title "Modifications non enregistrées", body "Enregistrez ou annulez avant de quitter". The user then chooses **Enregistrer** or **Annuler** at the top. After either, navigation works again.
- **Errors:** if a save fails, show the error, keep the section dirty and bounce the top-actions group.
- **Preferences that apply instantly** (theme, density, start tab and so on) are never "dirty" and never block.

---

## 5. Date pickers: one new design everywhere

Replace **every** platform `DatePickerDialog`, `MaterialDatePicker` and month spinner in the app with one shared Compose component, `AtlasDatePicker`, plus `AtlasDateRangePicker` and `AtlasMonthPicker`. Do the same for times with `AtlasTimePicker`. No screen may keep a platform date dialog.

### 5.1 Field (trigger)

- Height 46 dp, radius 12, 16 sp text, calendar icon at the end.
- Value format: `25 nov. 2026` (French short month, `d MMM yyyy`). The placeholder colour is `#757575`.
- Light: background white, 1 dp border `rgb(232,234,239)`, text `#0f172a`.
- Dark: background `rgb(32,32,36)`, border `rgba(255,255,255,.32)`, text `rgb(228,228,231)`.
- Focus ring: 3 dp, `rgba(100,116,139,.2)` (dark `rgba(255,255,255,.06)`).

### 5.2 Picker sheet (phones always use the bottom sheet)

- Modal bottom sheet with an 8 dp side inset, radius 22, a drag handle, and padding `8 16 16+navBar` dp. Slide-in takes 200 ms with `cubic-bezier(0.2,0.8,0.2,1)`. Scrim `rgba(15,23,42,.38)`, fading in over 160 ms.
- **It must stack above any open sheet or dialog that opened it.** This was a real bug on mobile web: the picker opened *under* the form sheet. Test it explicitly.
- **Header:**
  - a round "previous month" button on the left and a round "next month" button on the right;
  - centred "Novembre 2026" with a chevron. Tapping the label switches to a **month grid**, then to a **year grid**.
- **Weekday row:** `Lu Ma Me Je Ve Sa Di`, Monday first, muted `#64748b`.
- **Day cells:** 38 dp tall and circular. Days of other months use the faint colour `#b4bcc8`. Days outside `min`/`max` are disabled.
  - Today: a ring in `#0f172a`.
  - Selected: filled `#0f172a` with white text. Dark: `#f4f4f5` with text `#0f172a`.
- **Range picker:** the band between the ends uses `#f1f5f9` (dark equivalent from `--pk-band`). Ends are pill caps. Rows start and end with rounded corners. Presets appear as a horizontally scrolling chip row above the calendar.
- **Footer:** a tonal **Aujourd’hui** pill on the left and a text-styled-but-still-a-button **Effacer** on the right. **Effacer** appears only when the field is optional. Picking a day closes the sheet at once.
- **Back closes the picker only** (see §2.2).
- **Colour tokens:** take them all from `--pk-*` in `form-controls.css`, both light and dark blocks.

### 5.3 Where

Every date field on every screen, including:
- Balance "Nouvelle écriture" (Date);
- the report bundle "Du"/"Au" (with `max = today`, and `Au` having `min = Du`);
- attendance;
- payroll (month);
- invoice and quick-sale detail (due and payment dates);
- scan;
- Settings (fiscal year and any dates);
- every filter that takes a period.

---

## 6. Sheet buttons and fields (all dialogs and sheets)

- **Footer row:** one row of pills, never stacked, never bare text. Height **44 dp**, radius **999**, 14 sp, weight 650, gap 8 dp.
  - **Last button = primary:** filled `#0f172a` with white text. Dark: `#f4f4f5` with text `#0f172a`.
  - **Other buttons (Annuler, Retour, Fermer) = tonal:** `#f4f4f5` with text `#0f172a` and a 1 dp `#e4e4e7` border. Dark: `rgb(38,38,43)` with text `#f4f4f5` and a 1 dp `rgba(255,255,255,.1)` border.
  - **Destructive confirmations** ("Se déconnecter", "Supprimer"…) use a red primary: `#dc2626` in light, `#ef4444` in dark, white text.
  - **Widths:** with two buttons, both share the width equally. With three buttons, the tonal ones wrap their label (16 dp side padding) and the primary takes all remaining width. The primary label must **never** be ellipsized; "Enregistrer" was cut to "Enregis…" on web before this fix.
  - Disabled buttons show at 50% opacity.
- **Fields in sheets:** 46 dp height, radius 12, 16 sp, weight 500 (selects too, no bold platform look). Colours match §5.1. Labels use the normal text colour (`#18181b`, dark `#f4f4f6`), 13 sp, weight 600. Error text: `#b91c1c` (dark `#fca5a5`).
- **Exposed dropdowns** (unit, payment method, start tab and so on) look exactly like the text fields, with a 16 dp chevron 12 dp from the end in `#64748b`.
- **Row actions inside cards and lists:** a labelled tonal pill for the main action (for example "Modifier"), 32 dp icon buttons for secondary actions, and a red round delete with "tap again to undo" behaviour. This matches the Products row style.

---

## 7. Products grid ("Grille")

Rebuild the grid view to match web exactly:

- **Columns:** adaptive grid with a minimum card width of 236 dp and 16 dp gaps. That gives 1 column on a phone, 2 on large phones in landscape, and 3 or more on tablets.
- **Card:**
  - a photo area (the product image, or the existing neutral placeholder; never a generated image);
  - the name;
  - the SKU or barcode;
  - the price;
  - a stock pill: "En stock" or the low/out-of-stock variants, with the same colours as the list.
  - **Untracked products show no stock pill and never a stray "0".** This was a real bug: a 0/1 flag was rendered as text.
- **Selection:** a "Tout sélectionner" 36 dp pill above the grid, with a count chip reading "N sélectionné" or "N sélectionnés" once anything is selected. Each card has a round 24 dp check chip in the photo corner. On touch it is always visible. A selected card gets a 2 dp ring and a slightly dimmed photo.
- **Actions per card:** the labelled **Modifier** pill, 32 dp icon buttons (**Ajuster le stock**, which appears only for tracked products, and **Étiquette**), and the red round **Supprimer** with timed undo. The accessibility labels are verbatim: "Modifier {nom}", "Ajuster le stock de {nom}", "Étiquette de {nom}", "Supprimer {nom}", "Sélectionner {nom}".
- **Opening a product:** tapping the card body opens the product history.
- The Grille/Liste toggle stays where it is today and persists its choice.

---

## 8. Done checklist (report each line)

- [ ] Bounce: dirty sheets refuse scrim, swipe and Back (including predictive back), and shake. Errors shake. Reduced motion uses the red outline instead.
- [ ] A picker inside a dirty sheet: the first Back closes only the picker.
- [ ] Wizards: invoice 5, quick sale 4, bill 5 (auto-advance after a good scan), product 3. No step scrolls at 360×740 dp.
- [ ] Settings: "Langue" removed; Annuler/Enregistrer/À jour top-right; leaving while dirty is blocked with the banner and the bounce.
- [ ] Every date, month and time field uses the new pickers. Not one platform dialog is left (prove it with a grep for `DatePickerDialog`, `MaterialDatePicker` and `TimePickerDialog`).
- [ ] The picker opens above the sheet that opened it.
- [ ] Sheet footers are 44 dp pill rows, the primary is never truncated, and logout is red.
- [ ] Products grid as in §7, with no stray "0".
- [ ] Screenshots of every changed screen in light and dark.
- [ ] Lint 0/0 and all tests green. Version still 0.9.3.
