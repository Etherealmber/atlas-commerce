# Atlas Commerce Android: animated login logo, larger lockups, dark-theme previews, touch states. Strict prompt

> Paste this whole file as the task for the agent working in `Etherealmber/atlas-commerce-android`.
> Goal: bring the **web 0.9.3 polish** to Android:
> - the login screen shows the **animated** Atlas lockup, larger and the same size in both themes;
> - every small logo (top bars, About / What's new / legal screens) plays the same intro and reacts to a tap;
> - feature previews follow the theme (dark screens show **dark** captures);
> - toolbar pills have a clean pressed state on touch and never overlap on narrow phones.
>
> This file **extends** `docs/android-brand-motion-prompt.md` (same geometry, colours and rules). Where they disagree, **this file wins**. In particular, §1 replaces that prompt's "collapsed beam shrinks to a tick" rule.

---

## 0. Rules (read first)

- **Keep the existing sunburst mark:** 15 radial ticks, a horizontal beam from the centre to 3 o'clock, then the "Atlas" wordmark. No new monogram, gold or glow.
- **No sound.** No Lottie, Rive, GIF or video. Use Compose only (`Canvas`, `Animatable`, `updateTransition`, `rememberInfiniteTransition`).
- **Crisp, not decorative:** no blur, no glassmorphism, no bounce or overshoot.
- **Reduced motion.** When `Settings.Global.ANIMATOR_DURATION_SCALE == 0f` or the in-app "Animations" toggle is off, show the final frame at once. That means no drawing, no idle wave and no tap ripple; a 360 ms fade-in is allowed.
- **Never render the wordmark with `Text`.** Use the outlined glyph paths from the web repo (`src/components/brand/atlasWordmark.ts`).
- 0 lint warnings and 0 errors. All tests stay green, and you add the tests in §7.
- **Do not bump `versionName` or `versionCode`** (it stays 0.9.3). No backend changes. Do not add AI-generated images.

---

## 1. Correction: the collapsed mark keeps its beam

The tablet rail's collapsed mark keeps the **full beam from the centre**. Do **not** scale it down to a tick.

Collapsing or expanding the rail plays this sequence (web: `.atlas-brand.is-morph-a|b`):

| Element | Animation |
|---|---|
| Beam | `scaleX` 1 → **0.08** (at 42 %) → 1, over **560 ms**, `CubicBezierEasing(0.22f, 1f, 0.36f, 1f)`, pivot at the **centre** `(126, 126)` |
| Ticks | ripple: alpha 1 → **0.18** (at 40 %) → 1, over 560 ms, tick `i` delayed by `120 ms + i × 22 ms` |
| Wordmark | folds into the mark exactly as in the earlier prompt (§5.1, steps 1–2) |

Every toggle restarts the sequence, even if the previous one has not finished.

---

## 2. The intro (all logos), web `useBrandIntro` + `.atlas-intro-play`

It plays **once per screen appearance**. Starting state: ticks and beam undrawn (path trim 0), wordmark clipped to width 0, each glyph at alpha 0 and shifted `-35 %` of its own width.

| Step | Duration | Delay | Easing |
|---|---|---|---|
| Tick `i` (`i = 0…14`, clockwise from 3 o'clock) draws in (trim 0 → 1) | 420 ms | `i × 32 ms` | `CubicBezierEasing(0.22f, 1f, 0.36f, 1f)` |
| Beam draws **outward from the centre** | 520 ms | 420 ms | same |
| Wordmark clip opens left → right | 600 ms | 700 ms | same |
| Glyph `i` (`A t l a s`): alpha 0 → 1, shift → 0 | 500 ms | `720 ms + i × 48 ms` | same |

The total is about **1.5 s**.

- **When:** on first composition for top bars and the login screen. For marks inside scrolling content (footers, hero marks), start when **35 %** of the mark becomes visible, using `onGloballyPositioned` plus the viewport bounds.

---

## 3. Login screen

The web source is `src/pages/Login.tsx` (`.atlas-login-lockup-svg`, `.atlas-login-phone-lockup`) with `src/styles/login-auth.css`.

| Form factor | Lockup height | Colour | Placement |
|---|---|---|---|
| Phone (< 600 dp) | **54 dp** (≈ 159 dp wide) | `#0F1115` light, `#FFFFFF` dark | centred above the card, 4 dp vertical padding, hero row at least 64 dp tall |
| Tablet card (≥ 600 dp) | **72 dp** (≈ 213 dp wide); 56 dp when the window is < 420 dp wide | always `#FFFFFF` (the card is always dark) | centred above "Bon retour", 14 dp below |

- **Same size in both themes.** A theme switch, whether system, in-app or while the screen is open, changes the **colour only**, never the size or position. Do not swap a light PNG for a dark PNG with different padding. Draw one vector lockup and tint it.
- **Motion:**
  1. the intro (§2) on entry;
  2. then an **idle wave**: every tick loops alpha 1 → **0.32** → 1 over **2.4 s**, `EaseInOut`, tick `i` delayed by `i × 160 ms` (`rememberInfiniteTransition`).
- A tap on the lockup plays the tap ripple (§4.2) and replaces the wave for that cycle.
- Keep the stroke at **12 units** for the full lockup and **10 units** for a mark on its own (optical stroke at these sizes).

---

## 4. Small logos: top bars and info screens

### 4.1 Sizes

| Where | Size | Notes |
|---|---|---|
| App bar of About / What's new / Privacy / Terms / Licences | mark only, **30 dp** (28 dp when compact or on phones < 760 dp wide) | ink `#0F1115` light, `#FFFFFF` dark, **never** a muted grey |
| Public / landing header (if Android has one) | full lockup **30 dp**, **24 dp** when collapsed on scroll | the old 19 dp size was too small |

All of them play the intro (§2) on first composition.

### 4.2 Tap ripple (touch has no hover)

A tap on a logo runs the hover ripple:
- tick `i`: alpha 1 → **0.18** (at 40 %) → 1;
- **620 ms**, `EaseInOut`;
- delay `i × 26 ms`.

Each new tap **restarts** it (cancel and relaunch the `Animatable`s). Ignore taps while the intro is still playing. The tap does not navigate unless the logo was already a link.

---

## 5. Previews and screenshots follow the theme

Web now ships light **and dark** captures of the real UI with fictional data. Copy them from `public/shots/` in the web repo:

| Light | Dark |
|---|---|
| `phone-home-demo.webp` | `phone-home-demo-dark.webp` |
| `phone-products-demo.webp` | `phone-products-demo-dark.webp` |
| `phone-balance-demo.webp` | `phone-balance-demo-dark.webp` |
| `desktop-products-demo.webp` | `desktop-products-demo-dark.webp` |

- Wherever Android shows these previews (welcome / onboarding carousel, "What's new", any "Aperçu" screen), pick the variant from the **resolved** theme (`isSystemInDarkTheme()` or the in-app choice). Switch **live** when the theme changes, with no restart.
- Put the files in `res/drawable-nodpi/` (or `assets/shots/`) with the same base names. Map them through one helper, `themedShot(name, dark)`, never with scattered `if`s.
- Never invent new screenshots and never use generated images. If a capture has no dark version (for example `android-scan-demo`), keep the light one.
- The web tooling for new captures is `THEME=dark node scripts/capture-demo-shots.mjs` (output `<name>-dark.webp`).

---

## 6. Toolbar pills: touch states and narrow phones

The web source is `src/components/PublicChrome.tsx` (language pill, theme trio, "Se connecter"), styled in `src/App.css` (`public-lang-pill`, `public-session-cta`).

### 6.1 Pressed state, no "stuck" hover

- The language pill (`文A FR`) and the theme segmented control (system / light / dark) are **32 dp** tall, the **same** height. Never inflate one to a 44/48 dp oval with `minimumInteractiveComponentSize()` drawn visibly. Keep the 48 dp touch target **invisible** with `Modifier.minimumInteractiveComponentSize()` around a 32 dp visual.
- **Pressed:** scale **0.94** plus a background of `rgba(113,113,122,0.16)` in light or `#2F2F35` in dark, with text `#FAFAFA` in dark. It runs for the duration of the press only (`collectIsPressedAsState()`), with 120 ms in and 150 ms out.
- **After release:** nothing stays highlighted. No leftover focus ring or hover tint after a dialog closes. Return focus only for keyboard or D-pad navigation.
- Unselected text is `#D4D4D8` in dark. Never use a dim `#71717A` on `#18181B`; it reads as disabled.

### 6.2 Narrow phones: never overlap

- The left group (menu button and mark) **never shrinks**: give it an intrinsic width (`wrapContentWidth()`, no `weight`). The right group takes the remaining width.
- On widths **≤ 480 dp**:

  | Element | Size |
  |---|---|
  | Menu button | 32 dp |
  | Theme and language buttons | 28 dp |
  | Gaps | 6 dp |
  | Bar horizontal padding | 8 dp |

  - The language code "FR" is hidden (icon only).
  - "Se connecter" becomes **"Connexion"**. Keep `contentDescription = "Se connecter"`.
- On widths **≤ 360 dp**: the theme control shows **light / dark** only, with "system" hidden unless it is the active choice. Gaps are 4 dp.
- Nothing may draw underneath another control. Test at 320, 360, 390 and 412 dp.

---

## 7. Tests

1. **Login lockup size is theme-independent.** Compose test: render the login screen in light, then dark. Assert the lockup's bounds are identical (54 dp tall on a phone, 72 dp on a tablet) and only the tint differs.
2. **Intro timing.** With `mainClock.autoAdvance = false`:
   - at 0 ms every tick has trim 0;
   - at 900 ms every tick has trim 1 and the beam has trim > 0.5;
   - at 1 600 ms everything is final.
3. **Collapsed beam stays full.** After the rail-collapse transition, the beam's `scaleX == 1` and its length equals 125 units in mark space.
4. **Tap ripple restarts.** Two taps 200 ms apart give two ripple starts. Taps during the intro are ignored.
5. **Reduced motion.** With the animator scale at 0, the first frame is final and no infinite transition is running.
6. **Themed previews.** `themedShot("phone-products-demo", dark = true)` resolves to the `-dark` resource. A name with no dark capture returns the light one. Flipping the theme in a test recomposes with the other resource.
7. **Narrow toolbar.** At 320 dp and 390 dp the bounds of the menu button, mark, language pill, theme control and CTA do not intersect, and all lie inside the bar.
8. **Pressed state clears.** Press, then release, the language pill. Assert scale 1 and a transparent background after 200 ms.

---

## 8. Done checklist (report each line)

- [ ] Login: animated lockup, 54 dp phone / 72 dp tablet, same size in light and dark, idle wave after the intro.
- [ ] Info-screen app bars: 30 dp animated mark, ink or white (never grey), tap ripple.
- [ ] Tablet rail: collapsed mark keeps the full beam; beam pulse plus tick ripple on every toggle.
- [ ] Previews switch to the `-dark` captures in dark theme, live.
- [ ] Language pill and theme control are both 32 dp, with a pressed state only while pressed and nothing stuck after release.
- [ ] No overlap at 320 / 360 / 390 / 412 dp; "Connexion" on ≤ 480 dp; light/dark only on ≤ 360 dp.
- [ ] Reduced motion respected everywhere.
- [ ] Lint 0/0, all tests green, version still 0.9.3.
