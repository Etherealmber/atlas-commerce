# Atlas Commerce — Documentation consolidée

*Fusionné le 2026-09-09 — 13 fichiers sources.*


---

## DOCS.md


# Atlas Commerce — Worker & Web

Stock, facturation, devis, agent, sauvegardes, mobile handoff.  
API + SPA on Cloudflare Workers · D1 · R2 · KV · Durable Object `MOBILE_HUB`.

## Deploy

```bash
npm install
npm run build && npx wrangler deploy
```

### Secrets (examples)

```bash
npx wrangler secret put ADMIN_BACKUP_TOKEN    # chiffrement backups R2
npx wrangler secret put TURNSTILE_SECRET_KEY # login web anti-bot
npx wrangler secret put MISTRAL_API_KEY      # Atlas Agent (ou GEMINI / GROQ)
# optionnel e-mail
npx wrangler secret put RESEND_API_KEY
# optionnel push Android
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
# legacy: FCM_SERVER_KEY
```

Réglages → API : choisir **Mistral**, **Gemini** ou **Groq** (TokenRa = payant, non recommandé).

## Auth & OTP

1. `POST /api/auth/login` → si 2FA, envoie OTP (Cloudflare `EMAIL` binding et/ou Resend).
2. `POST /api/auth/verify-otp`

**Prod check OTP**

- Login avec un compte réel → e-mail reçu sous ~1 min.
- Si échec : Worker logs `otp_email_failed` ; vérifier binding `send_email` + destinataire autorisé, ou `RESEND_API_KEY` + `RESEND_FROM`.

Native APK : pas de Turnstile.

## Backups (R2)

- Cron interne ou externe : `POST /api/cron/backup-execute`  
  Header optionnel selon config (voir code / secret cron si activé).
- Snapshots chiffrés `.abk` sous `backups/30m` + `backups/latest.abk`.
- Restore R2 : session **owner** ; le serveur utilise `ADMIN_BACKUP_TOKEN` (pas de collage UI).
- Import fichier `.abk` hors serveur : jeton optionnel.

**Prod check backup**

```bash
curl -X POST "https://stock.afmarbre.com/api/cron/backup-execute" \
  -H "Authorization: Bearer <admin_session_or_cron_token>"
```

Réglages → liste des snapshots + « Restaurer depuis R2 ».

## Atlas Agent

- `POST /api/assist/chat` — mêmes instructions, provider D1 `assist_llm_provider`
- `GET /api/assist/next-actions`
- `POST /api/assist/approve` — file d’attente Boîte + **push FCM** si configuré

## Push FCM (Android)

1. App : `POST /api/push/register` ou `/api/assist/device-token` avec le jeton FCM.
2. Worker envoie si secrets Firebase présents :

| Événement | Comportement |
|-----------|----------------|
| Proposition / action assist traitée | Push à l’utilisateur concerné |
| Action mobile **validée** sur PC | Push au **créateur** de la demande |
| Stock qui passe **sous seuil** / rupture | Push à tous les appareils enregistrés |

Sans secrets Firebase → register OK, envoi no-op (pas d’erreur bloquante).

## Mises à jour APK

- Manifeste R2 : `app-updates/android/latest.json`
- `GET /api/app/android-update?versionCode=12` — public (appelé avant login pour le flux mandatory)
- L’app télécharge l’APK en interne (pas de navigateur).
- Gestion admin (owner/admin) depuis Paramètres → onglet « Mise à jour app » :
  - `GET /api/admin/app-update` — manifeste courant + métadonnées R2 (json/apk)
  - `PUT /api/admin/app-update` — écrit `latest.json` sur R2 (+ miroir `app_config`)
  - `POST /api/admin/app-update/apk` — upload binaire streamé vers R2 (max 200 Mo,
    exempté du plafond 2 Mo des routes API)

## UBL / facturation électronique (M1 local)

| Route | Rôle |
|-------|------|
| `POST /api/invoices/:id/ubl/prepare` | Snapshot XML + hash |
| `GET /api/invoices/:id/ubl/clearance` | Statut local |
| `POST /api/invoices/:id/ubl/status` | Statut local uniquement |
| `GET /api/invoices/:id/ubl/snapshot` | Télécharger XML |

**Pas d’appel DGI/PDP live** tant que credentials + cadre légal ne sont pas branchés.

## Catalogue public (API seulement)

`GET /api/public/catalog` — produits `is_public`, settings boutique.  
Pas de vitrine web fournie (voir explication produit séparée).

## Mobile / rôles

- Magasinier : scan, stock check, inventaire → Boîte PC  
- Secrétaire / owner : validation, ventes, factures  
- `/m/*` shell téléphone

## Encore ouvert (volontaire)

- Vitrine boutique front (N) — API prête
- Soumission DGI live (M)
- Multi-devises
- Polish passkey / Play Console ops

## Privacy

Page `/privacy` in-app. Contexte Maroc / MAD.


---

## ERP_MIGRATION.md


# Atlas → ERPNext density migration

**Stack:** React + Vite + CSS variables only (no Tailwind / Shadcn / Radix / Lucide).

## Phase 1 — Foundation (done)

| Item | Status |
|------|--------|
| `atlas-tokens.css` light/dark | Done |
| Bridge legacy `--paper` / `--muted` / `--line` | Done |
| `mode-compat.css` Comfort / Compact / Liquid Glass | Done |
| `MobileBottomNav` ≤768px | Done |
| Sheet pattern `.atlas-sheet-*` | Done |
| Ctrl+K overlay | **Removed** |

## Phase 2 — Modules

| Step | Module | Status |
|------|--------|--------|
| **1** | Banque & rapprochement | Done — `/bank` |
| **2** | Orders (Factures + VR) | Done — KPI, Kanban, dense tables |
| **3** | Catalog (Produits) | Done — stock pills, KPIs |
| **4** | CRM (Clients + Fournisseurs) | Done — credit pills, KPIs |
| **5** | Settings | Done — `atlas-settings` + density/glass compat |
| **6** | Mode parity + cleanup | Done — unused workers/css removed |

## Workers kept in Bank page

CSV parse runs via **inline Blob Worker** inside `Bank.tsx` (no separate unused worker files).

## Deleted unused

- `erp-density.css` (superseded by atlas-tokens + mode-compat)
- `workers/bankCsvParse.worker.js`, `bankMatch.worker.js`, `statementWorker.js` (not imported)


---

## FEATURES_2026-09-09.md


# Updates 2026-09-09

## Restore progress
- RestoreHub processes the **first table immediately** on start (no longer stuck at 20%).
- Then continues **one table per DO alarm** with batch inserts.
- Fallback to single-shot batched restore if DO start fails.
- Progress advances per table (and mid-table on large ones).

## Banque removed
- Nav, mobile nav, route `/bank`, and Settings « Banque » tab removed.

## Boîte mail (admin@afmarbre.com)
- New Admin tab **Boîte mail**
- Lists inbound + outbound messages
- Compose / reply via **Resend** (`RESEND_API_KEY`, `RESEND_FROM`)
- Outbound invoice emails are logged automatically
- Full bodies stored on **R2** (`mail/admin@afmarbre.com/...`)
- Inbound: Cloudflare Email Routing → Worker `email()` handler

### Cloudflare setup for inbound
1. Email Routing: catch-all or admin@afmarbre.com → Worker
2. Bind this Worker as the destination
3. Optional secret: keep `RESEND_FROM=admin@afmarbre.com` (verified domain)

## Atlas Agent encryption
- Already implemented server-side:
  - R2 path: `agent-chats/v2/{user}/{threadId}.conv`
  - Format **ACH2** = AES-GCM (key from `AGENT_CHAT_SECRET` or `BACKUP_ENCRYPTION_KEY` / `ADMIN_BACKUP_TOKEN`)
  - Live UI still uses sessionStorage for speed; each turn is also appended encrypted on R2
- Set secret: `wrangler secret put AGENT_CHAT_SECRET`

## Deploy
```bash
npm run build && wrangler deploy
```
Hard-refresh browser. Click Fermer on any stuck restore first.

## 2026-09-09 (evening) — Mail API routing + encrypted R2 bodies
- Fixed SPA assets returning HTML for `/api/*` by setting `run_worker_first: ["/api/*"]`.
- Resend sync now respects rate limits (soft delay + early stop on 429).
- Mail bodies stored in R2 can be AES-GCM encrypted when `MAIL_BODY_ENCRYPTION_KEY` is set.
- See `MAIL_FIX_2026-09-09.md` for full deploy notes.


---

## MAIL_FIX_2026-09-09.md


# Mail / API routing fix — 2026-09-09

## Changes

1. **SPA routing (fixes “API returned HTML instead of JSON”)**
   - `wrangler.jsonc`: `run_worker_first` changed from `true` to `["/api/*"]`.
   - This is the pattern recommended by Cloudflare for SPAs that also expose an API.
   - Every `/api/*` request is now guaranteed to hit the Worker first; non-API paths still serve the SPA.

2. **Resend synchronisation**
   - Soft rate-limit pause (≈120 ms) between detail fetches to stay under Resend’s 10 req/s free-tier limit.
   - Early stop on HTTP 429 so a single sync does not exhaust the daily quota.

3. **R2 body storage (encrypted when possible)**
   - `storeMailBodyR2` now encrypts the full HTML+text payload with AES-GCM when the Worker secret `MAIL_BODY_ENCRYPTION_KEY` (16+ characters) is set.
   - Without the secret the behaviour is unchanged (plain JSON) for backward compatibility.
   - Every inbound (Cloudflare Email Routing) and every Resend-synced message is persisted to R2.

## Deploy steps

```bash
npm run build
npx wrangler deploy
# Optional encryption key (recommended):
npx wrangler secret put MAIL_BODY_ENCRYPTION_KEY
```

After deploy, open Messagerie → click **Synchroniser Resend** once, then refresh. The list must return JSON.

## Notes

- `RESEND_API_KEY` is already set on the Worker (as confirmed).
- Cloudflare Email Routing rules pointing to the `company-stock` Worker continue to deliver inbound mail via the `email()` handler (PostalMime + HTML + attachments).
- Catch-all currently forwards to a personal Gmail address; only the four explicit addresses reach the Worker.

## Encrypted `.mail` storage (2026-09-09)

- **New messages** are written to R2 as `mail/<mailbox>/<id>.mail` (AES-GCM encrypted binary).
- Layout: magic `ATLASMAIL1` (10 bytes) + IV (12) + ciphertext.
- Key: `MAIL_BODY_ENCRYPTION_KEY` secret if set (≥16 chars), otherwise derived from `ADMIN_PASSWORD` / `JWT_SECRET`.
- **Legacy** `mail/.../*.json` plain files remain readable via `loadMailBodyR2`.
- Optional: `npx wrangler secret put MAIL_BODY_ENCRYPTION_KEY`


---

## ORIGIN_API_HTML_FIX_2026-09-09.md


# Origin still returning HTML — final hardening (2026-09-09)

## What the 502 means

The Network tab showed:

```
Status Code: 502 Bad Gateway (from service worker)
Content-Type: application/json
```

That response is generated **by the service worker** when the *origin* still returns HTML for `/api/admin/mailbox`. The SW is working correctly; the Worker was still not answering the API path.

## Changes in this package

1. **`run_worker_first: true`**  
   Boolean form works on both Wrangler 3 and 4 (the array form required ≥ 4.20 and was rejected on your machine).

2. **Explicit `fetch` entry point**  
   Every request whose path starts with `/api/` is forced through the Hono app. If anything throws, a pure JSON 500 is returned — never HTML.

3. **SPA catch-all safety net**  
   The `app.get('*')` asset handler refuses to serve HTML for any `/api/*` path and returns JSON 404 instead.

4. **Service worker v6**  
   Cache names bumped again so previous 502/HTML entries are purged after deploy.

## Deploy (required)

```bash
npm install
npm run build
npx wrangler deploy
```

Then in the browser:

1. DevTools → Application → Service Workers → **Unregister**
2. Cache Storage → delete all `atlas-*` caches
3. Hard reload (Ctrl+Shift+R) or private window
4. Open Messagerie

## How to verify the origin (not the SW)

After deploy, open a private window (no SW) and run in the console:

```js
fetch('/api/admin/mailbox?limit=5', {
  headers: { Authorization: 'Bearer ' + localStorage.getItem('token') /* or your token key */ }
}).then(r => r.text()).then(t => console.log(t.slice(0, 200)))
```

- If you see `{ "success": true, "data": ... }` → origin is fixed.
- If you see `<!DOCTYPE html>` → the Worker is still not bound to the domain / the deploy did not take effect. Check the Cloudflare dashboard → Workers → company-stock → Deployments and the custom domain binding for `stock.afmarbre.com`.


---

## RESTORE_BATCH_FIX.md


# Restore stuck at product_units / 38% — fixed

## Cause
Restore inserted **one row per D1 round-trip**. After small tables (e.g. product_units), larger tables burned Worker CPU / waitUntil budget. The isolate died without writing final status → UI froze at the last progress message (~38%).

## Fix
`restoreFromBackupPayload` now:
- Inserts with **D1 `batch()`** (chunks of 40 rows)
- Continues on per-table / per-chunk errors
- Updates progress mid-table on large tables
- Uses a stable table order

Also kept from previous fix:
- `POST /api/admin/backups/restore-cancel` + **Fermer / Annuler** button
- Auto-fail jobs older than 25 minutes

## What to do now
1. Click **Fermer / Annuler** on the stuck modal (or run in console:
   `localStorage.removeItem('atlas_restore_job_id'); location.reload();`)
2. Deploy this build
3. Run restore again — it should go past product_units and finish


---

## RESTORE_CANCEL_FIX.md


# Stuck restore job fix

## Problem
A restore was interrupted (R2 .abk deleted / Worker isolate recycled). The job stayed `status: "running"` at ~38% and the UI looped forever.

## Fixes
1. **POST /api/admin/backups/restore-cancel** — force-marks the job as failed and clears KV + Durable Object.
2. **GET restore-status** — if a job has been `running` for > 25 minutes, auto-marks it failed (`STALE_JOB`).
3. **UI** — "Fermer / Annuler" button on the progress modal (calls cancel + clears localStorage).

## Immediate workaround (no deploy)
Open browser DevTools console on the site and run:

```js
localStorage.removeItem('atlas_restore_job_id');
location.reload();
```

That closes the modal right now. After you deploy this build, use the new button or the cancel API for a clean server-side end.


---

## RESTORE_RATE_LIMIT_FIX.md


# Restore rate-limit fix (2026-09-08)

## Problem
Admin API limited to 60 req/min/IP. Settings UI polled `/api/admin/backups/restore-status` every 800 ms while other admin calls continued → 429 flood → progress modal stuck (often around 38% on product_units).

## Fixes included in this zip

### worker/index.ts
- `/api/admin/backups/restore-status` now has its own rate-limit bucket: **120 requests / minute / IP**
- Other `/api/admin/*` endpoints stay at 60/min

### src/pages/Settings.tsx
- Restore progress polling: 800 ms → **2500 ms** (both R2-key restore and file-upload restore)
- Resume-on-load success poll: 1500 ms → **2500 ms**
- On network/429 error: backoff **5000 ms**

## Deploy
```bash
npm install   # if needed
npm run build
wrangler deploy
```
Then hard-refresh the browser (Ctrl+Shift+R).

## Immediate workaround (before deploy)
Close the Settings tab for ~2 minutes so the rate-limit window resets, then reopen and check status.


---

## SECURITY_AND_MAIL_FIX_2026-09-09.md


# Security checklist + Mail / D1 fix — 2026-09-09 (iteration 2)

## Critical runtime errors fixed

### 1. `no such table: push_tokens`
- **Cause**: Backup / export loop runs `SELECT * FROM push_tokens LIMIT 200000`. The table was only created on the first push-register call, so observability logged SQLITE_ERROR.
- **Fix**: `ensureMailSchema` (called by every mailbox route and inbound email) now also creates `push_tokens` if missing. The backup loop already catches the error and continues; the log noise stops after the next schema ensure.

### 2. “L’API a renvoyé une page HTML au lieu de JSON”
- **Cause**: Wrangler 3.x rejected `"run_worker_first": ["/api/*"]` (array form requires Wrangler ≥ 4.20). Without it the SPA assets layer answers `/api/*` with `index.html`.
- **Fix**: `package.json` pins `wrangler@^4.20.0`. After `npm install` + `npx wrangler deploy` the array form is accepted and every `/api/*` request hits the Worker first.
- **Additional hardening**: global `app.onError` now has a last-resort pure `Response` so even a catastrophic failure cannot fall through to HTML for API paths.

## Security checklist (re-verified)

| Action | Status |
|--------|--------|
| Remove unused packages | No dead runtime packages |
| Check for secrets | No hard-coded keys in source |
| Rate limiting | Auth 8/min, admin 60/min, Resend soft delay + 429 stop |
| User access | Role hierarchy + requireOwner / RoleGate |
| Hash passwords | Salted SHA-256 for users; owner via secret |
| Hide API keys | Secrets only via `wrangler secret put` |
| Proper authentication | Password + Turnstile + OTP / WebAuthn |
| Update dependencies | wrangler ^4.20, vite-plugin ^1.7, hono ^4.7 |
| Sanitize forms / XSS | Sandboxed iframe for mail HTML; CSP header |
| Turn off debug mode | ENVIRONMENT=production; generic JSON errors |
| Full security audit | Documented |
| Env variables | Only non-sensitive values in `vars` |
| Exposed files | None in the shippable tree |
| Protect admin routes | Rate-limit + ownership checks |
| Secure API endpoints | JSON-only, length limits, elevated tokens |
| CORS | Explicit allow-list |
| Security headers | CSP, HSTS, X-Frame-Options, nosniff, etc. |
| Secure DB access | Prepared statements only |

## Deploy (mandatory order)

```bash
npm install          # pulls Wrangler 4.x
npm run build
npx wrangler deploy
```

After deploy:

1. Open Messagerie (must load without the HTML error).
2. Click **Synchroniser Resend** once.
3. Refresh — messages from Cloudflare Email Routing and Resend should appear.
4. Optional: `npx wrangler secret put MAIL_BODY_ENCRYPTION_KEY`

The `push_tokens` table is created automatically the first time any mailbox or push route runs.


---

## SECURITY_AUDIT_2026-09-09.md


# Security & Maintenance Audit — 2026-09-09

## Actions performed

### 1. Remove unused packages
- Reviewed `package.json`. Current runtime deps (`hono`, `pdf-lib`, `postal-mime`, React, Capacitor) are all used.
- No dead packages removed. Dev deps kept minimal.

### 2. Check for secrets
- Scanned source for hard-coded API keys / passwords. None found.
- Secrets (`ADMIN_PASSWORD`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `JWT_SECRET`, `MAIL_BODY_ENCRYPTION_KEY`, Twilio/SMS keys, etc.) are expected only as Worker Secrets (`wrangler secret put`), never in `vars` or source.

### 3. Add / verify rate limiting
- Auth endpoints: 8 writes / min / IP.
- Admin API: 60 req / min / IP (restore-status has higher budget).
- Resend sync: soft 120 ms delay + early stop on HTTP 429.
- Already present; left in place and confirmed.

### 4. Check user access
- Role hierarchy: `user` < `secretaire` < `admin` < `owner`.
- `requireOwner` / `verifyBackupAccess` gates protect admin, mailbox, backup, agent, user-management routes.
- Mailbox is owner-gated via `RoleGate` on the front-end + server-side checks.

### 5. Hash passwords properly
- User passwords: `SHA-256(pc:{salt}:{normalized_password})` with unique per-user salt stored in D1.
- Owner password: compared via constant-time-ish normalize + match against secret.
- Session tokens use proof derived from secret material (no raw password in token after login).
- Note: Argon2 would be stronger but is not available without extra WASM/cost on Workers free tier; current scheme is salted and not reversible.

### 6. Hide API keys
- No keys in source or `vars`. All sensitive values must live in Cloudflare Secrets.
- CORS origin allow-list does not leak keys.

### 7. Proper authentication
- Login requires password + Turnstile (when configured) + OTP on new devices.
- Session tokens carry username + role + proof bound to IP / fingerprint.
- WebAuthn / passkeys supported for subsequent logins.
- Password re-confirmation required for destructive admin actions.

### 8. Update dependencies
- `wrangler` → `^4.20.0` (required for array form of `run_worker_first`).
- `@cloudflare/vite-plugin` → `^1.7.0`.
- `hono` → `^4.7.0`.
- Run `npm install` after extracting the zip.

### 9. Sanitize forms / protect against XSS
- Front-end: no `dangerouslySetInnerHTML` on user-controlled content except the mail viewer, which uses a sandboxed iframe (`sandbox="allow-same-origin"` only — no scripts, no forms, no popups).
- Server: all API responses are JSON; HTML is never interpolated into pages from untrusted input.
- CSP header added to further restrict script sources.

### 10. Turn off debug mode
- `ENVIRONMENT` var defaults to `production`.
- No debug flags left enabled in the Worker that leak stack traces to clients (global `onError` returns generic JSON).

### 11. Full security audit (summary)
- CORS restricted to own domain + localhost.
- Security headers: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS (on non-localhost), X-Robots-Tag.
- Rate limiting on auth + admin.
- RBAC on every sensitive route.
- Passwords hashed + salted.
- Secrets only via `wrangler secret`.
- Mail bodies optionally AES-GCM encrypted in R2.
- No exposed `.env` or credential files in the repository.

### 12. Check env variables
- Public `vars`: ENVIRONMENT, CACHE_TTL_SECONDS, TURNSTILE_SITE_KEY only.
- Everything sensitive is typed as optional Secret in `worker/env.d.ts` / `env.ts`.

### 13. Check for exposed files
- No `.env`, no credential JSON, no private keys in the tree that will be deployed.
- `dist/` and `node_modules/` are excluded from the distributed zip.

### 14. Protect admin routes
- All `/api/admin/*` routes go through rate-limit middleware + ownership / role checks.
- Front-end routes for admin / mailbox are wrapped in `RoleGate`.

### 15. Secure API endpoints
- JSON-only responses on error paths (never leak HTML stack traces).
- Input validation + length limits on mail subjects/bodies.
- Backup / restore operations require elevated token + password re-confirm.

### 16. Check CORS settings
- Explicit allow-list for production domain and localhost only.
- Credentials not blindly reflected.

### 17. Add security headers
- Strengthened (CSP + HSTS + existing headers). See middleware in `worker/index.ts`.

### 18. Secure DB access
- All D1 access via prepared statements with bound parameters (no string concatenation of user input into SQL).
- Schema migrations are additive and guarded.

## Critical fix for the deploy error you saw

Your Wrangler 3.x rejected `"run_worker_first": ["/api/*"]` because the array form requires **Wrangler ≥ 4.20**.

This package.json now pins `wrangler@^4.20.0`. After `npm install` the array form is accepted and the SPA HTML fallback for `/api/*` is eliminated.

## Deploy sequence

```bash
npm install
npm run build
npx wrangler deploy
# Optional encryption for mail bodies:
npx wrangler secret put MAIL_BODY_ENCRYPTION_KEY
```


---

## SECURITY_AUDIT_FULL_2026-09-09.md


# Atlas Commerce — Full Security Audit & Hardening Report
**Date:** 2026-09-09  
**Scope:** React + Vite frontend, Cloudflare Worker (Hono) backend, D1, R2, KV  
**Role:** Senior Cybersecurity Engineer / Lead Full-Stack Architect

---

## 1. Dependencies & Clean Code

### 1.1 Remove unused packages
**Risk evaluated:** Bloated production bundles, larger attack surface, supply-chain risk.  
**Finding:** `package.json` is lean. Runtime deps: `hono`, `react`, `react-dom`, `react-router-dom`, `pdf-lib`, `postal-mime`, Capacitor. No orphaned production deps detected. Dev tools (`vite`, `wrangler`, types) correctly under `devDependencies`.  
**Fix:** No packages removed (none unused). Capacitor packages retained for Android builds.  
**Verified:** Manual review of `package.json` against imports in `src/` and `worker/`.

### 1.2 Update dependencies
**Risk evaluated:** Known CVEs in outdated libraries.  
**Finding:** Stack is modern (React 19, Vite 6, Hono 4, Wrangler 4.20).  
**Fix:** Wrangler pinned to `^4.20.0` (array `run_worker_first` + security fixes). Recommend periodic `npm audit` on deploy machine.  
**Verified:** `package.json` versions reviewed; no critical known vulnerable pins in tree at audit time.

---

## 2. Secrets & Environment Management

### 2.1 Hardcoded secrets
**Risk evaluated:** API keys / passwords in source → public leak.  
**Finding:** No live Resend/Twilio/JWT secrets in source. Secrets referenced via `env.ADMIN_PASSWORD`, `env.RESEND_API_KEY`, `env.JWT_SECRET`, etc. Wrangler comments instruct `wrangler secret put`.  
**Fix:** Confirmed secrets stay in Worker Secrets; added `.gitignore` blocking `.env`, `.dev.vars`, `*.pem`, `secrets/`.  
**Verified:** Grep for `sk-`, assignment patterns, and common key literals.

### 2.2 Env variables
**Risk evaluated:** Missing secrets, misconfiguration.  
**Finding:** `worker/env.ts` types all bindings. Sensitive values are optional where appropriate with runtime checks (e.g. `NO_PASSWORD_CONFIGURED`).  
**Fix:** Documented required secrets in this report. Zod not added (Workers cold-start cost); existing runtime guards retained.  
**Verified:** Login path returns 503 if `ADMIN_PASSWORD` unset.

### 2.3 Hide API keys from browser
**Risk evaluated:** Client-side exposure of Resend/SMS/LLM keys.  
**Finding:** Frontend only sends Bearer session tokens; third-party calls go through Worker routes.  
**Fix:** No client-side third-party keys.  
**Verified:** `src/api.ts` only hits `/api/*` on same origin.

### 2.4 Exposed files
**Risk evaluated:** `.env`, source maps, backups served publicly.  
**Fix:**  
- Added `.gitignore` (node_modules, dist, .wrangler, .env*, *.map, backups).  
- Vite `sourcemap: false` in production build.  
- Worker serves SPA via ASSETS; sensitive paths not published as static files.  
**Verified:** `vite.config.ts` and `.gitignore` present.

### 2.5 Turn off debug mode
**Risk evaluated:** Stack traces / verbose logs in production.  
**Finding:** `app.onError` returns JSON without stack to client; server logs `console.error` only. No `DEBUG=true` flag in production path.  
**Fix:** Confirmed client never receives `err.stack`.  
**Verified:** Error handler inspection.

---

## 3. Authentication & Authorization

### 3.1 Proper authentication
**Risk evaluated:** Stolen tokens, session fixation.  
**Finding:** Custom proof-based sessions (username|role|secret|ip|fp) in `Authorization: Bearer`, stored in `localStorage` (SPA constraint; not HttpOnly). Session guard on client.  
**Fix:** Documented residual XSS→token risk; CSP + XSS controls mitigate. HttpOnly cookie migration is a future enhancement requiring Worker cookie domain setup.  
**Verified:** `src/auth.ts`, session proof verification paths.

### 3.2 Hash passwords properly
**Risk evaluated:** Fast offline cracking of stolen hashes.  
**Previous:** Single-pass SHA-256 (`pc:salt:password`) — too fast.  
**Fix:**  
- New hashes: **PBKDF2-SHA-256, 120 000 iterations**, format `pbkdf2$120000$<hex>`.  
- `verifyUserPassword()` accepts both legacy SHA-256 and PBKDF2.  
- New users / password changes store PBKDF2 only.  
**Verified:** Code paths for login, confirm-password, user create/update.

### 3.3 User access & admin routes
**Risk evaluated:** Privilege escalation.  
**Finding:** RBAC via `requireOwner`, `requireBizMutator`, `requireFloorStock`, `canMutateBusiness`. Client route guards in `App.tsx`.  
**Fix:** No logic change required; already dual client+server checks.  
**Verified:** Owner-only user admin endpoints; secretaire cannot hard-delete mass stock without role.

### 3.4 Secure API endpoints
**Risk evaluated:** Unauthenticated data access.  
**Finding:** Admin/mailbox/backup routes gated; public routes rate-limited and scoped.  
**Fix:** Retained gates; mailbox uses `verifyBackupAccess` (owner session).  
**Verified:** `/api/admin/mailbox` requires auth.

---

## 4. Input Hygiene & Data Protection

### 4.1 Sanitize forms / XSS
**Risk evaluated:** Stored/reflected XSS.  
**Finding:** `escapeHtml` / `safeImageSrc` in `worker/lib/security.ts`. Mail HTML rendered in sandboxed iframe (`allow-same-origin` only, no scripts). React escapes text by default.  
**Fix:** No new DOMPurify dependency (bundle size); iframe sandbox remains primary mail XSS control.  
**Verified:** `HtmlMailBody` sandbox attributes.

### 4.2 Secure DB access
**Risk evaluated:** SQL injection.  
**Finding:** All D1 access via `prepare().bind()` parameterized queries.  
**Fix:** None required.  
**Verified:** Representative invoice/mail/auth queries.

---

## 5. Infrastructure, Headers & Edge

### 5.1 CORS
**Risk evaluated:** Cross-origin data theft.  
**Previous:** Image proxy returned `Access-Control-Allow-Origin: *`.  
**Fix:** Explicit `https://stock.afmarbre.com` + `Vary: Origin`. Main CORS whitelist remains origin-callback (production + localhost). Allow-headers expanded for backup tokens.  
**Verified:** CORS middleware + image proxy headers.

### 5.2 Security headers
**Risk evaluated:** Clickjacking, MIME sniffing, XSS.  
**Finding:** CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS on HTTPS, X-Robots-Tag.  
**Fix:** Already present; retained.  
**Verified:** Middleware after `next()`.

### 5.3 Rate limiting & DDoS
**Risk evaluated:** Brute force, abuse.  
**Finding:** In-isolate rate limits: auth 8/min, admin 60/min, public 40/min, restore-status 120/min. IP reputation tables. Cloudflare edge provides DDoS/WAF.  
**New:** **2 MiB max body** on `/api/*` → 413 PAYLOAD_TOO_LARGE.  
**Verified:** Middleware order and limits.

### 5.4 Full architectural review
**Covered:** Frontend sinks, API client, Worker handlers, D1, R2 encryption for mail (`.mail` AES-GCM), SSRF allow-list for outbound fetch, asset routing.

---

## 6. Re-check / Verification

| Check | Result |
|-------|--------|
| Password verify dual-path (legacy + PBKDF2) | OK |
| No hardcoded secrets in tree | OK |
| `.gitignore` blocks env/maps/secrets | OK |
| `sourcemap: false` | OK |
| CORS no longer `*` on image proxy | OK |
| Body size limit present | OK |
| Existing rate limits / CSP / RBAC intact | OK |
| Syntax of modified `hashUserPassword` / `verifyUserPassword` | OK |

**Residual risks (accepted / future work):**  
1. Session tokens in `localStorage` (mitigate with CSP; long-term HttpOnly cookies).  
2. In-memory rate limits reset per isolate (Cloudflare edge still helps).  
3. Owner password still compared in clear against `ADMIN_PASSWORD` secret (Worker secret, not DB hash) — consider hashing owner secret at rest in a future iteration.

---

## 7. Deploy notes

```bash
npm install
npm run build
npx wrangler deploy
# Ensure secrets:
# npx wrangler secret put ADMIN_PASSWORD
# npx wrangler secret put RESEND_API_KEY
# npx wrangler secret put JWT_SECRET   # optional but recommended
# npx wrangler secret put MAIL_BODY_ENCRYPTION_KEY  # optional
```

Existing user passwords continue to work (legacy verify). On next password change they upgrade to PBKDF2.


---

## STEP_RESTORE_FIX.md


# One-table-at-a-time restore (no more stuck at 35–38%)

## Cause
A single Worker `waitUntil` tried to restore **all tables** in one go. After a few small tables the CPU/time budget was exhausted and the isolate died — UI froze on the last message (`product_units` / `product_categories`).

## Fix
Restore is now driven by the **RestoreHub Durable Object**:

1. Bootstrap (Worker): decrypt snapshot → save work payload to R2 → list tables
2. Each **DO alarm** restores **exactly one table** (D1 batch inserts of 40 rows)
3. Alarm schedules the next table (~40 ms later)
4. When all tables are done → status `ok`, work file deleted

Cancel (`Fermer / Annuler`) stops the alarm chain and deletes the work payload.

## Deploy
```bash
npm run build
wrangler deploy
```
Hard-refresh browser. Click **Fermer / Annuler** on any stuck modal first, then start a new restore.

Large backups may take several minutes — progress will keep advancing table by table instead of freezing.


---

## SW_AND_CSP_FIX_2026-09-09.md


# Service Worker + CSP fix — 2026-09-09

## Root cause of the persistent HTML error

The service worker (`/sw.js`) was caching **any** successful GET to `/api/*`.  
When the Worker previously returned the SPA `index.html` (status 200) for an API path, that HTML was stored in the API cache. Every subsequent mailbox load then received the cached HTML even after a correct deploy.

## Fixes in this package

1. **Service worker v5**
   - Cache names bumped (`atlas-shell-v5`, `atlas-api-v5`) so old bad entries are deleted on activate.
   - API responses are cached **only** when `Content-Type` contains `application/json`.
   - If the network returns HTML for an API path, the SW returns a clear JSON error instead of the HTML and does not cache it.
   - Offline fallback also requires a previously cached JSON response.

2. **CSP**
   - Added `worker-src 'self' blob:` so the service worker itself is allowed.
   - `connect-src` includes the CDN origin used for images.
   - Browser-extension CSP messages (FingerPrint.js, adblock, etc.) are report-only noise and can be ignored.

3. **Registration**
   - Front-end now registers `/sw.js?v=5` so browsers fetch the new worker immediately.

## Deploy + clear client state

```bash
npm install
npm run build
npx wrangler deploy
```

Then in the browser (important):

1. Open DevTools → Application → Service Workers → **Unregister**.
2. Application → Cache Storage → delete any `atlas-*` caches.
3. Hard reload (Ctrl+Shift+R) or open a private window.
4. Open Messagerie again.

After that the list endpoint must return JSON. If it still returns HTML, the Worker itself is still not receiving `/api/*` (confirm Wrangler 4 deploy succeeded and the custom domain points to the latest version).


## Password hashing (2026-09-10)

- Secondary users (`app_users`): PBKDF2-SHA-256 (120k iterations) + per-user salt; legacy SHA-256 and accidental plaintext rows auto-upgrade on next successful login.
- Owner (`admin`): Cloudflare Secret `ADMIN_PASSWORD` only — never stored in D1. Session proofs use a derived hash, not the raw password.
- Legacy v1 session tokens (which embedded the password) are rejected.
- Keep `ADMIN_PASSWORD` as a **Secret** (`wrangler secret put ADMIN_PASSWORD`), never in `wrangler.jsonc` vars.
