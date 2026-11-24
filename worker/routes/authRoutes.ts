import type { AtlasApp } from './types';
import type { Env } from '../env';
import { addColumnIfMissing } from '../lib/schema';
import { normalizeRole } from '../lib/rbac';
import { registerDesktopAuthRoutes } from './desktopAuth';
import { registerDesktopNativeDiscovery } from './desktopNativeDiscovery';
import { registerDesktopPilotWebView } from '../lib/desktop-pilot-webview';
import { registerDesktopNativeV2 } from './desktopNativeV2';
import { registerDesktopV3WebView } from '../lib/desktop-v3-webview';
import { registerDesktopNativeV3 } from './desktopNativeV3';
import { registerReportsAndUpdatesRoutes } from './index';
import {
  consumeChallenge as waConsumeChallenge,
  createChallenge as waCreateChallenge,
  androidLegacyOrigin,
  androidOrigin,
  androidOrigins,
  credentialDescriptors,
  expectedOrigin,
  parseClientData,
  policyFromEnv,
  userHandleFor,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnPolicy,
} from '../lib/webauthn';
import { qrToSvg } from '../qrSvg';
import { purgeEphemeralSecurityData, sha256Hex } from '../lib/ledgerHelpers';

export interface AuthRoutesDeps {
  authFailReason: any;
  clientIp: any;
  credentialAttemptGate: any;
  derivePbkdf2Bits: any;
  ensureSecurityTables: any;
  generateOTP: any;
  getConfig: any;
  getOwnerUsername: any;
  getPassword: any;
  getReputation: any;
  isModernPasswordHash: any;
  isNativeAuthRequest: any;
  isRateLimited: any;
  makeTokenV2: any;
  nativeCurrentIdentity: any;
  normalizePassword: any;
  otpEmailHTML: any;
  parseToken: any;
  passwordsMatch: any;
  recordLogin: any;
  resolveUserProfileAvatar: any;
  secretMaterialForUsername: any;
  sendOtpMail: any;
  sessionUserFromHeader: any;
  trustDevice: any;
  upgradeUserPasswordHash: any;
  verifyTurnstile: any;
  verifyUserPassword: any;
  writeAudit: any;
}

export function registerAuthRoutes(app: AtlasApp, deps: AuthRoutesDeps) {
  const {
    authFailReason,
    clientIp,
    credentialAttemptGate,
    derivePbkdf2Bits,
    ensureSecurityTables,
    generateOTP,
    getConfig,
    getOwnerUsername,
    getPassword,
    getReputation,
    isModernPasswordHash,
    isNativeAuthRequest,
    isRateLimited,
    makeTokenV2,
    nativeCurrentIdentity,
    normalizePassword,
    otpEmailHTML,
    parseToken,
    passwordsMatch,
    recordLogin,
    resolveUserProfileAvatar,
    secretMaterialForUsername,
    sendOtpMail,
    sessionUserFromHeader,
    trustDevice,
    upgradeUserPasswordHash,
    verifyTurnstile,
    verifyUserPassword,
    writeAudit,
  } = deps;

/* ─── Auth Routes ─── */

app.get('/api/auth/turnstile-config', (c) => {
  const siteKey = String(c.env.TURNSTILE_SITE_KEY || '').trim();
  const secretOk = !!(String(c.env.TURNSTILE_SECRET_KEY || '').trim());
  const isNative = isNativeAuthRequest(c, {
    client: c.req.query('client') || c.req.header('X-Atlas-Client') || '',
  });
  // Native APK / WebView: never expose site key. Browser only when both keys set.
  const enabled = !isNative && !!(siteKey && secretOk);
  return c.json({
    success: true,
    data: {
      enabled,
      site_key: enabled ? siteKey : null,
      web_only: true,
      native_skip: isNative,
    },
  });
});

app.post('/api/auth/login', async (c) => {
  let accountEmail = '';
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? getOwnerUsername(c.env)).trim().toLowerCase();
  const password = String(body.password ?? '');
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  const turnstileToken = String(body.turnstile_token || body['cf-turnstile-response'] || '');
  const isNativeClient = isNativeAuthRequest(c, body as Record<string, unknown>);
  const ts = await verifyTurnstile(c.env, turnstileToken, ip, { native: isNativeClient });
  if (!ts.ok) {
    return c.json({ success: false, error: ts.error, code: 'TURNSTILE_FAILED' }, 403);
  }

  await ensureSecurityTables(c.env.DB);
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  const limitResponse = await credentialAttemptGate(c, username, 'password');
  if (limitResponse) return limitResponse;

  const ownerUser = getOwnerUsername(c.env);
  let role = 'user';
  let secretMaterial = '';
  let displayName = username;

  if (username === ownerUser) {
    // Original owner — password from Cloudflare secret ADMIN_PASSWORD
    const expected = getPassword(c.env);
    if (!expected) {
      return c.json({
        success: false,
        error: 'Le mot de passe administrateur n\'est pas configuré (secret ADMIN_PASSWORD).',
        code: 'NO_PASSWORD_CONFIGURED',
      }, 503);
    }
    if (!passwordsMatch(password, expected)) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
      await writeAudit(c.env.DB, { username, role: 'owner', action: 'auth.login_failed', entity: 'session', detail: 'bad_password', ip });
      const rep2 = await getReputation(c.env.DB, ip) as any;
      return c.json({
        success: false,
        error: 'Identifiant ou mot de passe incorrect',
        code: 'BAD_PASSWORD',
        reputationScore: rep2.score,
      }, 401);
    }
    role = 'owner';
    accountEmail = '';
    // Derive session material from password — never embed the raw ADMIN_PASSWORD in tokens
    secretMaterial = await sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
    displayName = 'Administrateur';
  } else {
    // Secondary user from app_users table
    const row = await c.env.DB.prepare(
      `SELECT * FROM app_users WHERE username = ? AND active = 1`
    ).bind(username).first() as any;
    if (!row) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
      return c.json({ success: false, error: 'Identifiant ou mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
    }
    if (!(await verifyUserPassword(password, row.password_salt, row.password_hash))) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
      const ph = String(row.password_hash || '');
      const highIter = /^pbkdf2\$(\d+)\$/i.exec(ph);
      const iters = highIter ? parseInt(highIter[1], 10) : 0;
      if (iters > 100_000) {
        return c.json({
          success: false,
          error:
            'Ce compte utilise un ancien hachage mot de passe (120k itérations) incompatible avec la plateforme. Un administrateur doit réinitialiser le mot de passe depuis Admin → Utilisateurs.',
          code: 'PASSWORD_REHASH_REQUIRED',
        }, 401);
      }
      return c.json({ success: false, error: 'Identifiant ou mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
    }
    role = ['owner', 'admin', 'secretaire', 'stock', 'user'].includes(String(row.role))
      ? String(row.role)
      : 'user';
    // Never keep plaintext or weak hashes in D1 — upgrade to PBKDF2 on successful login
    let hashForSession = String(row.password_hash || '');
    if (!isModernPasswordHash(hashForSession)) {
      hashForSession = await upgradeUserPasswordHash(c.env.DB, Number(row.id), password);
    }
    secretMaterial = hashForSession;
    displayName = row.display_name || username;
    accountEmail = String(row?.email || '').trim();
    await c.env.DB.prepare(`UPDATE app_users SET last_login = datetime('now') WHERE id = ?`).bind(row.id).run();
  }

  // v0.7.5 — reprise après auto-déconnexion : même compte + même appareil +
  // marque resume_until valide (<= 30 j) + 2FA désactivée → pas d'OTP.
  // Le trou v0.7.1 reste fermé : un AUTRE compte sur l'appareil garde l'OTP.
  if (fingerprint && fingerprint !== 'none') {
    try {
      const twofaOn = (await getConfig(c.env.DB, 'twofa_enabled', '0')) === '1';
      if (!twofaOn) {
        // Atomic check + consumption: two simultaneous logins cannot both
        // reuse one marker. Password validation above remains mandatory.
        const rrow = await c.env.DB.prepare(
          `UPDATE trusted_devices SET resume_until = '', last_seen = datetime('now'), last_ip = ?
           WHERE fingerprint = ? AND lower(username) = ?
             AND resume_until != '' AND resume_until > datetime('now')
           RETURNING username`,
        ).bind(ip, fingerprint.slice(0, 128), username).first() as any;
        if (rrow) {
          await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
          await writeAudit(c.env.DB, { username, role, action: 'auth.login', entity: 'session', detail: 'resume_after_self_logout', ip });
          const resumeToken = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
          return c.json({
            success: true,
            needs_otp: false,
            trusted_device: true,
            token: resumeToken,
            ip,
            username,
            role,
            displayName,
            message: 'Appareil repris après votre déconnexion — code non requis.',
          });
        }
      }
    } catch { /* repli OTP */ }
  }

  // v0.7.1 — OTP REQUIRED FOR EVERY PASSWORD LOGIN (owner and users),
  // including first-ever login of a brand-new account and account switching
  // on an already-trusted device. The trusted-device shortcut was the hole:
  // being logged in as A on a trusted device let B sign in with no OTP.
  // (WebAuthn/passkey login stays a separate, possession-based flow.)

  // New device — OTP required (owner and users) — fast path: parallel DB + background email
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const loginResourceId = fingerprint !== 'none' ? `fp:${fingerprint}` : `ip:${ip}`;
  const ctxJson = JSON.stringify({ username, role, secretMaterial });
  // Cloudflare Email binding only allows the configured destination (admin@).
  // security@ is valid as FROM only — never as TO or sends fail with "not allowed".
  const fromAddr = (c.env.OTP_FROM || (c.env as any).RESEND_FROM || 'noreply@afmarbre.com').trim() || 'security@afmarbre.com';
  // v235+v0.7.1 — the user's own inbox first; else the company MAIN email
  // (company_settings.email) until the user has one; else configured inbox.
  let toAddr = accountEmail;
  // One-tap verification link: the SPA /verify page submits the code itself
  // (and hands off to the PWA / native Android app when present) — the user
  // never types the OTP.
  const linkExp = new Date(expiresAt).getTime();
  const linkSig = await sha256Hex(`otplink|${username}|${otp}|${linkExp}|${secretMaterial}`);
  const verifyUrl =
    `https://stock.afmarbre.com/verify?user=${encodeURIComponent(username)}` +
    `&code=${encodeURIComponent(otp)}&sig=${linkSig}&exp=${linkExp}`;

  // Parallel: OTP rows + company name
  const [settings] = await Promise.all([
    c.env.DB.prepare(`SELECT company_name, email FROM company_settings WHERE id = 1`).first() as Promise<any>,
    c.env.DB.prepare(
      `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'login', ?, ?)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
    ).bind(otp, loginResourceId, expiresAt, otp, expiresAt).run(),
    c.env.DB.prepare(
      `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'login_ctx', ?, ?)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
    ).bind(ctxJson, loginResourceId, expiresAt, ctxJson, expiresAt).run(),
  ]);
  const companyName = settings?.company_name || 'Atlas Commerce';
  if (!toAddr) toAddr = String(settings?.email || '').trim();
  if (!toAddr) {
    toAddr = (c.env.OTP_TO || 'security@afmarbre.com').trim() || 'admin@afmarbre.com';
    if (toAddr.toLowerCase() === fromAddr.toLowerCase() || toAddr.toLowerCase() === 'security@afmarbre.com') {
      toAddr = 'admin@afmarbre.com';
    }
  }
  const emailHtml = otpEmailHTML(otp, 'connexion', companyName, 'login', {
    ip,
    ua,
    fingerprint: fingerprint !== 'none' ? fingerprint : undefined,
    username,
    verifyUrl,
  });
  const emailText =
    `Code de vérification : ${otp}\n\n` +
    `Utilisez ce code pour confirmer votre connexion sur ${companyName} (valable 10 minutes).\n` +
    `Lien de vérification : ${verifyUrl}\n\n` +
    `---\n` +
    `Compte : ${username}\n` +
    `IP : ${ip}\n` +
    `Empreinte : ${fingerprint}\n` +
    `Appareil : ${ua.slice(0, 160)}`;

  // Free tier: no Queues (paid). Background email via waitUntil only — do not block the response.
  if (!c.env.EMAIL?.send) {
    // Local development without an e-mail binding: the OTP could never
    // arrive, so trust this device and continue. Production ALWAYS binds
    // EMAIL, therefore the e-mail OTP remains enforced everywhere else.
  await trustDevice(c.env.DB, fingerprint, ip, username, c.req.header('User-Agent') || '');
    await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
    await writeAudit(c.env.DB, { username, role, action: 'auth.login', entity: 'session', detail: 'dev_no_email_binding', ip });
    const devToken = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
    return c.json({
      success: true,
      needs_otp: false,
      trusted_device: true,
      token: devToken,
      ip,
      username,
      role,
      displayName,
      message: 'Environnement local sans service e-mail — appareil approuvé automatiquement.',
    });
  }
  // OTPs are never written to logs, including on development/preview hosts.
  const sendTask = sendOtpMail(c.env, {
    to: toAddr,
    from: fromAddr,
    subject: `${otp} — Code de connexion ${companyName}`,
    html: emailHtml,
    text: emailText,
  }).then((ok: any) => {
    if (!ok) console.error('otp_email_failed_all_transports', username);
  });
  try {
    const ec = (c as any).executionCtx;
    if (ec?.waitUntil) ec.waitUntil(sendTask);
    else void sendTask;
  } catch {
    void sendTask;
  }

  const masked = toAddr.replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2');
  return c.json({
    success: true,
    needs_otp: true,
    emailed: true,
    username,
    otp_sent_to: masked,
    message: `Un code de vérification a été envoyé à ${masked}. Vérifiez votre boîte de réception.`,
  });
});

app.post('/api/auth/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? getOwnerUsername(c.env)).trim().toLowerCase();
  const password = String(body.password ?? '');
  const otp = String(body.otp || '').trim();
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  await ensureSecurityTables(c.env.DB);

  const loginResourceId = fingerprint !== 'none' ? `fp:${fingerprint}` : `ip:${ip}`;
  // Bind attempts to the server's pending login principal, not a username an
  // attacker can rotate while guessing one fingerprint-scoped OTP.
  const ctxRow = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(loginResourceId).first() as any;
  let otpSubject = username;
  try { otpSubject = String(JSON.parse(ctxRow?.code || '{}').username || username).trim().toLowerCase(); } catch { /* legacy context fallback */ }
  const limitResponse = await credentialAttemptGate(c, otpSubject, 'otp');
  if (limitResponse) return limitResponse;
  if (otpSubject !== username) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Code incorrect', code: 'BAD_OTP' }, 401);
  }

  if (!otp || otp.length < 4) {
    return c.json({ success: false, error: 'Code OTP obligatoire', code: 'OTP_REQUIRED' }, 400);
  }

  const record = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(loginResourceId).first() as any;

  if (!record) {
    return c.json({
      success: false,
      error: 'Aucun code demandé. Veuillez d\'abord saisir votre mot de passe.',
      code: 'OTP_NOT_REQUESTED',
    }, 400);
  }
  if (record.code !== otp) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Code incorrect', code: 'BAD_OTP' }, 401);
  }
  if (new Date(record.expires_at) < new Date()) {
    return c.json({
      success: false,
      error: 'Code expiré. Veuillez recommencer la connexion.',
      code: 'OTP_EXPIRED',
    }, 400);
  }

  // Restore the already-loaded server login context.
  let role = 'owner';
  let secretMaterial = '';
  let user = username;

  if (ctxRow?.code) {
    try {
      const ctx = JSON.parse(ctxRow.code);
      user = ctx.username || username;
      role = ctx.role || 'owner';
      secretMaterial = ctx.secretMaterial || '';
    } catch { /* fall through */ }
  }

  if (!secretMaterial) {
    // Re-validate password to rebuild secret
    const ownerUser = getOwnerUsername(c.env);
    if (user === ownerUser) {
      const expected = getPassword(c.env);
      if (!expected || !passwordsMatch(password, expected)) {
        return c.json({ success: false, error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
      }
      role = 'owner';
      secretMaterial = await sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
    } else {
      const row = await c.env.DB.prepare(`SELECT * FROM app_users WHERE username = ? AND active = 1`).bind(user).first() as any;
      if (!row) return c.json({ success: false, error: 'Utilisateur introuvable', code: 'BAD_PASSWORD' }, 401);
      if (!(await verifyUserPassword(password, row.password_salt, row.password_hash))) {
        const ph = String(row.password_hash || '');
        const highIter = /^pbkdf2\$(\d+)\$/i.exec(ph);
        const iters = highIter ? parseInt(highIter[1], 10) : 0;
        if (iters > 100_000) {
          return c.json({
            success: false,
            error: 'Ancien hachage mot de passe (120k) — un admin doit réinitialiser le mot de passe.',
            code: 'PASSWORD_REHASH_REQUIRED',
          }, 401);
        }
        return c.json({ success: false, error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
      }
      role = row.role;
      let hashForSession = String(row.password_hash || '');
      if (!isModernPasswordHash(hashForSession)) {
        hashForSession = await upgradeUserPasswordHash(c.env.DB, Number(row.id), password);
      }
      secretMaterial = hashForSession;
    }
  }

  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?`).bind(loginResourceId).run();
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ?`).bind(loginResourceId).run();
  // Best-effort: sweep all expired security rows
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  await trustDevice(c.env.DB, fingerprint, ip, username, c.req.header('User-Agent') || '');
  await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
  const rep = await getReputation(c.env.DB, ip) as any;
  const token = await makeTokenV2(user, role, secretMaterial, ip, fingerprint);
  return c.json({
    success: true,
    trusted_device: true,
    token,
    ip,
    username: user,
    role,
    reputationScore: rep.score,
  });
});

/* ─── One-tap e-mail verification link (2026-10-23) ───────────────────────
 * The OTP e-mail carries a signed link (?user&code&sig&exp). Opening it —
 * in the browser, the installed PWA, or the native Android app — verifies
 * the device WITHOUT typing the code: possession of the signed link is the
 * first factor, the OTP row check the second. Single use: the login rows are
 * consumed on success. Cross-device by design (mail opened on the phone
 * while the PC requested the login): the OTP row is looked up by code, not
 * by requesting fingerprint. Signature = sha256(otplink|user|otp|exp|secret)
 * so a leaked URL cannot be replayed after expiry nor tampered with.
 * ──────────────────────────────────────────────────────────────────────── */
app.post('/api/auth/verify-link', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? '').trim().toLowerCase();
  const otp = String(body.otp || '').trim();
  const sig = String(body.sig || '');
  const exp = Number(body.exp || 0);
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  await ensureSecurityTables(c.env.DB);
  const limitResponse = await credentialAttemptGate(c, username, 'otp');
  if (limitResponse) return limitResponse;
  if (!username || !otp || otp.length < 4 || !sig || !exp) {
    return c.json({ success: false, error: 'Lien de vérification incomplet', code: 'LINK_MALFORMED' }, 400);
  }
  if (Date.now() > exp) {
    return c.json({ success: false, error: 'Lien expiré — reconnectez-vous', code: 'LINK_EXPIRED' }, 400);
  }

  // Device-independent lookup: the e-mail may be opened anywhere.
  const record = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login' AND code = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(otp).first() as any;
  if (!record) return c.json({ success: false, error: 'Code invalide ou déjà utilisé', code: 'BAD_OTP' }, 401);
  if (new Date(record.expires_at) < new Date()) {
    return c.json({ success: false, error: 'Code expiré. Veuillez recommencer la connexion.', code: 'OTP_EXPIRED' }, 400);
  }

  let user = username;
  let role = 'owner';
  let secretMaterial = '';
  const ctxRow = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(record.resource_id).first() as any;
  if (ctxRow?.code) {
    try {
      const ctx = JSON.parse(ctxRow.code);
      user = ctx.username || user;
      role = ctx.role || 'owner';
      secretMaterial = ctx.secretMaterial || '';
    } catch { /* fall through */ }
  }
  if (String(user).trim().toLowerCase() !== username) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Lien invalide', code: 'LINK_INVALID' }, 401);
  }
  if (!secretMaterial) {
    secretMaterial = (await secretMaterialForUsername(c.env, c.env.DB, user, role)) || '';
  }
  if (!secretMaterial) return c.json({ success: false, error: 'Compte introuvable', code: 'BAD_PASSWORD' }, 401);

  // Constant-time signature check (recomputed exactly as at send time)
  const expected = await sha256Hex(`otplink|${user}|${otp}|${exp}|${secretMaterial}`);
  const a = expected.length === sig.length ? expected : expected + '\x00';
  const b = expected.length === sig.length ? sig : sig + '\x00';
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0 || expected.length !== sig.length) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Signature du lien invalide', code: 'LINK_INVALID' }, 401);
  }

  // Single use: consume the login rows wherever they live
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?`).bind(record.resource_id).run();
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ?`).bind(record.resource_id).run();
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  await trustDevice(c.env.DB, fingerprint, ip, username, c.req.header('User-Agent') || '');
  await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
  const rep = await getReputation(c.env.DB, ip) as any;
  const token = await makeTokenV2(user, role, secretMaterial, ip, fingerprint);
  return c.json({
    success: true,
    trusted_device: true,
    verified_via: 'email-link',
    token,
    ip,
    username: user,
    role,
    reputationScore: rep.score,
  });
});


/* ─── QR login (PC shows code, phone scans — one-time, 60s) ─── */

function randomQrToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}


/** Versioned desktop flow: reuse existing proof validation, trust and v2 format. */
registerDesktopNativeDiscovery(app);
registerDesktopPilotWebView(app);
registerDesktopV3WebView(app);

// Verify the actual token fingerprint and database role; neither the declared
// fingerprint nor the parsed role alone constitutes an identity.

registerDesktopNativeV3(app, {
  currentIdentity: nativeCurrentIdentity,
  verifyAppUserPassword: async (env, username, password) => {
    const cleanUser = String(username || '').trim().toLowerCase();
    const row: any = cleanUser && cleanUser !== getOwnerUsername(env)
      ? await env.DB.prepare('SELECT id, username, role, password_salt, password_hash FROM app_users WHERE username=? AND active=1').bind(cleanUser).first()
      : null;
    const validRow = row && ['admin', 'secretaire', 'stock', 'user'].includes(row.role) && /^pbkdf2\$100000\$[a-f0-9]{64}$/i.test(String(row.password_hash || ''));
    const salt = validRow ? String(row.password_salt) : 'atlas-native-v3-dummy-salt';
    const actual = await derivePbkdf2Bits(password, salt, 100000);
    const expected = validRow ? String(row.password_hash).split('$')[2].toLowerCase() : '0'.repeat(64);
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return validRow && diff === 0
      ? { username: cleanUser, role: String(row.role), material: String(row.password_hash), userId: Number(row.id) }
      : null;
  },
  verifySessionPassword: async (c, password) => {
    const header = c.req.header('Authorization');
    const fp = c.req.header('X-Device-Fingerprint') || '';
    if (
      await authFailReason(header, c.env, c.env.DB, clientIp(c), fp, {
        dpopHeader: c.req.header('DPoP'),
        method: c.req.method.toUpperCase(),
        requestUrl: c.req.url,
      }) !== 'ok'
    ) return null;
    const sess = sessionUserFromHeader(header);
    const uname = String(sess.username || '').trim().toLowerCase();
    if (!uname) return null;
    if (uname === getOwnerUsername(c.env) && sess.role === 'owner') {
      const expected = getPassword(c.env);
      const ok = !!(expected && passwordsMatch(password, expected));
      return ok ? { username: uname, role: 'owner', userId: null } : null;
    }
    const row: any = await c.env.DB.prepare('SELECT id, role, password_salt, password_hash FROM app_users WHERE username=? AND active=1').bind(uname).first();
    if (!row || row.role !== sess.role || !/^pbkdf2\$100000\$[a-f0-9]{64}$/i.test(String(row.password_hash || ''))) return null;
    const actual = await derivePbkdf2Bits(password, String(row.password_salt), 100000);
    const expected = String(row.password_hash).split('$')[2].toLowerCase();
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0 ? { username: uname, role: String(row.role), userId: Number(row.id) } : null;
  },
  authenticatedSession: async (c) => {
    const header = c.req.header('Authorization');
    const fp = c.req.header('X-Device-Fingerprint') || '';
    if (
      await authFailReason(header, c.env, c.env.DB, clientIp(c), fp, {
        dpopHeader: c.req.header('DPoP'),
        method: c.req.method.toUpperCase(),
        requestUrl: c.req.url,
      }) !== 'ok'
    ) return null;
    const sess = sessionUserFromHeader(header);
    return sess.username ? sess : null;
  },
  audit: async (c, entry) => {
    await writeAudit(c.env.DB, entry);
  },
});

registerDesktopNativeV2(app, {
  currentIdentity: nativeCurrentIdentity,
  pilotPassword: async (env, username, password) => {
    // One explicitly configured non-owner test account; no legacy or weak hashes.
    const configured = String(env.DESKTOP_NATIVE_V2_PILOT_USERNAME || '').trim().toLowerCase();
    const row: any = username === configured && username !== getOwnerUsername(env) ? await env.DB.prepare('SELECT id, username, role, password_salt, password_hash FROM app_users WHERE username=? AND active=1').bind(username).first() : null;
    const validRow = row && ['admin', 'secretaire', 'stock', 'user'].includes(row.role) && /^pbkdf2\$100000\$[a-f0-9]{64}$/i.test(String(row.password_hash || ''));
    const salt = validRow ? String(row.password_salt) : 'atlas-native-staging-dummy-salt';
    const actual = await derivePbkdf2Bits(password, salt, 100000);
    const expected = validRow ? String(row.password_hash).split('$')[2].toLowerCase() : '0'.repeat(64);
    let diff = 0; for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return validRow && diff === 0 ? { username, role: String(row.role), material: String(row.password_hash), userId: Number(row.id) } : null;
  },
  pilotSendOtp: async (env, otp) => {
    if (!env.EMAIL?.send) return false;
    try { await env.EMAIL.send({ to: env.DESKTOP_NATIVE_V2_PILOT_OTP_TO!, from: env.DESKTOP_NATIVE_V2_PILOT_OTP_FROM!, subject: 'Atlas staging — code de connexion', text: `Code de test : ${otp}\nValable pendant cinq minutes au maximum. Ne partagez jamais ce code.` }); return true; } catch { return false; }
  },
  phoneIdentity: async (c, ip, fp) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) return null;
    const parsed = parseToken(header.slice(7));
    if (!parsed || parsed.version !== 2 || !parsed.username || parsed.fingerprint !== fp || !parsed.role) return null;
    if (await authFailReason(header, c.env, c.env.DB, ip, fp) !== 'ok') return null;
    const trusted: any = await c.env.DB.prepare('SELECT username FROM trusted_devices WHERE fingerprint = ?').bind(fp).first();
    if (!trusted?.username || String(trusted.username).toLowerCase() !== parsed.username.toLowerCase()) return null;
    return nativeCurrentIdentity(c.env, parsed.username, parsed.role);
  },
  mint: makeTokenV2,
});

registerDesktopAuthRoutes(app, {
  ip: clientIp,
  authenticate: async c => {
    const fp = c.req.header('X-Device-Fingerprint') || '';
    const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fp);
    return reason === 'ok' ? sessionUserFromHeader(c.req.header('Authorization')) : null;
  },
  material: async (env, username, role) => {
    if (username === getOwnerUsername(env)) {
      return role === 'owner' ? secretMaterialForUsername(env, env.DB, username, role) : null;
    }
    const row = await env.DB.prepare('SELECT password_hash, role FROM app_users WHERE username = ? AND active = 1').bind(username).first() as any;
    return row && row.role === role ? String(row.password_hash) : null;
  },
  mint: makeTokenV2,
  trust: async (env, fp, ip, username, ua) => { await trustDevice(env.DB, fp, ip, username, ua); },
  audit: async (c, identity, event) => {
    if (event === 'exchange') {
      try { await recordLogin(c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '', true, c.req.header('User-Agent') || ''); } catch { /* best effort */ }
    }
    await writeAudit(c.env.DB, {
      ...identity, action: `auth.desktop_${event}`, entity: 'session', detail: 'desktop_v1', ip: clientIp(c),
    });
  },
});

/** Public: PC login page QR — phone (logged-in) scans to authenticate this browser */
app.post('/api/auth/qr/pc-session', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const token = randomQrToken();
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO qr_login_sessions (token, username, role, created_by, status, expires_at) VALUES (?, '', '', 'pc-login', 'pending', ?)`
  ).bind(token, expiresAt).run();
  const origin = new URL(c.req.url).origin;
  const qrUrl = `${origin}/login/qr?t=${token}&mode=pc`;
  let qrSvg = '';
  try {
    qrSvg = qrToSvg(qrUrl, 200, 2);
  } catch { /* */ }
  try {
    await qrDoPut(c.env, token, {
      status: 'pending',
      username: '',
      role: '',
      created_by: 'pc-login',
      expires_at: expiresAt,
      _schedule_alarm: true,
    });
  } catch { /* */ }
  return c.json({
    success: true,
    data: { token, expires_at: expiresAt, expires_in: 60, qr_url: qrUrl, qr_svg: qrSvg },
  });
});


/** Deterministic default avatar (SVG data URI) when user has no photo */

/** QR session DO (idFromName qr:token) — hot path off D1 for free-tier CPU. */
function qrSessionStub(env: Env, token: string) {
  if (!env.MOBILE_HUB || !token) return null;
  try {
    const id = env.MOBILE_HUB.idFromName('qr:' + String(token).slice(0, 64));
    return env.MOBILE_HUB.get(id);
  } catch {
    return null;
  }
}

async function qrDoGet(env: Env, token: string): Promise<any | null> {
  const stub = qrSessionStub(env, token);
  if (!stub) return null;
  try {
    const res = await stub.fetch('https://do/qr', { method: 'GET' });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null) as any;
    return j?.data || null;
  } catch {
    return null;
  }
}

async function qrDoPut(env: Env, token: string, body: Record<string, unknown>): Promise<any | null> {
  const stub = qrSessionStub(env, token);
  if (!stub) return null;
  try {
    const res = await stub.fetch('https://do/qr', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null) as any;
    return j?.data || null;
  } catch {
    return null;
  }
}


/** Phone (already logged in): bind account to PC QR session and approve */
app.post('/api/auth/qr/session/:token/phone-bind', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Connectez-vous sur le téléphone d’abord', code: 'UNAUTHORIZED' }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const token = String(c.req.param('token') || '').slice(0, 64);
  const body = await c.req.json().catch(() => ({}));
  const phoneFp = String(body.fingerprint || fingerprint).slice(0, 128);
  const ua = String(body.user_agent || c.req.header('User-Agent') || '').slice(0, 240);
  const ip = clientIp(c);

  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'QR invalide', code: 'NOT_FOUND' }, 404);
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'expired' WHERE token = ?`).bind(token).run();
    return c.json({ success: false, error: 'QR expiré', code: 'EXPIRED' }, 410);
  }
  if (row.status === 'consumed' || row.status === 'denied') {
    return c.json({ success: false, error: 'QR déjà utilisé', code: 'USED' }, 409);
  }

  const confirm = body.confirm === true || body.confirm === 'true' || body.approve === true;
  const nextStatus = confirm ? 'approved' : 'claimed';
  await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = ?, username = ?, role = ?, claim_fingerprint = ?, claim_ua = ?, claim_ip = ? WHERE token = ?`
  ).bind(nextStatus, session.username, session.role, phoneFp, ua, ip, token).run();

  const profile = await resolveUserProfileAvatar(c.env, session.username);
  try {
    await qrDoPut(c.env, token, {
      status: nextStatus,
      username: session.username,
      role: session.role,
      claim_fingerprint: phoneFp,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
    });
  } catch { /* */ }

  return c.json({
    success: true,
    data: {
      status: nextStatus,
      username: session.username,
      role: session.role,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      message: confirm
        ? 'PC autorisé — finalisez sur l’ordinateur.'
        : 'Confirmez sur le téléphone pour autoriser cet ordinateur.',
      needs_confirm: !confirm,
    },
  });
});

/** PC: create a 60s one-time QR session for self or (owner/admin) another user */
app.post('/api/auth/qr/session', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const body = await c.req.json().catch(() => ({}));
  let targetUser = String(body.username || session.username || '').trim().toLowerCase();
  let targetRole = session.role || 'user';

  if (body.username && String(body.username).toLowerCase() !== session.username) {
    if (session.role !== 'owner' && session.role !== 'admin') {
      return c.json({ success: false, error: 'Seuls owner/admin peuvent générer un QR pour un autre compte', code: 'FORBIDDEN' }, 403);
    }
    const ownerUser = getOwnerUsername(c.env);
    if (targetUser === ownerUser) {
      targetRole = 'owner';
    } else {
      const row = await c.env.DB.prepare(`SELECT username, role FROM app_users WHERE username = ? AND active = 1`).bind(targetUser).first() as any;
      if (!row) return c.json({ success: false, error: 'Utilisateur introuvable', code: 'NOT_FOUND' }, 404);
      targetRole = String(row.role || 'user');
    }
  }

  // Expire previous pending sessions for this creator
  await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = 'expired' WHERE created_by = ? AND status IN ('pending','claimed')`
  ).bind(session.username).run();

  const token = randomQrToken();
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO qr_login_sessions (token, username, role, created_by, status, expires_at) VALUES (?, ?, ?, ?, 'pending', ?)`
  ).bind(token, targetUser, targetRole, session.username, expiresAt).run();

  const origin = new URL(c.req.url).origin;
  const qrUrl = `${origin}/login/qr?t=${token}`;
  let qrSvg = '';
  try {
    qrSvg = qrToSvg(qrUrl, 220, 2);
  } catch {
    qrSvg = '';
  }

  try {
    await qrDoPut(c.env, token, {
      status: 'pending',
      username: targetUser,
      role: targetRole,
      created_by: session.username,
      expires_at: expiresAt,
      _schedule_alarm: true,
    });
  } catch { /* */ }
  return c.json({
    success: true,
    data: {
      token,
      expires_at: expiresAt,
      expires_in: 60,
      qr_url: qrUrl,
      qr_svg: qrSvg,
      username: targetUser,
      role: targetRole,
    },
  });
});

/** Public: status — Durable Object first (fast), D1 fallback */
app.get('/api/auth/qr/session/:token', async (c) => {
  const token = String(c.req.param('token') || '').slice(0, 64);
  if (!token) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);

  const fromDoRaw = await qrDoGet(c.env, token);
  // v0.7.7 — self-heal : une copie DO bloquée à « pending » ne doit plus masquer
  // un claim écrit en D1 (sessions créées avant le write-through).
  const fromDo =
    fromDoRaw && String(fromDoRaw.status || 'pending') === 'pending'
      ? await (async () => {
          try {
            const d1 = await c.env.DB.prepare(
              `SELECT status, username, role FROM qr_login_sessions WHERE token = ?`,
            ).bind(token).first() as any;
            if (d1 && String(d1.status || 'pending') !== 'pending') {
              await qrDoPut(c.env, token, { status: String(d1.status), username: d1.username, role: d1.role });
              return { ...fromDoRaw, status: String(d1.status), username: d1.username || fromDoRaw.username, role: d1.role || fromDoRaw.role };
            }
          } catch { /* */ }
          return fromDoRaw;
        })()
      : fromDoRaw;
  if (fromDo) {
    const uname = String(fromDo.username || '').trim();
    let displayName = String(fromDo.display_name || uname);
    let avatarUrl = String(fromDo.avatar_url || '');
    if (uname && (!avatarUrl || avatarUrl.startsWith('data:image/svg'))) {
      try {
        const profile = await resolveUserProfileAvatar(c.env, uname);
        if (profile.display_name) displayName = profile.display_name;
        if (profile.avatar_url) avatarUrl = profile.avatar_url;
      } catch { /* */ }
    }
    return c.json({
      success: true,
      data: {
        status: fromDo.status || 'pending',
        username: uname,
        display_name: displayName,
        avatar_url: avatarUrl,
        role: fromDo.role || '',
        created_by: fromDo.created_by || '',
        expires_at: fromDo.expires_at,
        claim_fingerprint: fromDo.claim_fingerprint || '',
        has_device: !!fromDo.has_device,
      },
    });
  }

  let row: any = null;
  try {
    row = await c.env.DB.prepare(
      `SELECT status, username, role, created_by, expires_at, claim_fingerprint FROM qr_login_sessions WHERE token = ?`
    ).bind(token).first();
  } catch {
    return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  }
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  let status = String(row.status || 'pending');
  if (status !== 'consumed' && status !== 'denied' && row.expires_at && new Date(row.expires_at) < new Date()) {
    status = 'expired';
  }
  const uname = String(row.username || '').trim();
  const profile = uname ? await resolveUserProfileAvatar(c.env, uname) : { display_name: '', avatar_url: '' };
  return c.json({
    success: true,
    data: {
      status,
      username: uname,
      display_name: profile.display_name || uname,
      avatar_url: profile.avatar_url,
      role: row.role || '',
      created_by: row.created_by || '',
      expires_at: row.expires_at,
      claim_fingerprint: row.claim_fingerprint ? String(row.claim_fingerprint).slice(0, 12) + '…' : '',
      has_device: !!row.claim_fingerprint,
    },
  });
});

/** Phone: claim the session after scanning */
app.post('/api/auth/qr/session/:token/claim', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const token = String(c.req.param('token') || '').slice(0, 64);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ua = String(body.user_agent || c.req.header('User-Agent') || '').slice(0, 240);
  const ip = clientIp(c);

  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'QR invalide', code: 'NOT_FOUND' }, 404);
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'expired' WHERE token = ?`).bind(token).run();
    try { await qrDoPut(c.env, token, { status: 'expired' }); } catch { /* */ }
    return c.json({ success: false, error: 'QR expiré — regénérez-le sur l’ordinateur', code: 'EXPIRED' }, 410);
  }
  if (row.status === 'consumed' || row.status === 'denied' || row.status === 'expired') {
    return c.json({ success: false, error: 'QR déjà utilisé ou annulé', code: 'USED' }, 409);
  }
  if (row.status === 'claimed' && row.claim_fingerprint && row.claim_fingerprint !== fingerprint) {
    return c.json({ success: false, error: 'Ce QR est déjà lié à un autre appareil', code: 'OTHER_DEVICE' }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = 'claimed', claim_fingerprint = ?, claim_ua = ?, claim_ip = ? WHERE token = ?`
  ).bind(fingerprint, ua, ip, token).run();
  // v0.7.7 — write-through : le poll PC lit le Durable Object EN PREMIER ;
  // sans ce put la copie DO restait « pending » et le PC ne voyait jamais le scan.
  try {
    await qrDoPut(c.env, token, {
      status: 'claimed',
      username: row.username,
      role: row.role,
      claim_fingerprint: fingerprint,
    });
  } catch { /* */ }

  return c.json({
    success: true,
    data: {
      status: 'claimed',
      username: row.username,
      role: row.role,
      message: 'En attente de validation sur l’ordinateur…',
    },
  });
});

/** PC: approve claimed device → phone can fetch token once */
app.post('/api/auth/qr/session/:token/approve', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const token = String(c.req.param('token') || '').slice(0, 64);
  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  if (row.created_by !== session.username && session.role !== 'owner' && session.role !== 'admin') {
    return c.json({ success: false, error: 'Non autorisé', code: 'FORBIDDEN' }, 403);
  }
  if (row.status !== 'claimed') {
    return c.json({ success: false, error: 'En attente du scan téléphone', code: 'NOT_CLAIMED' }, 400);
  }
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'expired' WHERE token = ?`).bind(token).run();
    return c.json({ success: false, error: 'Expiré', code: 'EXPIRED' }, 410);
  }
  await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'approved' WHERE token = ?`).bind(token).run();
  try { await qrDoPut(c.env, token, { status: 'approved', username: row.username, role: row.role }); } catch { /* */ }
  await writeAudit(c.env.DB, {
    username: session.username,
    role: session.role,
    action: 'auth.qr_approve',
    entity: 'qr_login',
    detail: `user=${row.username} fp=${String(row.claim_fingerprint || '').slice(0, 16)}`,
    ip: clientIp(c),
  });
  return c.json({ success: true, data: { status: 'approved' } });
});

/** PC: deny */
app.post('/api/auth/qr/session/:token/deny', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const token = String(c.req.param('token') || '').slice(0, 64);
  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  if (row.created_by !== session.username && session.role !== 'owner' && session.role !== 'admin') {
    return c.json({ success: false, error: 'Non autorisé', code: 'FORBIDDEN' }, 403);
  }
  await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'denied' WHERE token = ?`).bind(token).run();
  try { await qrDoPut(c.env, token, { status: 'denied' }); } catch { /* */ }
  return c.json({ success: true, data: { status: 'denied' } });
});

/** Phone: after approve, fetch JWT once (one-time) */
app.post('/api/auth/qr/session/:token/complete', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const token = String(c.req.param('token') || '').slice(0, 64);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  if (row.status === 'consumed') {
    return c.json({ success: false, error: 'Déjà utilisé', code: 'USED' }, 409);
  }
  if (row.status === 'denied' || row.status === 'expired') {
    return c.json({ success: false, error: 'Refusé ou expiré', code: row.status.toUpperCase() }, 410);
  }
  if (row.status !== 'approved') {
    return c.json({ success: false, error: 'Pas encore approuvé', code: 'WAIT', status: row.status }, 202);
  }
  // Desktop v3 QR approvals are redeemable ONLY by the requesting device key (DPoP + PKCE) via /api/auth/desktop/v3/qr/exchange.
  if (row.created_by === 'desktop-v3') {
    return c.json({ success: false, error: 'Utilisez l’application de bureau', code: 'DESKTOP_EXCHANGE_REQUIRED' }, 409);
  }
  // Settings flow (phone logs in): fingerprint must match claim.
  // PC-login flow (phone authorizes PC): PC fingerprint differs from phone — allow when created_by = pc-login.
  if (row.created_by !== 'pc-login' && row.claim_fingerprint && row.claim_fingerprint !== fingerprint) {
    return c.json({ success: false, error: 'Appareil différent du scan', code: 'DEVICE_MISMATCH' }, 403);
  }
  if (!row.username) {
    return c.json({ success: false, error: 'Compte non lié', code: 'NO_USER' }, 400);
  }

  const secretMaterial = await secretMaterialForUsername(c.env, c.env.DB, row.username, row.role);
  if (!secretMaterial) {
    return c.json({ success: false, error: 'Compte indisponible', code: 'NO_SECRET' }, 500);
  }

  // Mark consumed BEFORE issuing token (one-time)
  const upd = await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = 'consumed', consumed_at = datetime('now') WHERE token = ? AND status = 'approved'`
  ).bind(token).run();
  if (!(upd as any)?.meta?.changes && !(upd as any)?.success) {
    // D1 returns success differently — re-check
    const again = await c.env.DB.prepare(`SELECT status FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
    if (again?.status === 'consumed') {
      return c.json({ success: false, error: 'Déjà utilisé', code: 'USED' }, 409);
    }
  }
  try { await qrDoPut(c.env, token, { status: 'consumed', username: row.username, role: row.role }); } catch { /* */ }

  const authToken = await makeTokenV2(row.username, row.role, secretMaterial, ip, fingerprint);
  try {
    await trustDevice(c.env.DB, fingerprint, ip, String(row.username || ''), c.req.header('User-Agent') || '');
  } catch { /* */ }
  await recordLogin(c.env.DB, ip, fingerprint, true, ua);
  await writeAudit(c.env.DB, {
    username: row.username,
    role: row.role,
    action: 'auth.qr_login',
    entity: 'session',
    detail: 'qr_one_time',
    ip,
  });

  let displayName = String(row.username || '');
  let avatarUrl = '';
  try {
    const profile = await resolveUserProfileAvatar(c.env, String(row.username || ''));
    displayName = profile.display_name || displayName;
    avatarUrl = profile.avatar_url || '';
  } catch { /* */ }
  try {
    await qrDoPut(c.env, token, {
      status: 'consumed',
      username: row.username,
      role: row.role,
      display_name: displayName,
      avatar_url: avatarUrl,
    });
  } catch { /* */ }

  return c.json({
    success: true,
    data: {
      token: authToken,
      username: row.username,
      role: row.role,
      display_name: displayName,
      avatar_url: avatarUrl,
      trusted_device: true,
    },
  });
});

/* ─── WebAuthn: platform biometrics + hardware security keys (v259 hardened) ───
 * ALL cryptographic verification lives in worker/lib/webauthn.ts (W3C WebAuthn
 * L2 procedures). These routes only wire session/authz/persistence: every
 * success path requires verifyRegistration()/verifyAuthentication() to return
 * ok — client-submitted fields are never treated as proof of anything.
 * Feature-gated: WEBAUTHN_ENABLED !== 'true' → 503 WEBAUTHN_DISABLED, and
 * clients must consult GET /api/auth/webauthn/status before offering passkeys.
 * Android Credential Manager: allowed only via the documented assetlinks
 * association (WEBAUTHN_ANDROID_PACKAGE + WEBAUTHN_ANDROID_CERT_HASH). */

function waPolicy(env: any): WebAuthnPolicy {
  return policyFromEnv(env as Record<string, string | undefined>);
}

function waDisabledResponse() {
  return { success: false, error: 'Passkeys désactivées sur ce serveur', code: 'WEBAUTHN_DISABLED' };
}

/** Build a readable passkey label from client + User-Agent (Windows / iPhone / Android…). */
function buildPasskeyLabel(body: any, ua: string, deviceType: string): string {
  const fromClient = String(body.device_label || body.label || '').trim();
  if (fromClient) return fromClient.slice(0, 120);
  const u = ua || '';
  if (/iPhone/i.test(u)) {
    const m = u.match(/OS (\d+)[._](\d+)/);
    return m ? `iPhone · iOS ${m[1]}.${m[2]}` : 'iPhone · iOS';
  }
  if (/iPad/i.test(u)) {
    const m = u.match(/OS (\d+)[._](\d+)/);
    return m ? `iPad · iPadOS ${m[1]}.${m[2]}` : 'iPad · iPadOS';
  }
  if (/Android/i.test(u)) {
    const v = u.match(/Android (\d+(?:\.\d+)?)/);
    const model = u.match(/;\s*([^;)]+)\s*Build\//);
    const name = model ? model[1].trim() : 'Android';
    return v ? `${name} · Android ${v[1]}` : `${name} · Android`;
  }
  if (/Windows NT 10/i.test(u)) return 'PC Windows · Windows 10/11 · Windows Hello';
  if (/Windows/i.test(u)) return 'PC Windows · Windows Hello';
  if (/Mac OS X/i.test(u)) {
    const m = u.match(/Mac OS X (\d+[._]\d+)/);
    const ver = m ? m[1].replace(/_/g, '.') : '';
    return ver ? `Mac · macOS ${ver} · Touch ID` : 'Mac · macOS · Touch ID';
  }
  if (deviceType === 'cross-platform') return 'Clé de sécurité (USB / NFC)';
  return deviceType === 'platform' ? 'Biométrie (appareil)' : 'Clé de sécurité';
}

function enrichCredentialRow(r: any): any {
  if (!r) return r;
  let label = String(r.label || '').trim();
  if (!label || label === 'Biométrie' || label === 'Clé de sécurité') {
    label = r.device_type === 'cross-platform'
      ? 'Clé de sécurité (ancienne)'
      : 'Biométrie (ancienne — sans détail appareil)';
  }
  return {
    ...r,
    label,
    display_label: label,
    platform: r.device_type === 'cross-platform' ? 'security_key' : 'platform',
  };
}

/** Start WebAuthn registration — returns PublicKeyCredentialCreationOptions fields */
app.post('/api/auth/webauthn/register/options', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  await ensureSecurityTables(c.env.DB);

  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide — connectez-vous d\'abord', code: 'UNAUTHORIZED' }, 401);
  }
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (!username) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const origin = expectedOrigin(policy);

  // Challenge bound to the SESSION account (not to any client-supplied value).
  const challenge = await waCreateChallenge(c.env.DB, { purpose: 'register', username, rpId: policy.rpId, origin });
  // v0.7 — exclude ONLY credentials with stored verification material: a
  // legacy row without public_key_jwk must not block re-registration (same
  // filter as login/options; nothing is deleted, no check weakened).
  const exclude = await credentialDescriptors(c.env.DB, username);
  const userHandle = await userHandleFor(username);
  const deviceType = body.device_type === 'cross-platform' ? 'cross-platform' : 'platform';

  return c.json({
    success: true,
    options: {
      challenge,
      rp: { name: policy.rpName, id: policy.rpId },
      user: { id: userHandle, name: username, displayName: username },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'preferred',
        requireResidentKey: false,
        userVerification: policy.requireUV ? 'required' : 'preferred',
      },
      timeout: 60000,
      attestation: policy.attestation,
      excludeCredentials: exclude,
    },
    device_type: deviceType,
    rp_id: policy.rpId,
  });
});

/** Finish WebAuthn registration — full attestation/authData/COSE verification */
app.post('/api/auth/webauthn/register/verify', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  await ensureSecurityTables(c.env.DB);

  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (!username) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);

  // Accept flat fields OR nested Credential Manager registration JSON.
  const cred = (body.credential && typeof body.credential === 'object') ? body.credential : {};
  const response = (cred.response && typeof cred.response === 'object') ? cred.response : {};
  const credentialIdHint = String(body.credential_id || cred.id || '').trim();
  const clientDataJSON = String(response.clientDataJSON || body.clientDataJSON || '').trim();
  const attestationObject = String(response.attestationObject || body.attestation_object || '').trim();
  const transportsRaw = body.transports || cred.transports || response.transports;
  const transports = Array.isArray(transportsRaw) ? transportsRaw.join(',') : String(transportsRaw || '');
  const deviceType = body.device_type === 'cross-platform' ? 'cross-platform' : 'platform';
  if (!clientDataJSON || !attestationObject) {
    return c.json({ success: false, error: 'Réponse passkey incomplète', code: 'BAD_CREDENTIAL' }, 400);
  }

  let challenge = '';
  try {
    challenge = parseClientData(clientDataJSON).json.challenge;
  } catch {
    return c.json({ success: false, error: 'clientDataJSON invalide', code: 'WEBAUTHN_MALFORMED_CLIENTDATA' }, 400);
  }
  // Atomic single-use, bound to this account + purpose + RP + origin.
  const consumed = await waConsumeChallenge(c.env.DB, {
    challenge, purpose: 'register', rpId: policy.rpId, origin: expectedOrigin(policy), username,
  });
  if (!consumed) {
    return c.json({ success: false, error: 'Challenge invalide ou expiré. Réessayez.', code: 'BAD_CHALLENGE' }, 400);
  }

  let verified;
  try {
    verified = await verifyRegistration({
      clientDataJSON,
      attestationObject,
      expectedChallenge: challenge,
      policy,
    });
  } catch (e: any) {
    return c.json({ success: false, error: 'Vérification passkey impossible', code: String(e?.code || 'WEBAUTHN_VERIFY_FAILED') }, 400);
  }
  if (credentialIdHint && credentialIdHint !== verified.credentialId) {
    return c.json({ success: false, error: 'Identifiant de credential incohérent', code: 'WEBAUTHN_BAD_CREDENTIAL_ID' }, 400);
  }

  const ua = c.req.header('User-Agent') || '';
  const label = buildPasskeyLabel(body, ua, deviceType).slice(0, 120);
  let deviceInfo = '';
  try {
    deviceInfo = typeof body.device_info === 'string'
      ? body.device_info.slice(0, 800)
      : JSON.stringify(body.device_info || { ua: ua.slice(0, 200) }).slice(0, 800);
  } catch {
    deviceInfo = ua.slice(0, 200);
  }
  const userHandle = await userHandleFor(username);
  try {
    await c.env.DB.prepare(
      `INSERT INTO webauthn_credentials (id, fingerprint, device_type, transports, label, username, role, device_info,
        public_key_jwk, counter, backup_eligible, backup_state, rp_id, origin, cred_user_handle, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(
      verified.credentialId, fingerprint, deviceType, transports, label, username,
      normalizeRole(session.role || 'user'), deviceInfo,
      JSON.stringify(verified.publicKeyJwk), verified.counter,
      verified.backupEligible ? 1 : 0, verified.backupState ? 1 : 0,
      policy.rpId, expectedOrigin(policy), userHandle,
    ).run();
  } catch {
    return c.json({ success: false, error: 'Cette passkey est déjà enregistrée', code: 'DUPLICATE_CREDENTIAL' }, 409);
  }

  await trustDevice(c.env.DB, fingerprint, clientIp(c), username, c.req.header('User-Agent') || '');
  return c.json({
    success: true,
    credential_id: verified.credentialId.slice(0, 16) + '…',
    username,
    role: normalizeRole(session.role || 'user'),
    label,
    message: `Passkey enregistrée : ${label}. Sur l’écran de connexion, utilisez « Connexion passkey ».`,
  });
});

/** Start WebAuthn authentication (login) */
app.post('/api/auth/webauthn/login/options', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const ip = clientIp(c);
  await ensureSecurityTables(c.env.DB);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);

  const usernameFilter = String(body.username || '').trim().toLowerCase();
  const challenge = await waCreateChallenge(c.env.DB, {
    purpose: 'login', username: usernameFilter, rpId: policy.rpId, origin: expectedOrigin(policy),
  });
  // Verifiable credentials only (rows with a stored public key). Legacy
  // biometric ids without keys can never pass verification — not offered.
  let allow: any[] = [];
  if (usernameFilter) {
    allow = await credentialDescriptors(c.env.DB, usernameFilter);
  }
  return c.json({
    success: true,
    options: {
      challenge,
      timeout: 60000,
      userVerification: policy.requireUV ? 'required' : 'preferred',
      allowCredentials: allow,
      rpId: policy.rpId,
    },
  });
});

/** Finish WebAuthn authentication — session issued ONLY after full verification */
app.post('/api/auth/webauthn/login/verify', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';
  await ensureSecurityTables(c.env.DB);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);

  const credNested = (body.credential && typeof body.credential === 'object') ? body.credential : {};
  const respNested = (credNested.response && typeof credNested.response === 'object') ? credNested.response : {};
  const credentialId = String(body.credential_id || credNested.id || '').trim();
  const clientDataJSON = String(respNested.clientDataJSON || body.clientDataJSON || '').trim();
  const authenticatorData = String(respNested.authenticatorData || body.authenticatorData || '').trim();
  const signature = String(respNested.signature || body.signature || '').trim();
  const userHandle = String(respNested.userHandle || body.userHandle || '').trim();

  // One generic failure shape for EVERY verification error: no credential
  // oracle, no account enumeration, no difference between "unknown key" and
  // "bad signature" (both recorded as failed logins for reputation).
  const fail = async () => {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: 'Vérification passkey impossible', code: 'WEBAUTHN_VERIFY_FAILED' }, 401);
  };

  if (!credentialId || !clientDataJSON || !authenticatorData || !signature) return fail();
  let challenge = '';
  try {
    challenge = parseClientData(clientDataJSON).json.challenge;
  } catch {
    return fail();
  }
  const consumed = await waConsumeChallenge(c.env.DB, {
    challenge, purpose: 'login', rpId: policy.rpId, origin: expectedOrigin(policy),
  });
  if (!consumed) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: 'Challenge invalide ou expiré', code: 'BAD_CHALLENGE' }, 401);
  }

  const cred = await c.env.DB.prepare(`SELECT * FROM webauthn_credentials WHERE id = ?`).bind(credentialId).first() as any;
  if (!cred || !String(cred.public_key_jwk || '')) return fail();
  // Challenge requested for a specific account cannot unlock another account.
  if (consumed.username && String(cred.username || '').toLowerCase() !== consumed.username) return fail();

  let jwk: any;
  try { jwk = JSON.parse(String(cred.public_key_jwk)); } catch { return fail(); }
  let verified;
  try {
    verified = await verifyAuthentication({
      clientDataJSON,
      authenticatorData,
      signature,
      userHandle: userHandle || undefined,
      expectedChallenge: challenge,
      policy,
      stored: {
        publicKeyJwk: jwk,
        counter: Number(cred.counter || 0),
        backupEligible: Number(cred.backup_eligible || 0) === 1,
        userHandle: String(cred.cred_user_handle || ''),
      },
    });
  } catch {
    return fail();
  }

  await c.env.DB.prepare(
    `UPDATE webauthn_credentials SET counter = ?, backup_state = ?, last_used = datetime('now') WHERE id = ?`,
  ).bind(verified.counter, verified.backupState ? 1 : 0, credentialId).run().catch(() => {});
  await trustDevice(c.env.DB, fingerprint, ip, String(cred.username || ''), c.req.header('User-Agent') || '');
  await recordLogin(c.env.DB, ip, fingerprint, true, ua);
  const rep = await getReputation(c.env.DB, ip) as any;

  // Account comes ONLY from the verified credential row — never from the body.
  const ownerUser = getOwnerUsername(c.env);
  let username = String(cred.username || '').toLowerCase();
  let role = normalizeRole(cred.role || 'user');
  let secretMaterial: string;
  let displayName = username;
  if (!username) return fail();
  if (username === ownerUser || role === 'owner') {
    const expected = getPassword(c.env);
    if (!expected) {
      return c.json({ success: false, error: 'Mot de passe administrateur non configuré', code: 'NO_PASSWORD_CONFIGURED' }, 503);
    }
    username = ownerUser;
    role = 'owner';
    secretMaterial = await sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
    displayName = 'Administrateur';
  } else {
    const row = await c.env.DB.prepare(
      `SELECT * FROM app_users WHERE username = ? AND active = 1`,
    ).bind(username).first() as any;
    if (!row) return fail();
    role = normalizeRole(row.role);
    secretMaterial = row.password_hash;
    displayName = row.display_name || username;
  }

  const token = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
  return c.json({
    success: true,
    needs_otp: false,
    trusted_device: true,
    biometric: true,
    token,
    ip,
    username,
    role,
    displayName,
    reputationScore: rep.score,
    message: 'Connexion passkey réussie.',
  });
});

/** Capability probe — clients offer passkeys ONLY when this says enabled. */
app.get('/api/auth/webauthn/status', async (c) => {
  const policy = waPolicy(c.env);
  return c.json({
    success: true,
    data: {
      enabled: policy.enabled,
      rp: { id: policy.rpId, name: policy.rpName },
      origins: policy.origins,
      registration: policy.enabled,
      login: policy.enabled,
      user_verification: policy.requireUV ? 'required' : 'preferred',
      attestation: policy.attestation,
      algorithms: ['ES256'],
      android: {
        enabled: policy.enabled && !!policy.androidPackage && !!androidOrigin(policy),
        package: policy.androidPackage || null,
        // Native origins accepted for the configured signing cert(s) — device
        // teams verify what their build emits against these exact values.
        // Credential Manager emits the -sha256 form; the legacy FIDO2/GMS form
        // (base64 of SHA-1) is also accepted when WEBAUTHN_ANDROID_CERT_SHA1 is set.
        origin: androidOrigin(policy),
        // v0.7 — all accepted native origins (one per signing fingerprint).
        origins_android: androidOrigins(policy),
        origin_legacy: androidLegacyOrigin(policy),
        assetlinks: '/.well-known/assetlinks.json',
      },
    },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

/** Digital Asset Links for Android Credential Manager (configured builds only). */
/**
 * Apple webcredentials association (macOS/iOS passkeys for the native apps).
 * Served ONLY when APPLE_WEBCREDENTIALS_APP_IDS lists real "TEAMID.bundle.id"
 * entries — never guessed; 404 otherwise.
 */
app.get('/.well-known/apple-app-site-association', (c) => {
  const apps = String((c.env as any).APPLE_WEBCREDENTIALS_APP_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Z0-9]{10}\.[A-Za-z0-9][A-Za-z0-9.-]{0,200}$/.test(s));
  if (!apps.length) return c.json({ success: false, code: 'NOT_CONFIGURED' }, 404);
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({ webcredentials: { apps } });
});

app.get('/.well-known/assetlinks.json', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.androidPackage || !policy.androidCertHashes.length) {
    return c.json({ error: 'not configured' }, 404);
  }
  // v0.7 — Digital Asset Links accepts several signing fingerprints: list
  // EVERY configured key (Play App Signing + release/CDN keystore) so both
  // Play installs and GitHub-Release installs associate. Debug builds get
  // their package variant too (same keys), as the historical static file did.
  const fps = policy.androidCertHashes;
  const relation = [
    'delegate_permission/common.handle_all_urls',
    'delegate_permission/common.get_login_creds',
  ];
  const entry = (pkg: string) => ({
    relation,
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps },
  });
  return c.json(
    [entry(policy.androidPackage), entry(`${policy.androidPackage}.debug`)],
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
});

/** List WebAuthn credentials — device + legacy + all for owner/admin */
registerReportsAndUpdatesRoutes(app, {
  authFailReason,
  sessionUserFromHeader,
  getOwnerUsername,
  clientIp,
  isRateLimited,
});
app.get('/api/auth/webauthn/credentials', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  const sessionUser = String(session.username || '').toLowerCase();
  // only owner/admin can request all=1; everyone else only sees THEIR passkeys
  const wantAll = isAdmin && c.req.query('all') === '1';

  let results: any[] = [];
  if (wantAll) {
    const q = await c.env.DB.prepare(
      `SELECT id, fingerprint, device_type, transports, label, username, role, device_info, created_at, last_used
       FROM webauthn_credentials ORDER BY datetime(created_at) DESC LIMIT 100`
    ).all();
    results = (q.results || []) as any[];
  } else if (sessionUser) {
    // Per-user isolation (same phone can have haytam + owner keys — only show current user)
    const q = await c.env.DB.prepare(
      `SELECT id, fingerprint, device_type, transports, label, username, role, device_info, created_at, last_used
       FROM webauthn_credentials
       WHERE lower(username) = ?
       ORDER BY datetime(created_at) DESC LIMIT 50`
    ).bind(sessionUser).all();
    results = (q.results || []) as any[];
  } else {
    const q = await c.env.DB.prepare(
      `SELECT id, fingerprint, device_type, transports, label, username, role, device_info, created_at, last_used
       FROM webauthn_credentials WHERE fingerprint = ? ORDER BY datetime(created_at) DESC LIMIT 50`
    ).bind(fingerprint).all();
    results = (q.results || []) as any[];
  }

  // Legacy only for current device + current user context (avoid leaking other accounts)
  if (!wantAll) {
    const legacyQ = await c.env.DB.prepare(
      `SELECT fingerprint, biometric_credential_id FROM trusted_devices
       WHERE fingerprint = ? AND biometric_credential_id IS NOT NULL AND biometric_credential_id != ''`
    ).bind(fingerprint).all();
    const seen = new Set(results.map((r: any) => r.id));
    for (const row of (legacyQ.results || []) as any[]) {
      const id = String(row.biometric_credential_id || '');
      if (!id || seen.has(id)) continue;
      // only include if no username-scoped rows (legacy predates username column)
      if (results.length > 0) continue;
      seen.add(id);
      results.push({
        id,
        fingerprint: row.fingerprint,
        device_type: 'platform',
        transports: 'internal',
        label: 'Biométrie (ancienne)',
        username: sessionUser || '',
        created_at: null,
        last_used: null,
        legacy: true,
      });
    }
  }

  const enriched = (results || []).map(enrichCredentialRow);
  return c.json({
    success: true,
    data: enriched,
    meta: {
      fingerprint,
      scope: wantAll ? 'all' : 'user',
      username: sessionUser,
      count: results.length,
    },
  });
});

/** Rename a passkey label */
app.patch('/api/auth/webauthn/credentials/:id', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const id = decodeURIComponent(c.req.param('id') || '');
  const body = await c.req.json().catch(() => ({}));
  const label = String(body.label || '').trim().slice(0, 80);
  if (!id || !label) return c.json({ success: false, error: 'id et label obligatoires' }, 400);
  const row = await c.env.DB.prepare(`SELECT * FROM webauthn_credentials WHERE id = ?`).bind(id).first() as any;
  if (!row) return c.json({ success: false, error: 'Clé introuvable' }, 404);
  // Device-scoped: only own fingerprint unless owner managing all
  if (row.fingerprint !== fingerprint) {
    // allow owner session only
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    if (sess.role !== 'owner' && sess.role !== 'admin') {
      return c.json({ success: false, error: 'Non autorisé' }, 403);
    }
  }
  await c.env.DB.prepare(`UPDATE webauthn_credentials SET label = ? WHERE id = ?`).bind(label, id).run();
  return c.json({ success: true, message: 'Libellé mis à jour', data: { id, label } });
});

/** Delete passkey from server (client should also clear local id + signal authenticator) */

function webauthnIdVariants(raw: string): string[] {
  const id = decodeURIComponent(String(raw || '').trim());
  if (!id) return [];
  const set = new Set<string>([id]);
  // base64url <-> base64
  set.add(id.replace(/-/g, '+').replace(/_/g, '/'));
  set.add(id.replace(/\+/g, '-').replace(/\//g, '_'));
  // with/without padding
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot on purpose: variants are ADDED to the set during the loop
  for (const v of [...set]) {
    const pad = v.length % 4 === 0 ? v : v + '='.repeat((4 - (v.length % 4)) % 4);
    set.add(pad);
    set.add(v.replace(/=+$/, ''));
  }
  return [...set].filter(Boolean);
}

async function deleteWebauthnCredentialRow(db: D1Database, idRaw: string, fingerprint: string, role: string) {
  const variants = webauthnIdVariants(idRaw);
  if (!variants.length) return { ok: false as const, code: 400 as const, error: 'id obligatoire' };

  let row: any = null;
  let matchedId = '';
  for (const id of variants) {
    row = await db.prepare(`SELECT * FROM webauthn_credentials WHERE id = ?`).bind(id).first();
    if (row) { matchedId = String(row.id); break; }
  }
  // fallback: suffix match for truncated path params
  if (!row && variants[0] && variants[0].length >= 16) {
    const q = await db.prepare(`SELECT * FROM webauthn_credentials WHERE id LIKE ? LIMIT 5`).bind('%' + variants[0].slice(-24)).all();
    const hits = (q.results || []) as any[];
    if (hits.length === 1) {
      row = hits[0];
      matchedId = String(row.id);
    }
  }

  // Legacy passkeys only live on trusted_devices.biometric_credential_id (list merges them in)
  let legacyCleared = 0;
  for (const id of variants) {
    try {
      // permission: non-admin can only clear own fingerprint's legacy row
      if (role === 'owner' || role === 'admin') {
        const r = await db.prepare(
          `UPDATE trusted_devices SET biometric_credential_id = '' WHERE biometric_credential_id = ?`
        ).bind(id).run();
        legacyCleared += Number((r as any)?.meta?.changes || 0);
      } else {
        const r = await db.prepare(
          `UPDATE trusted_devices SET biometric_credential_id = '' WHERE biometric_credential_id = ? AND fingerprint = ?`
        ).bind(id, fingerprint).run();
        legacyCleared += Number((r as any)?.meta?.changes || 0);
      }
    } catch { /* column may differ */ }
  }

  if (row) {
    if (row.fingerprint !== fingerprint && role !== 'owner' && role !== 'admin') {
      return { ok: false as const, code: 403 as const, error: 'Non autorisé' };
    }
    await db.prepare(`DELETE FROM webauthn_credentials WHERE id = ?`).bind(matchedId).run();
    // also clear any trusted_devices pointing at this id
    try {
      await db.prepare(
        `UPDATE trusted_devices SET biometric_credential_id = '' WHERE biometric_credential_id = ?`
      ).bind(matchedId).run();
    } catch { /* */ }
    return { ok: true as const, id: matchedId, fingerprint: String(row.fingerprint || fingerprint) };
  }

  if (legacyCleared > 0) {
    return { ok: true as const, id: variants[0], fingerprint };
  }

  return { ok: false as const, code: 404 as const, error: 'Clé introuvable (déjà supprimée ou autre appareil)' };
}



app.delete('/api/auth/webauthn/credentials/:id', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const id = c.req.param('id') || '';
  const result = await deleteWebauthnCredentialRow(c.env.DB, id, fingerprint, sess.role || '');
  if (!result.ok) {
    // Idempotent: treat missing as success so UI can refresh cleanly
    if (result.code === 404) {
      return c.json({ success: true, message: 'Clé déjà absente du serveur.', data: { id } });
    }
    return c.json({ success: false, error: result.error }, result.code);
  }
  return c.json({
    success: true,
    message: "Clé supprimée du serveur. Retirez-la aussi dans les réglages de l'appareil si elle apparaît encore.",
    data: { id: result.id, fingerprint: result.fingerprint },
  });
});

/** Body-based delete (avoids path encoding issues with long credential ids) */
app.post('/api/auth/webauthn/credentials/delete', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const id = String(body.id || body.credential_id || '').trim();
  if (!id) return c.json({ success: false, error: 'id obligatoire' }, 400);
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const result = await deleteWebauthnCredentialRow(c.env.DB, id, fingerprint, sess.role || '');
  if (!result.ok) {
    if (result.code === 404) {
      return c.json({ success: true, message: 'Clé déjà absente du serveur.', data: { id } });
    }
    return c.json({ success: false, error: result.error }, result.code);
  }
  return c.json({
    success: true,
    message: "Clé supprimée du serveur. Retirez-la aussi dans les réglages de l'appareil si elle apparaît encore.",
    data: { id: result.id, fingerprint: result.fingerprint },
  });
});


/** Legacy aliases */
app.post('/api/auth/register-biometric', async (c) => {
  // Redirect clients: use /api/auth/webauthn/register/*
  return c.json({
    success: false,
    error: 'Utilisez /api/auth/webauthn/register/options puis /verify',
    code: 'USE_WEBAUTHN_FLOW',
  }, 400);
});

app.post('/api/auth/login-biometric', async (c) => {
  return c.json({
    success: false,
    error: 'Utilisez /api/auth/webauthn/login/options puis /verify',
    code: 'USE_WEBAUTHN_FLOW',
  }, 400);
});

/** Public probe: trusted device + credentials count */

/** List trusted devices for current session user (admin sees all). */
app.get('/api/auth/trusted-devices', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const ip = clientIp(c);
  const fp = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  await addColumnIfMissing(c.env.DB, 'trusted_devices', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(c.env.DB, 'trusted_devices', 'user_agent', "TEXT DEFAULT ''");
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const isAdmin = sess.role === 'owner' || sess.role === 'admin';
  let rows: any[] = [];
  try {
    if (isAdmin) {
      const r = await c.env.DB.prepare(
        `SELECT fingerprint, label, last_ip, last_seen, created_at, username, user_agent
         FROM trusted_devices ORDER BY datetime(last_seen) DESC LIMIT 50`
      ).all();
      rows = r.results || [];
    } else {
      const r = await c.env.DB.prepare(
        `SELECT fingerprint, label, last_ip, last_seen, created_at, username, user_agent
         FROM trusted_devices
         WHERE username = ? OR fingerprint = ?
         ORDER BY datetime(last_seen) DESC LIMIT 30`
      ).bind(sess.username || '', fp).all();
      rows = r.results || [];
    }
  } catch (e: any) {
    console.error('trusted-devices list', e?.message);
  }
  const data = (rows || []).map((r: any) => ({
    fingerprint: r.fingerprint,
    label: r.label || r.user_agent || 'Appareil',
    last_ip: r.last_ip || '',
    last_seen: r.last_seen || '',
    created_at: r.created_at || '',
    username: r.username || '',
    is_current: r.fingerprint === fp,
  }));
  return c.json({ success: true, data });
});

/** Remove a trusted device (self or admin). */
app.delete('/api/auth/trusted-devices/:fingerprint', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const ip = clientIp(c);
  const fp = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const target = decodeURIComponent(c.req.param('fingerprint') || '').slice(0, 128);
  if (!target) return c.json({ success: false, error: 'Empreinte requise' }, 400);
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const isAdmin = sess.role === 'owner' || sess.role === 'admin';
  const row = await c.env.DB.prepare(`SELECT * FROM trusted_devices WHERE fingerprint = ?`).bind(target).first() as any;
  if (!row) return c.json({ success: true, message: 'Déjà retiré' });
  if (!isAdmin && row.fingerprint !== fp && String(row.username || '') !== String(sess.username || '')) {
    return c.json({ success: false, error: 'Non autorisé' }, 403);
  }
  await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE fingerprint = ?`).bind(target).run();
  return c.json({ success: true, message: 'Appareil retiré' });
});

app.post('/api/auth/device-status', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  await ensureSecurityTables(c.env.DB);
  if (!fingerprint || fingerprint === 'none') {
    return c.json({ success: true, trusted: false, biometric_registered: false, credential_count: 0 });
  }
  const row = await c.env.DB.prepare(
    `SELECT biometric_credential_id FROM trusted_devices WHERE fingerprint = ?`
  ).bind(fingerprint).first() as any;
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as c FROM webauthn_credentials WHERE fingerprint = ?`
  ).bind(fingerprint).first() as any;
  const count = Number(countRow?.c || 0) + (row?.biometric_credential_id ? 1 : 0);
  return c.json({
    success: true,
    trusted: !!row,
    biometric_registered: count > 0,
    credential_count: count,
    password_configured: !!getPassword(c.env),
  });
});

}
