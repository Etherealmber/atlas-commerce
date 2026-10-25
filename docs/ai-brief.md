# Atlas Commerce — the complete brief for any AI working on (or porting) this product

> Hand this document to any AI agent together with the repo. It explains how **everything**
> works — from the Dashboard to Settings, the Balance, the wizards, the popups — and how each
> piece must look and behave. Source of truth: `worker/index.ts` (the whole API) and `src/`
> (the React SPA). Never guess an endpoint — read the worker.

## 1. What the product is

**Atlas Commerce** is a French-language stock & invoicing ERP for small commerce (warehouses,
shops). It runs entirely on Cloudflare: a single **Hono Worker** (`company-stock`) + **D1**
(SQLite) + **R2** (`company-stock-images`, binding `IMAGES`, used for app updates) + Durable
Objects (avatar cache). Production: `https://stock.afmarbre.com`. Frontend: **React 18 + Vite
SPA** (no Tailwind — hand-written CSS in `src/styles/` + per-component CSS), installable as a
**PWA**, with a **native Android app** (separate repo `atlas-commerce-android`, Kotlin/Compose)
and a **desktop app** (`atlas-commerce-desktop`, Rust/egui/fastframe). License MIT © 2026
loxdpsy / Etherealmber. Versioning: `0.x` betas (currently frozen at **0.5.1-beta** — never
bump or change changelog dates unless the owner says "push to next update").

## 2. Accounts, roles, security

- **Roles**: `admin` (full ERP), stock role (`magasinier` — terrain duties, **never sees
  prices/money**), plus capability flags (`canSell`, settings access levels). The UI hides
  money columns/labels for stock roles everywhere (`isStockRole()`).
- **Login**: username + password → the worker may require **OTP by e-mail** (Resend; the mail
  template is the Bever-style orange/salmon design with a big code box). Reputation gate:
  login attempts below score 40 are refused. Injection-style inputs trigger lockout. Tokens
  are capped per user.
- **Session token v2** is bound to **(IP, device fingerprint)**; every API call sends
  `Authorization: Bearer` + `X-Device-Fingerprint`. The fingerprint is a stable SHA-256 per
  device (see `src/fingerprint.ts` / Android `DeviceIdentity.kt`).
- **One-tap e-mail verification**: the OTP mail button links to `/verify?user&code&sig&exp`
  (signed `sha256(otplink|user|otp|exp|secretMaterial)`, 10-min, single-use). The SPA page
  auto-submits `POST /api/auth/verify-link` (public, middleware-exempt), detects an installed
  PWA (`display-mode: standalone`) or hands off to the native app via
  `atlascommerce://verify` intents with `browser_fallback_url` back to the page.
- **QR pairing**: the PC shows a QR (`/login/qr`), the phone app claims/completes it
  (`/api/auth/qr/session/{token}` + claim/phone-bind/deny/complete). QR endpoints are exempt
  from the owner gate; anonymous ≠ owner everywhere (hard rule).
- **Deletes are OTP-gated** (a code by e-mail confirms destructive actions) — a delete never
  asks for the password. Trusted devices can skip re-OTP (`trusted_device`).
- Production never exposes an OTP in a response; the mailbox feature was **deleted** (the
  worker `email()` helper quietly discards). Agent data never leaks between accounts
  (per-user storage scoping).

## 3. Shells & navigation

- **PC shell** (`DesktopShell` in `src/App.tsx`): sidebar + topbar sharing ONE theme, content
  pane, persistent Atlas Agent panel on the right, notifications overlay, global search.
  Sidebar collapse state persists. "Focus pages" (Settings, Balance…) render with reduced
  chrome (`layout-settings-focus`).
- **Phone shell** (`PhoneShell` → `/m/*`, `src/mobile/`): narrow viewports (≤900px), the
  native APK and `?mode=phone` get the **minimized terrain app** — scan-first home, offline
  product catalog cache + outbox sync, bills, warehouse, agent, settings-lite, bottom tab
  bar (44–56px touch targets, ripple feedback, no selectable chrome text, 16px inputs).
  Everything else on phone shows the "Espace ordinateur uniquement" page with a jump to `/m`.
  **Directive: phones minimize, PC keeps everything.**
- **WhatsNew modal** (`src/pages/WhatsNew.tsx`): dark, ONE accent color, entry ids like
  `051d17`; every shipped change gets an entry; labels always `0.x`.

## 4. Screen-by-screen (what it does & how it looks)

- **Dashboard**: ONE period selector for the whole page (daily/weekly/monthly/custom), KPI
  cards (CA, ventes, stock bas, impayés), charts (pie ring color `--pie-ring #e8a317`),
  low-stock alert list, recent activity. Numbers animate (CountUp) on phone.
- **Produits**: dense table (32px thumb, sku, stock, price hidden for stock role), search +
  category/location filters + multi-select, pager (`ListPager`), create/edit as **step
  wizards**, drag-drop photos on the photo step (staged blob previews, first = ★ Principale),
  variants (price + initial stock), stock adjustment (in/out with reason), barcode/label
  printing, **OCR bills → product data** (Groq vision), delete = OTP-gated.
- **Ventes / POS**: cart building by scan or click, quantity steppers, client attach, quick
  sale numbering (`VR-` prefix, `prefix_year` / `prefix_year_slash` / `prefix_pad5` styles,
  4-digit pad), receipt printing (thermal 58/80mm — `src/lib/thermal.ts`), receipts carry a
  public verify link (`/api/public/verify?p=v1.invoice.TOKEN.exp.mac`).
- **Factures / Balance (Solde)**: invoice list with statuses, payments (espèces/carte/virement),
  credit notes (`WR-` prefix), unpaid totals per client, document viewers (invoice/receipt/
  client) with public verification pages, export PDF/print. The Balance page aggregates
  trésorerie: encaissements, dépenses, paie, COGS (`qté vendue × coût unitaire CMP ou
  standard`), marge. Bank reconciliation parses statement dates `dd/mm/yyyy`.
- **Clients (CRM) / Fournisseurs**: parties with contacts, balances, history; purchases
  generate draft buy-invoices with suggested quantities (**2× seuil − stock**); catalog cost
  is recalculated as a weighted average on reception (ancien stock × ancien coût + nouvel achat).
- **Dépenses**, **Bons de livraison**, **Rapports** (period reports: sales, stock, catégorie ×
  entrepôt matrix, COGS), **Pointage/Paie** (attendance weights per cycle; **paie suggérée =
  jours travaillés × taux journalier**, late counts as present), **Notifications** (role-based,
  deep-link into pages).
- **Atlas Agent IA**: ONE persistent conversation per account (threads stored per-user,
  never across accounts), page-context aware (knows which screen you're on), quota line
  visible in the panel, attachments appear as **chips only** (no bubbles), prefilled
  **confirm popup** before any write action the agent proposes, Groq-only backend.
- **Réglages**: profile (display name, email, avatar — Durable-Object blob-cached, fast),
  connected devices (revoke), theme (dark/light/system — circular-reveal switch), density
  (comfortable/compact), language, numbering prefixes with live examples, D1 migration runner
  (Settings-driven, no CLI), firewall/WAF status (free CF tier), read-replication is
  automatic, update channel info.

## 5. Interaction laws (non-negotible directives)

1. Create/edit popups are **step wizards**: « Continuer » stays on the same dialog level;
   **no « Retour » on the first step**; footer actions aligned **RIGHT in ALL popups**; the
   sticky footer must **never overlap content**; the Étape indicator is a **compact pill**;
   the footer is **rounded on top**; **no wizard may scroll** (content must fit per step).
2. **Errors display INSIDE the popups** (never a detached toast for form errors).
3. Clicking the overlay/outside a dialog = **cancel + reset** — never persists half-typed data.
4. Pickers are **Discord-style** (searchable lists, keyboard navigation); date picker has no
   white flash and closes on Escape.
5. **Dark theme on ALL elements**: no white pills/triggers/thead/checkboxes, no white flash on
   tap/focus, ONE zinc palette, see-through backdrops, buttons not too black, **no selectable
   button text**, motion enrichment app-wide (subtle, respects prefers-reduced-motion).
6. Scan-based product creation must **NOT ask for a price**; the mobile flow stays minimal.
7. Phones minimize, PC keeps everything. Sidebar theme = topbar theme.
8. Never delete changelog/doc content; never change changelog dates; no Kits/BOM; no Mailbox.

## 6. Visual language

- **Zinc monochrome dark** (mirrored by Android & desktop): bg `#111113`, surface `#1c1c1f`,
  hover `#27272a`, lines `#2a2a2e`, ink `#f4f4f5`, muted `#a1a1aa`, dim `#71717a`, primary =
  white with near-black `#0a0a0a` text; semantic only: danger `#f87171`, warning `#fbbf24`.
  No teal, no saffron/orange brand accent in the app (orange `#f4590c` + salmon `#ee8b6c`
  exist ONLY in the OTP e-mail template).
- Light theme: paper `#f5f2eb`-family (terrain app), same structure. `dark-force.css` is the
  LAST stylesheet and wins the cascade by design — never import after it.
- Type: Inter (desktop/Android), DM Sans (terrain app); tabular figures for numbers; pills
  `border-radius: 999px`; cards 10–22px radii; compact density option.
- Material touches on phone: ripple on tap (React Bits adaptation), CountUp stats, Lens
  magnifier for images (hover devices) — see `src/components/ui/Bits.tsx`.

## 7. API conventions

- REST under `/api/...`, JSON envelopes `{success, data?}` or `{success:false, error, code}`;
  error codes are stable strings (`LINK_EXPIRED`, `BAD_OTP`, `WR_PREFIX_INVALID`…).
- Hono middleware order matters: the auth gate protects only routes registered AFTER it;
  public endpoints must be added to the exemption list (verify-otp, verify-link, qr, health,
  canary). Authenticated responses are `no-store` (edge-cache leak rule).
- Rate limiting per IP; OTP rows are single-use; secrets: `RESEND_API_KEY`, `GROQ_API_KEY`,
  optional `CF_API_TOKEN`, `ANDROID_RELEASE_TOKEN`.
- Deploy: Workers Builds auto-deploys `main` — never deploy by hand.

## 8. Quality gates (CI must stay green)

`tsc` error budget (`scripts/tsc-baseline.txt`, currently worker=72 src=74 — lower it when
you improve, never raise it) · **oxlint** `npm run lint` (correctness = 0 errors, src+worker)
· vitest · vite build + bundle sanity · wrangler dry-run · css-check (dark-force last, no new
white backgrounds in dark blocks) · CodeQL (suppression patterns documented in
`src/pages/Products.tsx` / `src/auth.ts`) · osv-scanner · security patrol (forged-token
probes). PRs ride the auto-merge pipeline: merge only when EVERY check is green.
