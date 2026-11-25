# Atlas Commerce Android: new look + demo access (`test` / `test`) + reports routing (strict prompt)

> Paste this whole file as the task for the agent working in **`Etherealmber/atlas-commerce-android`** (Kotlin, Jetpack Compose).
> Goal: the Android app **matches the 0.9.3 web look** (login, menus, Settings, About) and supports **demo access**: anyone can try the app with `test` / `test` on a fictitious, isolated database. Android reports must go to the **Android repo**.
> The backend is **already live**. **No backend change is needed.** Every endpoint below was checked against a fresh demo sandbox with native headers.

---

## 0. Rules

- **Copy, do not reinterpret.** Use the French texts below verbatim, including `’`, `…`, `—` and `·`. Add English/Arabic through the existing `atlasText(fr, en, ar)` helper; the French string is the reference.
- **Never mix demo and real sessions.**
  - Never save a demo token as a "saved account".
  - Never use it for biometric or passkey enrolment.
  - Never write it over a real session. Keep it in its own slot (for example `DemoSessionStore`) and restore the previous real session state after leaving the demo.
- **No extra network calls** for the new look. Reuse what each screen already loads. The demo adds exactly one optional call: `GET /api/demo/config`.
- **Lint and tests:**
  - 0 lint warnings and 0 errors.
  - Existing tests stay green.
  - Add the tests listed in §8.
- **Version:** do not bump `versionName` or `versionCode`. The app stays **0.9.3**.
- **Device fingerprint:** reuse the fingerprint the app already sends to `AuthRepository.login(…)`. Never generate a new one per attempt, because the demo quota is counted per fingerprint.

---

## 1. Sources of truth (web repo `Etherealmber/atlas-commerce`, branch `main`)

| What | Path |
|---|---|
| Demo gateway (login, quota, token wrapping, off-limits actions) | `worker/lib/demo/gateway.ts`, `worker/lib/demo/policy.ts` |
| Web login: demo card, button states, error texts | `src/pages/Login.tsx` (`REASON_MESSAGES`, `.atlas-login-demo`), `src/styles/login-auth.css` |
| Web demo session: countdown chip + intro dialog | `src/context/DemoContext.tsx`, `src/lib/demoSession.ts`, `src/styles/demo-session.css` |
| Side menu / rail / scrim | `src/components/FocusSidebar.tsx`, `src/styles/focus-sidebar.css` |
| About stats grid | `src/pages/About.tsx` |
| Backup status strip | `src/components/settings/BackupStatusStrip.tsx`, `src/styles/backup-panel.css` |
| Report routing (web vs android) | `worker/lib/reports.ts` (`classifyReportChannel`), `docs/reports-github.md` |

---

## 2. Demo access on the Login screen

### 2.1 Config (optional, one call when Login opens)

`GET /api/demo/config` returns:

```json
{ "success": true, "data": { "enabled": true, "highlight": false, "username": "test", "password": "test",
  "minutes": 60, "window_hours": 24, "message": "Mode démo : 1 heure d’essai…" } }
```

- If the call fails or `enabled` is false, show nothing.
- `highlight` is true on local and preview servers. The card is also highlighted when the server says no real password is configured yet.

### 2.2 Demo card (password step only, under the error/info banner, above the fields)

Layout:
- Full width.
- Text on the left: title **« Essayer sans compte »** (semibold), then **« Identifiant `test` · mot de passe `test` — 1 h de test toutes les 24 h, sur une base fictive réinitialisée ensuite. »**. Take the values from the config. Render `test` in small monospace chips.
- A **« Remplir »** pill on the right fills both fields. It does not submit.

Styling:

| | Light theme | Dark theme |
|---|---|---|
| Normal | 1 dp **dashed** border `#0A0A0A` at 18 % alpha, background `#0A0A0A` at 3 %, text `#3F3F46` | dashed border `#FAFAFA` at 22 %, background `#FAFAFA` at 4 %, text `#D4D4D8` |
| Highlighted | **solid** border `#F97316` at 55 %, background `#F97316` at 10 % | same |
| Shape and spacing | radius 12 dp, padding 10/10/10/14 dp | same |
| « Remplir » pill | radius 999, 1 dp border at 25 % of the text colour, transparent fill, pressed fill at 10 % | same |

Hide the card while the passkey/biometric offer or the OTP step is showing.

### 2.3 Login call (unchanged)

```
POST /api/auth/login
{ "username": "test", "password": "test", "fingerprint": "<stable>", "client": "native" }
```

- Send the usual headers (`X-Atlas-Client: native`, `X-Device-Fingerprint`).
- **No OTP** is ever asked for the demo, so `needs_otp` is false.
- Turnstile is not required for native clients.

### 2.4 Success response

The success response is a normal `LoginResponse` plus the following:
- `token` starts with **`atlasdemo.`**. Use it as a normal bearer token. The server routes every request to the isolated demo database.
- `displayName` = **« Compte démo »** (`display_name` is also sent).
- `message` is the intro text from §2.1.
- A `demo` object:

  ```json
  "demo": { "active": true, "state": "new|active", "minutes": 60, "window_hours": 24,
            "started_at": 1760000000000, "expires_at": 1760001200000 }
  ```

  The timestamps are **epoch milliseconds**. Add `@Json(name = "demo") val demo: DemoInfoDto? = null` to `LoginResponse`.

**After a demo login:**
- Skip the "biométrie / clé de sécurité" offer.
- Skip the saved-accounts upsert.
- Go straight to Home.

### 2.5 Errors

Always show `error` from the response body. Use these fallbacks only when `error` is blank. They match the web `REASON_MESSAGES`.

| HTTP | `code` | Fallback text |
|---|---|---|
| 429 | `DEMO_QUOTA` | « Trop d’essais de démo depuis ce réseau aujourd’hui. Réessayez demain. » |
| 401 | `DEMO_EXPIRED` | « Votre heure de démo est terminée : la base fictive a été réinitialisée. Nouvel essai possible dans 24 h. » |
| 503 | `DEMO_UNAVAILABLE` | « Le mode démo est momentanément indisponible. Réessayez plus tard. » |
| 403 | `DEMO_DISABLED` | « Indisponible en mode démo : les sauvegardes et restaurations ne concernent que votre vraie base. » |

Notes:
- A 429 for a single device has `error` like « Vous avez déjà utilisé votre heure de démo pour aujourd’hui. Nouvel essai possible dans 3 h 05. » and an optional `retry_at` (ms). Show the server text as is.
- `DEMO_DISABLED` only happens inside a demo session, for « Sauvegarder maintenant » or a restore. Show it as a snackbar and stay on the screen.

---

## 3. Login look (new 0.9.3 states)

The primary button (**« Se connecter »**) must stay readable in **every** state. The pressed state is no longer an invisible label on a light fill.

| State | Light theme | Dark theme |
|---|---|---|
| Normal | container `#0A0A0A`, label and icon `#FAFAFA` | container `#FAFAFA`, label and icon `#0A0A0A` |
| Pressed | container `#27272A`, scale 0.98 | container `#D4D4D8`, scale 0.98 |
| Disabled | container `#3F3F46` at 70 % alpha, same label colour | container `#D4D4D8` at 60 % alpha, same label colour |
| Loading | keep the normal container and show the spinner in the label colour | same |

Rules for the button:
- Use `MutableInteractionSource` + `collectIsPressedAsState()`.
- No ripple tint that changes the label colour.
- Touch screens have no "hover" state: the colour returns to Normal as soon as the finger lifts.

Username field: typed text must be clearly visible.
- Light theme: `#0A0A0A` on `#FFFFFF`.
- Dark theme: `#E4E4E7` on `#202024`.
- Placeholder at 55 % of the text colour.
- Never grey-on-grey, including when autofilled.

---

## 4. Demo session UI

### 4.1 Intro sheet

Show the intro sheet once per demo session, when `demo.state == "new"`, and again from the chip's « i » button. Use a modal bottom sheet on phones and a centred dialog (max 440 dp) on tablets.

Content:
- Badge **« MODE DÉMO »**.
- Title **« 1 heure pour tout essayer »**.
- Four bullets (the bold part in bold):
  - **1 heure d’essai**, une fois toutes les 24 heures sur cet appareil.
  - **Données fictives** : créez, modifiez ou supprimez librement produits, ventes, clients…
  - **Remise à zéro automatique** : la base de démo est effacée au bout de 1 heure.
  - **Aucun accès à vos vraies données** : la démo tourne sur sa propre petite base SQLite.
- « Temps restant : **mm:ss** » under the bullets, ticking each second.
- One button, **« Commencer la démo »**: filled pill, full width, same colours as §3.

### 4.2 Countdown chip

The chip appears on every signed-in screen.
- **Position:** start side, 16 dp from the edge, **above** the bottom navigation bar (or 16 dp above the system bar when there is none). Respect insets.
- **Contents:** a pulsing 8 dp dot, « DÉMO » (11 sp, uppercase, letter-spacing 0.04 em), `mm:ss` (13 sp, tabular numbers), an « i » icon button (reopens §4.1) and a **« Quitter »** pill.
- **Size and shape:** height 36 dp, radius 999.
- **Colours:**

| Element | Light theme | Dark theme |
|---|---|---|
| Container | `#0F172A` | `#FAFAFA` |
| Text | `#F8FAFC` | `#0A0A0A` |
| « DÉMO » label | `#FDBA74` | — |
| Dot | `#F97316` | — |

- **Last 3 minutes:** the dot turns `#EF4444` and the time turns `#FCA5A5`.
- The chip never covers a FAB: shift it up when a FAB is present.

### 4.3 End of session

- At `expires_at`, or on **any** `401 DEMO_EXPIRED` from any endpoint:
  - clear the demo token;
  - go to Login with the `DEMO_EXPIRED` text;
  - never retry with the old token.
- « Quitter »: clear the demo token locally and go to Login (no server call).
- A demo session is not kept across app restarts once `expires_at` has passed.

---

## 5. Menus, rail and About (the web "never move the page" rule)

1. **Opening any hamburger, drawer or menu must never move, resize or re-layout the screen behind it.**
   - Use an overlay (`ModalNavigationDrawer`, or a `Popup` / `DropdownMenu`), never a `Row` that pushes the content.
   - The top app bar keeps the same height, position and title while the menu is open.
   - Scroll position is preserved when it closes.
2. **Scrim** behind side menus: `#05070C` at **52 %** alpha in both themes. It stays translucent, so the screen behind stays visible. Never use an opaque grey slab. Tapping the scrim closes the menu.
3. **Tablet rail** (`TabletNavigationLayout`, `SidebarNavigation`):
   - 244 dp expanded, 62 dp collapsed;
   - items about 30 dp high with 9 dp radius;
   - the selected item is filled: `#0F172A` with white text in light, a light pill with dark text in dark;
   - the collapse button is 30 × 30 dp and the top-bar menu (hamburger) button is 36 × 36 dp with 12 dp radius;
   - collapsing animates the width only. The content area changes width, but nothing inside it jumps vertically.
4. **About screen:** the four stat cards are a **2 × 2 grid on every phone width** (two equal columns, 12 dp gap), never a single column. The cards are:
   - « Version active » (`v0.9.3-beta`, « Publiée le … »);
   - « Modules métier » (`12`, « Stock · Ventes · Finance · Mobile »);
   - « Infrastructure » (« Edge · D1 · R2 »);
   - « Contributeurs ».

   Long values wrap inside their card. Keep the cards in each row the same height.

---

## 6. Settings (new look)

- **Section headers and save buttons:** keep the existing top and inline save buttons. Primary buttons follow §3. Secondary buttons are outlined pills.
- **Backup card** (owner/admin only, optional; build it only if the Settings screen already has an admin area):
  - load `GET /api/admin/backups` **only when the card is opened** (R2 listing, no database reads);
  - show three stats:
    - « Dernière sauvegarde » (relative time, with a dot: green under 36 h, amber when older, grey when none);
    - « Taille »;
    - « Points de restauration » (count of keys under `backups/30m/`);
  - then three chips: « AES-256-GCM », « Toutes les 12 h », « Rétention 7 j »;
  - the button **« Sauvegarder maintenant »** calls `POST /api/admin/backup-now`. In demo it returns `DEMO_DISABLED` (§2.5).
  - Do not build restore on Android.
- **Reports:** the app never stores or shows GitHub tokens. The Worker owns them (one repo and one token per app). Nothing to configure on the phone.

---

## 7. Crash reports and user reports → Android repo

The server keeps **one GitHub repo and one token per app**. Android reports go to `Etherealmber/atlas-commerce-android`, web reports to `atlas-commerce`. The routing uses an explicit `platform` field first and the User-Agent only as a fallback.

- Add **`val platform: String = "android"`** to `UserReportRequest` (`kind`, `message`, `contact`, `page`, `version`, **`platform`**). Every `POST /api/reports` from the app must send it.
- If the app ever posts crashes to `POST /api/crash-reports`, use the body `{ message, stack?, componentStack?, route?, version?, ua?, platform: "android" }`:
  - `route` is the screen name (for example `ProductsScreen`);
  - `version` is `versionName`.
- Firebase crash reporting stays as is.
- Ignore crashes that originate inside a WebView page the app does not own.
- AI triage (title, probable cause, severity) runs server-side on new issues. The app does nothing for it.

---

## 8. Tests to add

- A demo login stores a token that starts with `atlasdemo.` in the demo slot only. It creates no saved account, shows no biometric/passkey offer, and leaves the real session untouched.
- `LoginResponse` parses the `demo` object (epoch ms) and `displayName = "Compte démo"`.
- The countdown reaches 0, the token is cleared, and Login shows the expired text. Any `401 DEMO_EXPIRED` from a repository call does the same.
- 429 / 401 / 503 / 403 demo codes show the server `error`, or the fallback text when it is blank.
- « Remplir » fills `test` / `test` and does not submit.
- Primary button colours per state and theme (§3). A screenshot or semantics test is fine.
- Opening the drawer or menu does not change the bounds of the top bar or the first content item (compare `onGloballyPositioned` before and after).
- The About stats are laid out in two columns at 320 dp, 360 dp and 411 dp widths.
- `UserReportRequest` JSON contains `"platform":"android"`.

## 9. Acceptance checklist

- [ ] `test` / `test` signs in on a real phone and on an emulator, against both the production server and a local `npm run dev` server (LAN address).
- [ ] The intro sheet shows once, the chip counts down, and « Quitter » and expiry both return to Login with the right text.
- [ ] Demo data (24 products, « Atlas Démo SARL ») is editable, and the real account's data never appears.
- [ ] The login button is readable in every state, in both themes.
- [ ] No screen moves when a menu opens, and the scrim is translucent.
- [ ] About shows 2 × 2 stat cards on phones.
- [ ] Reports from the app land in the Android repo.
- [ ] 0 lint warnings, all tests green, version still 0.9.3.
- [ ] Language switch fr / ar / en stays in sync between native and web (§10).

## 10. Languages: French, Arabic (RTL) and English

The web app now ships three UI languages: `fr` (default), `ar` (right-to-left) and `en`. The language picker lives in the user menu (« Langue »), in Settings › Langue, and in the Login footer. The Android app must offer the same three languages and keep them **in sync with the WebView** in both directions.

### 10.1 Bridge contract (already implemented on the web side)

| Direction | Call | When |
| --- | --- | --- |
| web → native | `window.AtlasAndroid.setLanguage("fr" \| "ar" \| "en")` | At boot, and every time the user picks a language in the web UI. |
| native → web (read) | `AtlasAndroid.getLanguage(): String` | Read once at web boot. Return `""` when the user never chose. |
| native → web (push) | `webView.evaluateJavascript("window.atlasSetLanguage('ar')", null)` | When the user changes language in a native screen. |
| native → web (alt.) | Load the URL with `?lang=ar`, or `postMessage({type:'atlas:set-language', lang:'ar'})` | First load, deep links. |

- The web persists the choice in `localStorage["atlas_lang"]` and fires a `atlas-language` window event.
- Unknown values are ignored. Never send `ar-MA` or `en-US`: send the bare code.
- Arabic sets `<html dir="rtl" lang="ar">`. Digits stay Latin (0-9) and amounts keep the `MAD 1 234,50` format, which matches the web.

### 10.2 Native work

1. `@JavascriptInterface fun setLanguage(lang: String)` saves to DataStore `ui_language` and calls `AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(lang))` on the main thread. Ignore calls whose value equals the current language, so you don't loop.
2. `@JavascriptInterface fun getLanguage(): String` returns the stored value.
3. Native picker: Settings › Langue with three rows (« Français », « العربية », « English »), each showing its native name with a radio button. When the language changes, call `window.atlasSetLanguage(code)` on every live WebView.
4. Add `res/values-ar/strings.xml` and `res/values-en/strings.xml` (French stays in `values/`). Set `android:supportsRtl="true"`. Use `start`/`end` everywhere and never `left`/`right`. Mirror directional icons with `autoMirrored="true"`. Keep numbers, SKUs, invoice numbers and phone numbers LTR with `BidiFormatter` / `TextDirectionHeuristics.LTR`.
5. Add `locales_config.xml` (fr, ar, en) so Android 13+ shows the per-app language in system settings. When the system locale changes, push it to the WebView as in item 3.
6. Errors: map the server `error` text as it is (the web translates its own copies). For native-only errors, provide all three translations.
7. User data (product, customer and employee names, document numbers) is **never** translated.

### 10.3 Tests

- `setLanguage("ar")` persists the value, switches the app locale and makes the layout direction RTL. Calling it a second time with the same value does nothing.
- A native picker change calls `atlasSetLanguage` on the WebView (verify with a fake WebView).
- At 360 dp in Arabic, the drawer opens from the right, back arrows point right, and amounts read `MAD 1 234,50` LTR.
- Every string in `values/strings.xml` exists in `values-ar` and `values-en` (lint `MissingTranslation` = error).

### 10.4 Checklist

- [ ] Switching to Arabic in the web user menu flips the native drawer and status texts to Arabic RTL with no restart.
- [ ] Switching in native Settings flips the WebView immediately.
- [ ] Kill and relaunch the app: the language is kept on both sides.

