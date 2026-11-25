# Atlas Commerce Android — welcome screen + guided tour (strict prompt)

> Paste this whole file as the task for the agent working in `Etherealmber/atlas-commerce-android`.
> Goal: the Android app gets **the same welcome flow and the same guided tour as the mobile web version** (`/welcome` and `/m` on a phone). Same steps, same copy, same order, same look, in light and dark.
> If this file conflicts with an older Android onboarding prompt, this file wins.

---

## 0. Rules (read first)

- **Copy everything.** Same steps, same French text (verbatim, including `’` and `« »`), same icons (Lucide, through `AtlasIcons`), same button labels, same order. Do not shorten, reword or add steps.
- **No excuse text.** Never write "bientôt", "non disponible", "ouvrir dans le navigateur" or similar anywhere in these screens.
- **The tour is a demo only.** It must not call the API, write to Room or DataStore (except its own progress key) or create anything. Every tour card shows the demo line from §3.3, verbatim.
- **No jumping.** The tour card must never appear in one place (centre, or over a skeleton) and then move. It stays invisible until the screen has settled (§3.4). **This is the bug we just fixed on the web. Do not reintroduce it.**
- **Light mode and dark mode both have to look finished.** Check every step in both before you report.
- **0 lint warnings and 0 errors** (`./gradlew lint ktlintCheck detekt` or whatever the repo already runs). All existing unit tests must stay green.
- **Do not bump `versionName` or `versionCode`.** The version stays **0.9.3**.
- **No backend changes are needed.** If you think one is, stop and write a backend prompt instead of faking it on the client.

---

## 1. Sources of truth (web repo `Etherealmber/atlas-commerce`, branch `main`)

| What | Path |
|---|---|
| Welcome flow (5 steps) | `src/mobile/PhoneWelcome.tsx` |
| Guided tour (6 steps), settle logic, card side | `src/mobile/PhoneOnboarding.tsx` |
| Styles, colours, sizes, animations | `src/mobile/phone-welcome.css` (`.pw-*` = welcome, `.po-*` = tour) |
| Progress storage and replay API | `src/lib/onboarding.ts` (`atlas_phone_onboarding`) |
| Replay button | `src/mobile/PhoneSettings.tsx` → **Visite guidée** |
| Tests that define the behaviour | `src/__tests__/phone-welcome-onboarding.test.ts` |
| **Reference screenshots** (390×844, light and dark) | `docs/mobile-welcome-reference/welcome-{1..5}-*-{light,dark}.webp`, `tour-{1..6}-*-{light,dark}.webp` |

When a screenshot does not show a state (pressed, focus, TalkBack), the web code is the spec.

### 1.1 Where it goes in the Android repo

- `ui/components/AtlasOnboarding.kt` already has `AtlasWelcomeOnboardingScreen` (slides, preferences, a 3-step tutorial). **Replace its content flow** with the 5 steps in §2. Keep the public signature where you can (`themeMode`, `onThemeSelected`, `onComplete`, `isLoggedIn`), so `MainActivity` and the call sites keep compiling. Delete the old slides, the 8-second auto-advance, the density/crash-report choices on this screen and the old 3-step tutorial once nothing uses them. **Remove dead code; do not leave it commented out.**
- The tour is a **new** composable, `ui/components/AtlasGuidedTour.kt`, drawn as an overlay on top of `MainShell` (above the floating dock and the top bar, below system dialogs).
- Progress goes in `core/persist/AtlasPreferences.kt` (DataStore). Do **not** reuse `server_onboarding_done`, which belongs to the server setup.

---

## 2. Welcome flow — 5 steps

Shown once, after the first login on this device, before `MainShell`. Full-screen, no top bar, no dock.

### 2.1 Layout (all steps)

- Background `#F4F5F7` light / `#111113` dark. Cards `#FFFFFF` / `#1C1C1F`. Text `#18181B` / `#F4F4F5`. Muted `#71717A` / `#A1A1AA`. Lines `#E4E4E7` / `#2A2A2E`. Soft fill `#F4F4F5` / `#27272A`. Primary button: background `#18181B`, text `#FAFAFA` in light; background `#F4F4F5`, text `#111113` in dark.
- **Header row** (height 56 dp, under the status bar): Atlas mark on the left; **progress dots** in the centre (7×7 dp circles, the active dot is a 22 dp pill, done dots use the muted colour); **Passer** on the right (pill, 1 dp line border, card background). It is a button, so it must not look like a link.
- **Footer** (above the navigation bar, 16 dp side padding): a **round ghost back button** (← icon, 52 dp) plus a **full-width primary button** with a → icon, 52 dp tall, 16 dp radius.
  - **Step 1 has no back button.** The primary button takes the full width.
- Content scrolls if needed; the footer never scrolls.
- Changing step: content fades and slides 12 dp horizontally (220 ms). Respect "remove animations" (`LocalAtlasAnimationsEnabled`).
- The step title gets accessibility focus on each step change, with **no visible focus ring** on "Bonjour".
- The system back gesture goes to the previous step. On step 1 it does nothing; it does not exit the app.

### 2.2 Steps and copy (verbatim)

| # | id | Kicker | Title | Body |
|---|---|---|---|---|
| 1 | `hello` | — | **Bonjour, {prénom}** (or **Bonjour** if there is no name; the first name is the first word of the display name) | "Atlas Commerce dans votre poche : scanner, vendre et suivre votre stock, où que vous soyez." Then 3 chips: **Synchronisé avec le bureau**, **Fonctionne hors ligne**, **v0.9.3-beta**. |
| 2 | `theme` | Apparence | **Choisissez votre thème** | "Modifiable à tout moment dans Profil → Réglages." Then 3 option cards (radio group). Each card has an icon, label, hint and a check circle on the right: **Clair** / "Surfaces blanches, idéal en journée" (Sun); **Sombre** / "Charbon neutre, repose les yeux" (Moon); **Système** / "Suit le réglage du téléphone" (Monitor). **Tapping a card applies the theme immediately** (`onThemeSelected`), and the whole screen recolours. |
| 3 | `features` | Sur votre téléphone | **L’essentiel, au bout du pouce** | A list of cards, **filtered by role** (same rule as `phoneWelcomeFeatures()`). **Scanner** (ScanLine): "Visez un code-barres : la fiche produit, le stock et l’historique s’ouvrent." Only if the user can manage stock or the role is `stock`. **Produits & stock** (Package): "Cherchez, filtrez les ruptures et proposez un ajustement au bureau." Always shown. **Vente rapide** (ShoppingCart): "Un ticket, un paiement : la caisse et le stock se mettent à jour." Only if the user can sell. **Atlas Agent** (Bot): "« Rapport du jour », « Stock bas ? » : l’agent prépare, vous confirmez." Always shown. Under the list: "Factures, devis, paie et rapports complets restent sur ordinateur." |
| 4 | `shots` | Captures réelles | **Voici à quoi ça ressemble** | A horizontal snap carousel (`HorizontalPager`, peek of the next card) of **real screenshots of the Android app**, not SVG mockups, plus small pager dots. Cards: **Accueil** / "Trésorerie, stock et alertes en un coup d’œil."; **Produits** / "Catalogue, seuils bas et réapprovisionnement."; **Scan** / "Code-barres → fiche produit en une seconde."; **Balance** / "Recettes, dépenses et caisse au même endroit." Take the screenshots from the real app with demo data, in light mode. The web uses the same 4 images in both themes; do the same. |
| 5 | `ready` | — | **Tout est prêt** | "Thème : **{Clair/Sombre/Système}**. Vos choix sont enregistrés sur ce téléphone." Then an info card with a Compass icon. Title **Visite guidée mobile**; text "Elle démarre à l’ouverture : accueil, barre du bas, scan, menu rapide, Atlas Agent et profil. C’est une simple démonstration : elle n’ajoute rien à votre base de données et vous pouvez la passer à tout moment." Under the card, a secondary button **Ouvrir sans la visite**. |

Primary button labels: **Commencer** on step 1, **Continuer** on steps 2–4, **Ouvrir Atlas** on step 5.

### 2.3 What finishing does

| Action | Welcome | Tour |
|---|---|---|
| **Ouvrir Atlas** (step 5) | mark done | set to `pending`, step 0 |
| **Ouvrir sans la visite** or **Passer** (any step) | mark done | set to `done` |

- Save the current welcome step, so that rotation or process death returns to the same step.
- The welcome flow is shown only while the welcome is not done. Logging out does **not** reset it.

---

## 3. Guided tour — 6 steps

Runs on top of `MainShell` on the **Home** tab, right after the welcome (or when replayed from Settings). It points at real UI elements with a spotlight and a card.

### 3.1 Steps and copy (verbatim)

| # | id | Target (Android) | Title | Body |
|---|---|---|---|---|
| 1 | `home` | Home hero card (treasury/stock summary at the top of `HomeScreen`) | **Votre accueil** | "Trésorerie ou stock, alertes et derniers documents : l’essentiel de la journée, mis à jour depuis le serveur. Touchez ↻ pour actualiser." |
| 2 | `dock` | The whole floating bottom dock | **La barre du bas** | "Accueil, Produits, Scan, puis Balance et Employés selon votre rôle. Elle reste visible sur les pages principales." |
| 3 | `scan` | The centre **Scan** button of the dock | **Scanner un code-barres** | "Le bouton central ouvre la caméra : la fiche produit, le stock et l’historique s’affichent. Un ajustement part en demande vers le bureau." |
| 4 | `quick` | Quick-actions ball (notifications / new sale / clients) | **Le menu rapide** | "Notifications et actions en attente, nouvelle vente et clients, en un toucher depuis n’importe quelle page principale." |
| 5 | `agent` | Atlas Agent button in the floating top bar | **Atlas Agent** | "« Rapport du jour », « Quels articles sont en rupture ? »… L’agent prépare la réponse ou l’action, vous la confirmez." |
| 6 | `profile` | Profile avatar button in the top bar | **Profil et réglages** | "Photo, thème, taille du texte et page d’ouverture. Vous pourrez revoir cette visite depuis Réglages → Visite guidée." |

- If the top bar is collapsed and the target (agent, profile) is inside it, **expand the bar first** (same animation as a user tap), then measure.
- If the user's role hides a target (for example no Scan button), keep the step and show the card **centred, with no spotlight**. Do not skip silently and do not crash.

### 3.2 Card and spotlight

- **Spotlight:** a rounded cut-out around the target (8 dp padding, 18 dp radius), with a 2 dp ring in the text colour. The rest of the screen is dimmed with `#09090B` at 50 %.
- **Shield:** a full-screen transparent layer that **eats every touch**, so the user cannot open pages, start a sale or change data during the tour. Only the card's buttons work.
- **Card:** 12 dp from the left and right edges, max width 520 dp, 22 dp radius, padding 16/16/14 dp. Background `#FFFFFF` / `#1C1C1F`, 1 dp line border. Soft shadow (`0 24 60 -18` at 45 % black in light, 75 % in dark).
- **Card content, top to bottom:**
  - **Header row:** Compass icon, then **VISITE GUIDÉE · n / 6** (11 sp, uppercase, letter-spaced, muted), then an × close button on the right that does the same as Passer.
  - **Title:** 18 sp, bold.
  - **Body:** 14.5 sp, muted, 1.5 line height.
  - **Demo line** (§3.3), in a soft-fill box with 12 dp radius and 12.5 sp text.
  - **Progress:** 6 segments, 4 dp tall, 4 dp gap. Done segments are muted, the active one uses the text colour, the rest use the line colour.
  - **Footer:**
    - left: **Passer** (outlined button, 44 dp);
    - right: **←** (icon button, outlined, hidden on step 1), then **Suivant →** (primary). On the last step the primary button reads **Terminer ✓**.
- **Which side the card goes on:** the opposite side from the target.

  ```
  side = if (target == null) CENTER
         else if (target.centerY > screenHeight / 2) TOP else BOTTOM
  ```

  - BOTTOM and CENTER: the card bottom sits 84 dp above the navigation-bar inset.
  - TOP: the card top sits 72 dp below the status-bar inset.
  - The card must never cover its target. Step 3 (Scan, at the bottom) shows the card at the top. Steps 1, 4, 5 and 6 show it at the bottom.
- **Entrance:** fade plus 10 dp slide (from below for BOTTOM, from above for TOP), 260 ms, `cubic-bezier(0.16, 1, 0.3, 1)`. **Only the entrance animates.** The card never animates from one position to another.
- **Accessibility:**
  - The card is a dialog.
  - TalkBack reads "Visite guidée, étape n sur 6, {title}".
  - Focus moves to **Suivant** when a step appears.
  - The system back gesture goes to the previous step; on step 1 it does the same as Passer.

### 3.3 Demo line (verbatim, on every card)

> Démonstration uniquement : rien n’est ajouté à votre base de données. Vous pouvez passer la visite à tout moment.

### 3.4 Settle rule (no jump)

The tour must wait until Home has really finished loading. In order:

1. The card exists but is **invisible** (alpha 0) and **not clickable**. The dim and the spotlight are not drawn yet. The shield is already active.
2. Every **120 ms**, read the target's bounds (`Modifier.onGloballyPositioned` → `boundsInRoot`, or a shared `TourTargetRegistry` keyed by step id).
3. The step is **settled** when **both** of these are true:
   - the bounds have been identical (±1 px) for **3 ticks in a row**;
   - **no skeleton/shimmer is visible**: `HomeViewModel` is not loading, and no `AtlasSkeleton` or placeholder is on screen. Expose a single `isShimmering` state for this, and do not guess with delays.
4. When it settles, compute the side **once**, then show the dim, the spotlight and the card with the entrance animation.
5. **Safety cap:** after **4 s** show it anyway. Use the target's current bounds, or CENTER if there is no target.
6. If the target moves after settling (rotation, keyboard, font scale), update the spotlight and side **without** replaying the entrance.

Changing step resets this: hide → measure → settle → show.

### 3.5 Visibility rules

- Only while the tour is `pending`, and only on the **Home** tab. When the tour starts, switch to Home once.
- Hide the whole overlay, without losing the step, while any blocking dialog or bottom sheet is open: the What's new dialog, update prompt, logout confirm or permission dialogs. Bring it back with the settle rule.
- The **Nouveautés** (What's new) dialog must **wait** until the welcome and the tour are done. Never show both at once.
- The tour is the same for every role. Only the targets differ (§3.1).

### 3.6 Replay

- In **Réglages**, add a row **Visite guidée** (Compass icon, chevron) under Apparence/Affichage. Tapping it sets the tour to `pending`, step 0, closes Settings and goes to Home. The tour then starts with the settle rule.

---

## 4. Storage (DataStore, `AtlasPreferences.kt`)

| Key | Type | Values |
|---|---|---|
| `mobile_welcome_completed` | Boolean | `false` until the welcome is finished or skipped |
| `mobile_welcome_step` | Int | 0–4, the last step shown |
| `mobile_onboarding_status` | String | `"pending"` or `"done"` (absent = never queued) |
| `mobile_onboarding_step` | Int | 0–5 |

- These are **device-local**. Do not sync them through `MobilePreferencesSync` and do not send them to the server.
- Add them to the "clear local data" / diagnostics reset path.
- Expose suspend functions that mirror the web API:
  - `queueMobileOnboarding()`
  - `restartMobileOnboarding()`
  - `setMobileOnboardingStep(n)`
  - `finishMobileOnboarding()`
  - `mobileOnboardingPending: Flow<Boolean>`

---

## 5. Tests you must add (JVM unit tests + Compose UI tests)

1. **Welcome:**
   - 5 steps in order.
   - Step 1 has no back button.
   - Labels: Commencer / Continuer / Ouvrir Atlas.
   - Choosing **Sombre** calls `onThemeSelected(DARK)` right away.
   - The feature list is filtered by role: a `stock` role sees Scanner but not Vente rapide; a cashier sees Vente rapide.
2. **Finishing:**
   - Ouvrir Atlas → welcome done, tour `pending` at step 0.
   - Passer and Ouvrir sans la visite → welcome done, tour `done`.
3. **Card side:**
   - `cardSide(null, h) == CENTER`
   - a top target gives BOTTOM
   - a bottom (dock) target gives TOP
4. **Settle:**
   - With `isShimmering = true`, the card stays invisible (alpha 0, no click) even after the bounds are stable.
   - After shimmer ends and 3 stable ticks, it becomes visible **once**.
   - With a target that never appears, it shows CENTER after 4 s.
   - Use a virtual clock (`mainClock.advanceTimeBy`), not sleeps.
5. **Demo only:**
   - The shield consumes taps on the dock during the tour.
   - Each card contains the demo line.
   - The tour code has no repository or API dependency.
6. **Buttons:**
   - Suivant advances and persists the step.
   - ← goes back.
   - Passer and × set `done` and remove the overlay.
   - The last step shows Terminer.
7. **Replay:** Réglages → Visite guidée sets `pending`/0 and navigates to Home.
8. **What's new** is not shown while the welcome or the tour is pending.

---

## 6. Report format (mandatory)

Reply with:

1. The list of files you changed, added or deleted.
2. A table with one row per screen per theme: 5 welcome steps and 6 tour steps, × light/dark = **22 rows**. Columns: screen | theme | matches the reference PNG (yes/no) | notes. Attach your own screenshot for each row at 390×844 dp (or the closest device), with the same demo data.
3. A short video or GIF, or a frame list with timestamps, of the tour starting on a **slow network** (add a 1.5 s delay to the Home request). It must show the skeleton, then the card appearing **once**, in its final place.
4. Lint, detekt and unit test results (counts).
5. Any open question. Do not guess on anything that would change behaviour.
