/**
 * v0.7.1 — « Appareils connectés » routes, extracted from worker/index.ts
 * (same paths, same behaviour — mechanical move, deps injected):
 *   GET  /api/auth/devices         → list + device_label + city/country (cf IP)
 *   POST /api/auth/devices/revoke  → revoke (OTP note kept by caller UI)
 */
export interface DeviceRoutesDeps {
  sessionUserFromHeader: (h: string | undefined) => { username: string; role: string };
  authFailReason: (...a: any[]) => Promise<string>;
  clientIp: (c: any) => string;
  ensureSecurityTables: (db: any) => Promise<void>;
  touchTrustedDevice: (...a: any[]) => Promise<void>;
  deviceLabelFromUA: (ua: unknown) => string;
  cfGeo: (c: any) => { city: string; country: string };
  writeAudit: (db: any, e: any) => Promise<void>;
}

export function registerDeviceRoutes(app: any, deps: DeviceRoutesDeps): void {
app.get('/api/auth/devices', async (c: any) => {
  const reason = await deps.authFailReason(c.req.header('Authorization'), c.env, c.env.DB, deps.clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = deps.sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const fp = String(c.req.header('X-Device-Fingerprint') || '');
  await deps.ensureSecurityTables(c.env.DB);
  const rows = await c.env.DB.prepare(`SELECT fingerprint, last_ip, last_seen, user_agent FROM trusted_devices WHERE lower(username) = ? ORDER BY last_seen DESC LIMIT 25`).bind(username).all() as any;
  const data = (rows.results || []).map((r: any) => ({
    fingerprint: String(r.fingerprint || '').slice(0, 12) + '…',
    full: String(r.fingerprint || ''),
    last_ip: r.last_ip,
    last_seen: r.last_seen,
    user_agent: String(r.user_agent || '').slice(0, 90),
    device_label: deps.deviceLabelFromUA(r.user_agent),
    city: String(r.city || ''),
    country: String(r.country || ''),
    current: fp && String(r.fingerprint || '') === fp,
  }));
  if (fp && !data.some((d: any) => d.current)) {
    try {
      await deps.touchTrustedDevice(c.env.DB, username, fp, deps.clientIp(c), c.req.header('User-Agent') || '', deps.cfGeo(c));
      const cfNow = deps.cfGeo(c);
      data.unshift({
        fingerprint: fp.slice(0, 12) + '…',
        full: fp,
        last_ip: deps.clientIp(c),
        last_seen: new Date().toISOString(),
        user_agent: String(c.req.header('User-Agent') || '').slice(0, 90),
        device_label: deps.deviceLabelFromUA(c.req.header('User-Agent') || ''),
        city: cfNow.city,
        country: cfNow.country,
        current: true,
      });
    } catch { /* best-effort */ }
  }
  return c.json({ success: true, data });
});

app.post('/api/auth/devices/revoke', async (c: any) => {
  const reason = await deps.authFailReason(c.req.header('Authorization'), c.env, c.env.DB, deps.clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = deps.sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const target = String(body.fingerprint || '');
  if (!target) return c.json({ success: false, error: 'Empreinte requise' }, 400);
  await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE fingerprint = ? AND lower(username) = ?`).bind(target, username).run();
  await deps.writeAudit(c.env.DB, { username, role: session.role, action: 'device.revoke', entity: target.slice(0, 12), detail: 'trusted_device' });
  return c.json({ success: true });
});

/** Best-effort: remember every device that actively uses the account. */
}
