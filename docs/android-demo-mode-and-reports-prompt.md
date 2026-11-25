# Atlas Commerce Android: demo mode (`test` / `test`) and per-app crash reports (strict prompt)

> Paste this whole file as the task for the agent working in `Etherealmber/atlas-commerce-android`.
> Goal: the Android app supports the **demo mode** shipped on web in 0.9.3, and its crash reports and user reports are **routed to the Android repo**. The backend is already live. **No backend change is needed.**

---

## 0. Rules

- **Copy, do not reinterpret.** Use the French text below verbatim (including `’`, `…` and `—`).
- **Never mix demo and real sessions.** A demo token must never be saved as a "saved account" or used for biometric / passkey enrolment. It must never be written over a real session.
- **0 lint warnings and 0 errors.** Existing tests stay green. Add tests for every rule in §2–§4.
- **Do not bump `versionName` or `versionCode`.** The version stays **0.9.3**.

---

## 1. Sources of truth (web repo `Etherealmber/atlas-commerce`, branch `main`)

| What | Path |
|---|---|
| Demo gateway (login, quota, token wrapping) | `worker/lib/demo/gateway.ts`, `worker/lib/demo/policy.ts` |
| Web demo session + countdown chip + intro dialog | `src/lib/demoSession.ts`, `src/context/DemoContext.tsx`, `src/styles/demo-session.css` |
| Web login handling of `demo` + error codes | `src/pages/Login.tsx` (`afterToken`, `REASON_MESSAGES`) |
| Report routing (web vs android) | `worker/lib/reports.ts` (`classifyReportChannel`), `docs/reports-github.md` |

---

## 2. Demo login

1. The normal login call is unchanged: `POST /api/auth/login` with `{ username: "test", password: "test", fingerprint, client: "native" }` plus the usual headers (`X-Atlas-Client: native`, `X-Device-Fingerprint`). **Send a stable device fingerprint.** The 20-minute quota is counted per fingerprint. Without one, the server falls back to IP + User-Agent.
2. Optional: `GET /api/demo/config` → `{ enabled, username, password, minutes, window_hours, message }`. When `enabled` is true, show this note under the login form (web copy):
   title **« Essayer sans compte »**, then **« Identifiant `test` · mot de passe `test` — 20 min de test toutes les 24 h, sur une base fictive réinitialisée ensuite. »** (values from the config).
3. Success response: same shape as a normal login, plus:
   ```json
   "demo": { "active": true, "state": "new|active", "minutes": 20, "window_hours": 24,
             "started_at": 1760000000000, "expires_at": 1760001200000, "message": "…" }
   ```
   The timestamps are **milliseconds**. The token starts with **`atlasdemo.`**. Use it like any bearer token. The server routes every request to the isolated demo database.
4. Errors (show `error` from the body. The fallback texts are the web ones):
   | HTTP | `code` | Fallback text |
   |---|---|---|
   | 429 | `DEMO_QUOTA` | « Vous avez déjà utilisé vos 20 minutes de démo pour aujourd’hui. » |
   | 401 | `DEMO_EXPIRED` | « Votre session de démo est terminée : la base fictive a été réinitialisée. » |
   | 503 | `DEMO_UNAVAILABLE` | « Le mode démo est indisponible sur ce déploiement. » |
5. After a demo login: **skip** the "activer la biométrie / clé de sécurité" offer and **skip** the saved-accounts upsert. Go straight to Home.

## 3. Demo session UI

- **Intro sheet** (once per session, when `demo.state == "new"`). Title **« 20 minutes pour tout essayer »**, badge **« MODE DÉMO »**, four bullets:
  - **20 min d’essai**, une fois toutes les 24 heures sur cet appareil.
  - **Données fictives** : créez, modifiez ou supprimez librement produits, ventes, clients…
  - **Remise à zéro automatique** : la base de démo est effacée à la fin des 20 minutes.
  - **Aucun accès à vos vraies données** : la démo tourne sur sa propre petite base SQLite.

  Show « Temps restant : mm:ss » under the bullets. The only button is **« Commencer la démo »** (filled pill, full width).
- **Countdown chip** on every screen (bottom start, above the nav bar). It shows « DÉMO », `mm:ss`, an « i » button that reopens the intro, and a **« Quitter »** pill. It uses the same dark pill style as web `.demo-chip`.
- At `expires_at`, or on any `401 DEMO_EXPIRED`: clear the demo token and return to Login with the `DEMO_EXPIRED` message. Never retry with the old token.
- « Quitter »: clear the demo token locally and return to Login. No server call is needed.

## 4. Crash reports and user reports → Android repo

The server now keeps **one GitHub repo and one token per app**. Android reports go to `Etherealmber/atlas-commerce-android` with the `GITHUB_ISSUE_TOKEN` secret. Web reports go to `atlas-commerce` with their own secret.

- Add **`"platform": "android"`** to every `POST /api/crash-reports` body and every `POST /api/reports` body. The explicit field wins over User-Agent sniffing. An OkHttp User-Agent is still classified as Android, but do not rely on it.
- Crash body: `{ message, stack?, componentStack?, route?, version?, ua?, platform: "android" }`. `route` is the screen name (e.g. `ProductsScreen`). `version` is `versionName`.
- Ignore crashes that come from inside a WebView page you do not own.

## 5. Tests to add

- A demo login stores a token that starts with `atlasdemo.`, does not create a saved account and does not show the biometric offer.
- The countdown reaches 0 → token cleared → Login shows the expired message.
- 429 / 401 / 503 demo codes show the right text.
- Crash and report request bodies contain `platform = "android"`.
