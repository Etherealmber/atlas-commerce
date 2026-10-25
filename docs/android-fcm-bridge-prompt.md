# Android FCM bridge — paste-prompt & manual guide (v256)

The Atlas worker already sends pushes over **FCM HTTP v1** (`worker/lib/fcm.ts`)
and already accepts device tokens at **`POST /api/assist/device-token`**
(session-authenticated, upserts into `device_push_tokens`). What was missing is
the **native Android side**: the Firebase Messaging SDK, a messaging service,
and the token-registration call. This bundle adds exactly that.

Two files deliver it:

- **`docs/android-fcm-bridge.patch`** — ready-to-apply git patch for
  `Etherealmber/atlas-commerce-android` (base: `8c6d099`, v1.1.1).
- **This document** — a paste-prompt for an agent with write access to the
  Android repo, plus the Firebase console prerequisites.

---

## Paste-prompt (copy everything below into an agent on the Android repo)

> Apply the attached patch `android-fcm-bridge.patch` to this repo
> (`git apply android-fcm-bridge.patch`). It adds the FCM push bridge:
>
> 1. Root `build.gradle.kts`: `com.google.gms.google-services` 4.4.2 (`apply false`).
> 2. `app/build.gradle.kts`: firebase-bom 33.7.0 + `firebase-messaging` +
>    `kotlinx-coroutines-play-services` 1.9.0, and a **conditional**
>    `apply(plugin = "com.google.gms.google-services")` that runs only when
>    `app/google-services.json` exists — so the build never breaks without it.
> 3. `AndroidManifest.xml`: `<service .push.AtlasFirebaseMessagingService>` with
>    the `com.google.firebase.MESSAGING_EVENT` intent filter.
> 4. New package `ma.etherealmber.atlascommerce.push`:
>    - `DeviceTokenRequest.kt` — Moshi DTOs for `POST /api/assist/device-token`.
>    - `PushTokenRegistrar.kt` — Hilt singleton; registers the FCM token with
>      the worker after every session activation; no-ops when Firebase is not
>      configured.
>    - `AtlasFirebaseMessagingService.kt` — `onNewToken` re-registration +
>      foreground/data-only notification display on channel `atlas_assist`.
> 5. `AtlasApi.kt`: `registerDeviceToken(@Body DeviceTokenRequest)` endpoint.
> 6. `AtlasApp.kt`: creates the `atlas_assist` notification channel (the worker
>    targets `channel_id: "atlas_assist"` on every push — without the channel
>    Android drops the notification).
> 7. `SessionManager.kt`: injects `PushTokenRegistrar` and calls
>    `onSessionActive()` whenever `SessionState.Active` is emitted (restore,
>    password login, QR pairing).
>
> After applying: do NOT commit a `google-services.json`. Bump the app to
> 1.2.0 (120) only if a release is cut. Build with `./gradlew assembleDebug`
> to verify. If `google-services.json` is absent the build must still succeed
> (that is the point of the conditional apply).

---

## Firebase console prerequisites (one-time, per deployment)

1. In the [Firebase console](https://console.firebase.google.com), create/open
   the project used by the Cloudflare Worker (its ID is the value of the
   worker secret `FIREBASE_PROJECT_ID`).
2. **Add an Android app** with package name `ma.etherealmber.atlascommerce`.
3. Download `google-services.json` → place it at `app/google-services.json`
   (git-ignored; never commit it).
4. In the same project: **Project settings → Service accounts → Generate new
   private key** → the JSON gives you the three worker secrets:
   - `FIREBASE_PROJECT_ID` = `project_id`
   - `FIREBASE_CLIENT_EMAIL` = `client_email`
   - `FIREBASE_PRIVATE_KEY` = `private_key` (PEM; keep the `\n` escapes)

## Worker-side secrets (already supported — verify they are set)

```bash
# from the atlas-commerce repo root (web + worker)
npx wrangler secret list                 # shows which secrets exist
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY   # paste PEM with \n newlines
# legacy fallback only (deprecated HTTP API):
npx wrangler secret put FCM_SERVER_KEY
```

Behavior when the secrets are missing: `sendFcmToUser()` finds no
`FIREBASE_PROJECT_ID` → no access token → falls back to `FCM_SERVER_KEY`; if
neither exists it sends nothing and returns `{ sent: 0 }` (no crash, no error
to callers). Registered tokens stay in D1, so pushes start flowing as soon as
the secrets are set.

## Verification checklist

- [ ] `git apply --check docs/android-fcm-bridge.patch` passes in the Android repo.
- [ ] `./gradlew assembleDebug` succeeds (with and without `google-services.json`).
- [ ] Sign in on a device → worker log shows `POST /api/assist/device-token` 200;
      row appears in `device_push_tokens` (`SELECT username, platform, updated_at FROM device_push_tokens`).
- [ ] Trigger a push (e.g. finance reminder cron or assist approval) →
      notification appears on channel “Assistant & notifications serveur”.

## Employee self-payroll (same release, no Android patch required yet)

`GET /api/me/payroll` is live on the worker (see `docs/api-finance.md`): any
signed-in session gets ONLY its own pay date/amount via the linked employee
file (`employees.user_username`, set by an admin in the employee form). Android
can call it with the existing Retrofit client — add the endpoint + a Profil
screen row when the next native release is cut.
