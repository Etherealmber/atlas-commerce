# Atlas Commerce Android: animated sunburst brand (splash, loader, tablet sidebar). Strict prompt

> Paste this whole file as the task for the agent working in `Etherealmber/atlas-commerce-android`.
> Goal: Android gets the **same brand motion as web 0.9.3**: the splash draws the sunburst, a looping inline loader, and a sidebar lockup where "Atlas" folds into the mark when the **tablet** navigation collapses. Same geometry, timings, easing and colours, in light **and** dark.
> If this file conflicts with an older Android prompt, this file wins for the logo, splash and loaders only.

---

## 0. Rules (read first)

- **Keep the existing sunburst mark.** It has 15 radial ticks plus a horizontal beam at 3 o'clock, followed by the "Atlas" wordmark. **Do not** introduce a new geometric "A" monogram, gold accents or new colours.
- **No sound.** No Lottie, Rive or video. Use Compose (`Canvas`, `animate*AsState`, `Animatable`, `updateTransition`) plus one `AnimatedVectorDrawable` for the system splash icon.
- **Crisp, not decorative.** Aim for the feel of Linear, Stripe or Microsoft Office: no glow, no blur, no glassmorphism, no bounce or overshoot.
- **Reduced motion.** When the user has turned animations off (`Settings.Global.ANIMATOR_DURATION_SCALE == 0f`, or the in-app "Animations" toggle is off), show the final static frame immediately. Inline loaders then pulse opacity only, with no rotation and no stroke drawing.
- **No layout jumps.** Collapsing or expanding the sidebar never re-measures the content column mid-animation. The wordmark is clipped inside a fixed-height row and is never removed with `if (expanded)` until the animation ends.
- **0 lint warnings and 0 errors.** All existing tests must stay green. Add the tests listed in §7.
- **Do not bump `versionName` or `versionCode`.** The version stays **0.9.3**.
- **No backend changes.**

---

## 1. Sources of truth (web repo `Etherealmber/atlas-commerce`, branch `main`)

| What | Path |
|---|---|
| Mark geometry (ticks, beam, stroke) | `src/components/brand/atlasMark.ts` |
| "Atlas" wordmark as vector glyph paths (DM Sans 600, already outlined) | `src/components/brand/atlasWordmark.ts` |
| Mark + wordmark components | `src/components/brand/AtlasMark.tsx` |
| Splash, inline loader and sidebar motion (all timings) | `src/components/brand/atlas-brand.css` |
| Boot splash (static HTML version of the same intro) | `index.html` (`#splash`, `sp-*` keyframes) |
| Sidebar usage | `src/components/brand/SidebarBrandLogo.tsx`, `src/App.tsx` (`.logo.atlas-brand-host`) |
| Mobile web pending-reply loader | `src/mobile/PhoneApp.tsx` (`.ph-agent-pending`), `src/mobile/phone.css` |

Copy the numbers below. If they differ from the web files, the web files win.

---

## 2. Geometry (one shared Kotlin object: `AtlasMarkGeometry`)

- **Coordinate space:** a 252 × 252 square, centre `(126, 126)`.
- **Ticks:** 15 ticks, at angles `k × 22.5°` for `k = 1…15`, clockwise from 3 o'clock (screen y grows downward). Each tick is a straight line from radius **79** to **125**, stroke **9** units, `StrokeCap.Butt`.
  - Draw order is `k = 1…15` (it sweeps clockwise and ends back at the beam).
- **Beam:** the line from `(126, 126)` to `(251, 126)` at the same stroke. It replaces the 3 o'clock tick.
- **Optical stroke at small sizes:** the web sidebar draws the mark at 32 dp with stroke **13** units. Use the following:

  | Mark size | Stroke |
  |---|---|
  | ≤ 24 dp | 14 units |
  | ≤ 40 dp | 13 units |
  | Larger | 9 units |

- **Lockup:** the viewBox is `0 0 735 252`.
  - Mark: x 0–252.
  - Gap: 54 units.
  - Wordmark: x 306–735, baseline 182, cap height 134.
  - Import the five glyph paths (`A`, `t`, `l`, `a`, `s`) verbatim from `atlasWordmark.ts`. Use `PathParser().parsePathString(d).toPath()`, or put them into a `VectorDrawable`. **Never** render the wordmark with a `Text` composable.
- **Colours:** use the theme ink only.

  | Theme | Ink | Splash background |
  |---|---|---|
  | Light | `#0F1115` | app background |
  | Dark | `#FFFFFF` | app background (`#111113` on web) |

---

## 3. Splash (cold start)

1. **System splash (Android 12+ `SplashScreen` API).**
   - The icon is an `AnimatedVectorDrawable` of the **mark only**. It must fit the 2/3 safe circle.
   - Animate each tick's `trimPathEnd` from 0 to 1 over **420 ms**, staggered **30 ms** per tick, with interpolator `PathInterpolator(0.22f, 1f, 0.36f, 1f)`.
   - Then animate the beam's `trimPathEnd` from 0 to 1 over **560 ms**, starting at **380 ms**.
   - Set `windowSplashScreenAnimationDuration` to `1000`.
   - Below API 31, use the static mark on a themed window background.
2. **Hand-off to Compose (`AtlasSplash` composable),** used while the first data loads.
   - The mark stays exactly where the system icon was. Compute the offset so there is no jump.
   - The wordmark reveals at **640 ms**. Clip its left edge from 0 % to 100 % over **620 ms**.
   - Each glyph fades from 0 to 1 and slides from `-35 %` of its own width to 0 over **520 ms**, starting at `660 ms + i × 45 ms`.
   - The label "Chargement…" (12 sp, uppercase, letter-spacing 0.14 em, muted) fades in at **1100 ms**.
   - **Idle loop**, from **1250 ms** until data is ready: the tick opacity waves 1 → 0.32 → 1 over a **1800 ms** period, offset **120 ms** per tick. The beam stays solid.
   - **Exit:** fade the whole splash out over **160 ms**. Never trap the user: force-hide after **15 s**.
3. **Sizing:** the lockup width is `min(212.dp, 58 % of screen width)`. Centre it in the window, accounting for insets (`WindowInsets.safeDrawing`), on both phone and tablet, portrait and landscape.

---

## 4. Inline loader (`AtlasLoader(size = 20.dp)`)

- Use it for: refresh in lists, Agent "réfléchit…", device scan, and any spinner that is not a pull-to-refresh.
- **Mark only.** Each tick's alpha animates 1 → 0.16, linear, with a **1050 ms** period and a phase offset of **70 ms × k** (like a classic activity indicator). The beam stays at alpha 1.
- **Accessibility:** set `contentDescription` to the visible label, or make the loader decorative (`Modifier.clearAndSetSemantics {}`) when the parent already announces status.
- **Atlas Agent pending reply.** This mirrors web `.ph-agent-pending`.
  - Show an assistant bubble with the 19 dp loader in the avatar.
  - The label "Atlas Agent réfléchit…" has a text shimmer: a gradient sweep with a **1.6 s** period.
  - Show **3 skeleton lines** at widths 92 %, 78 % and 54 %, each 10 dp high, fully rounded, with a gradient shimmer (**1.35 s** period, staggered 80 ms).

    | Theme | Line | Highlight | Bubble background |
    |---|---|---|---|
    | Light | `#DCDCE1` | `#F6F6F8` | `#EDEDF0` |
    | Dark | `#3A3A40` | `#57575F` | `#27272A` |

  - This replaces the three bouncing dots.

---

## 5. Sidebar lockup: phone drawer and **tablet** rail

Atlas Commerce shows a sidebar in tablet mode. Window width ≥ 600 dp is "tablet". It uses a `NavigationRail` when collapsed and a `PermanentNavigationDrawer` (or a wide rail) when expanded. Users toggle it with the menu button **and** by double-tapping the logo (web does the same on double-click).

### 5.1 `SidebarBrandLogo(isCollapsed: Boolean, subtitle: String?)`

- **Expanded:**
  - Row: mark (32 dp), then an **8 dp** gap, then the wordmark (32 dp tall, 54.5 dp wide).
  - Below the row, the subtitle in 11.5 sp, muted:
    - "Stock & facturation", or
    - "Stock · magasinier" for the stock role.
  - The logo block's padding is 12 dp top and 14 dp bottom.
- **Collapsed:** only the mark, centred in the rail column. Padding is 8 dp top and 10 dp bottom.
- **Transition (300 ms, `CubicBezierEasing(0.22f, 1f, 0.36f, 1f)`), driven by one `updateTransition(isCollapsed)`:**
  1. **Wordmark width.** Animate the wordmark's width from 54.5 dp to 0, and the gap from 8 dp to 0. Use `Modifier.layout`, or `clipToBounds()` with an animated width, inside a fixed 32 dp-high row.
  2. **Glyph retraction.** The glyphs retract **right to left**. Each glyph's alpha goes 1 → 0 and it slides by `-60 %` of its own width. Glyph `i` starts after `(4 − i) × 22 ms`, so "s" leaves first and "A" last. On expand, play in order `i × 26 ms + 40 ms`.
  3. **Beam.** The beam shortens to a regular tick: `scaleX` 1 → **0.376**, pivot at its outer end `(251, 126)`. The closed mark then reads as a full sun. This is the "accent micro-shift"; do not move the mark itself.
  4. **Subtitle.** The subtitle collapses via animated height (1 → 0 rows) and alpha 1 → 0 over 180 ms.
- **Never use `AnimatedVisibility` with `exit = shrinkHorizontally` on the whole lockup.** That re-centres the mark mid-animation. Never remove nodes before the transition ends.
- **Rail width change.** The rail's width can animate (`animateDpAsState`) with the same easing and duration so the mark glides into the centre. The content pane must use `Modifier.weight(1f)` and must not re-run heavy layouts per frame. Wrap lists in `key`s and avoid recomposing their items on width change.

### 5.2 Where

| Form factor | Behaviour |
|---|---|
| Phone (< 600 dp) | `ModalNavigationDrawer`: always the **expanded** lockup. No collapse animation. |
| Tablet portrait / landscape | Rail ↔ drawer with the transition above. Save the state like web (`atlas-sidebar-collapsed`); the default is collapsed. |
| Foldables / resizing | Recompute on `WindowSizeClass` change. When the window shrinks to phone width, switch to the modal drawer **without** animating the lockup. |

---

## 6. Accessibility and quality

- The lockup has `contentDescription = "Atlas Commerce"`. Glyphs and ticks are not separate nodes.
- Touch target: the double-tap area for collapse is the whole logo block (≥ 48 dp high).
- **60 fps:** draw ticks in a single `Canvas` (`drawLine` × 15 plus the beam) using precomputed endpoints. Do not allocate `Path` objects per frame.
- Check every case in light and dark, in RTL (the mark is not mirrored; the wordmark stays LTR), at font scale 2.0 (the wordmark is vector, so it doesn't scale; the subtitle wraps to two lines at most), and with "Remove animations" on.

---

## 7. Tests

- **Geometry.**
  - `AtlasMarkGeometry.ticks()` returns 15 items; the first is at 22.5°, `(126 + 79·cos, 126 + 79·sin)` to radius 125.
  - The beam runs from `(126, 126)` to `(251, 126)`.
- **Wordmark.** The five glyph paths parse, and the union of their bounds stays within x 306–735 and y 48–186.
- **Reduced motion.** With duration scale 0, `AtlasSplash` and `SidebarBrandLogo` render the final frame on the first composition (compose test with the main clock paused).
- **Sidebar.**
  - When the collapse toggles, the mark's centre x never jumps more than 1 dp between consecutive frames (sample every 16 ms).
  - Collapsed: wordmark width is 0 and the beam's `scaleX` is 0.376.
  - Expanded: the subtitle is visible.
- **Phone.** The modal drawer always shows the expanded lockup.
- **Agent.** While a reply is pending, there are 3 skeleton lines and the label "Atlas Agent réfléchit…", with no three-dot indicator.

---

## 8. Done checklist (report each line)

- [ ] System splash AVD: ticks draw in clockwise, the beam extends, total ≤ 1000 ms.
- [ ] Compose splash: seamless hand-off, wordmark reveal, idle wave, 15 s safety exit.
- [ ] `AtlasLoader` used for refresh and pending states; the Agent shimmer bubble is in place.
- [ ] Tablet rail ↔ drawer: "Atlas" folds into the mark, the beam shortens, there's no jump, and the state persists.
- [ ] Phone drawer: expanded lockup, no animation.
- [ ] Light and dark, RTL, font scale 2.0 and remove-animations all checked (attach screenshots).
- [ ] Lint 0/0, all tests green, version still 0.9.3.
