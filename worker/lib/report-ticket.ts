/** Short-lived bearer capability for read-only finance report pages. */
import { FINANCE_TENANT } from './finance';

export const REPORT_TICKET_PATHS = new Set([
  '/api/reports/combined', '/api/reports/balance', '/api/reports/stock',
  '/api/reports/receivables', '/api/reports/payables', '/api/reports/employees',
  '/api/reports/aging', '/api/reports/aging.html', '/api/reports/aging.csv',
  '/api/reports/tva', '/api/reports/tva.html', '/api/reports/tva.csv',
  '/api/reports/client-situation', '/api/reports/employee-situation',
  '/api/reports/employee-blank-form', '/api/reports/cogs',
]);

export type ReportTicketIdentity = { username: string; role: 'owner' | 'admin'; userId: number | null; tenant: string };
export type ReportTicketEnvironment = { DB: D1Database; JWT_SECRET?: string; ADMIN_PASSWORD?: string; REPORT_TICKET_TTL_SECONDS?: string };
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value: string): Uint8Array {
  const b = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

/** Android currently accepts at most 1800 seconds. Configuration may only shorten it. */
export function reportTicketTtl(env: ReportTicketEnvironment): number {
  const raw = env.REPORT_TICKET_TTL_SECONDS;
  if (raw == null || raw === '') return 1800;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error('Invalid report ticket TTL');
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > 1800) throw new Error('Invalid report ticket TTL');
  return n;
}

async function keyFor(env: ReportTicketEnvironment, identity: ReportTicketIdentity, ownerUsername: string, purpose = 'atlas-report-v2'): Promise<CryptoKey | null> {
  const secret = String(env.JWT_SECRET || env.ADMIN_PASSWORD || '').trim();
  if (!secret || identity.tenant !== FINANCE_TENANT) return null;
  let material: string;
  if (identity.role === 'owner') {
    if (identity.userId !== null || identity.username !== ownerUsername || !env.ADMIN_PASSWORD) return null;
    material = env.ADMIN_PASSWORD;
  } else {
    if (identity.role !== 'admin' || !Number.isSafeInteger(identity.userId) || !identity.userId || identity.userId <= 0) return null;
    const row = await env.DB.prepare('SELECT id, role, password_hash FROM app_users WHERE username = ? AND active = 1').bind(identity.username).first() as { id: number; role: string; password_hash: string } | null;
    if (!row || row.id !== identity.userId || row.role !== 'admin' || !row.password_hash) return null;
    material = row.password_hash;
  }
  // Binding the MAC key to current account material revokes the ticket on password change.
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([purpose, secret, identity.tenant, identity.username, identity.userId, material])));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function mintScopedReportTicket(env: ReportTicketEnvironment, identity: ReportTicketIdentity, ownerUsername: string, now = Date.now()): Promise<{ rt: string; expires_in: number }> {
  const ttl = reportTicketTtl(env);
  const key = await keyFor(env, identity, ownerUsername);
  if (!key) throw new Error('Report ticket unavailable');
  const payload = encode(encoder.encode(JSON.stringify({ v: 2, exp: Math.floor(now / 1000) + ttl, ...identity })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return { rt: `${payload}.${encode(signature)}`, expires_in: ttl };
}

export async function verifyScopedReportTicket(env: ReportTicketEnvironment, ticket: string, ownerUsername: string, now = Date.now()): Promise<'ok' | 'expired' | 'invalid'> {
  try {
    if (ticket.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) return 'invalid';
    const [payload, signature] = ticket.split('.');
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!value || value.v !== 2 || typeof value.username !== 'string' || !value.username || value.username !== value.username.toLowerCase() || value.username.length > 80 ||
        !Number.isSafeInteger(value.exp) || (value.role !== 'owner' && value.role !== 'admin') || value.tenant !== FINANCE_TENANT) return 'invalid';
    const key = await keyFor(env, value, ownerUsername);
    if (!key || !(await crypto.subtle.verify('HMAC', key, new Uint8Array(decode(signature)), encoder.encode(payload)))) return 'invalid';
    const current = Math.floor(now / 1000);
    if (value.exp <= current) return 'expired';
    // Reject forged or stale tokens with unusually distant expiration, including misconfigured issuers.
    if (value.exp > current + 1800) return 'invalid';
    return 'ok';
  } catch {
    return 'invalid';
  }
}

/** Separate capability domain from finance reports; re-check account on use. */
export async function mintScopedPrintTicket(env: ReportTicketEnvironment, identity: ReportTicketIdentity, ownerUsername: string, fingerprint: string, now = Date.now()): Promise<{ rt: string; expires_in: number }> {
  const ttl = reportTicketTtl(env);
  const key = await keyFor(env, identity, ownerUsername, 'atlas-print-v2');
  if (!key) throw new Error('Print ticket unavailable');
  const fp = String(fingerprint || 'none').slice(0, 128);
  const payload = encode(encoder.encode(JSON.stringify({ v: 2, purpose: 'print', exp: Math.floor(now / 1000) + ttl, ...identity, fingerprint: fp })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return { rt: `${payload}.${encode(signature)}`, expires_in: ttl };
}

export async function verifyScopedPrintTicket(env: ReportTicketEnvironment, ticket: string, ownerUsername: string, now = Date.now()): Promise<boolean> {
  try {
    if (ticket.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket)) return false;
    const [payload, signature] = ticket.split('.');
    const value = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!value || value.v !== 2 || value.purpose !== 'print' || typeof value.username !== 'string' || !value.username || value.username !== value.username.toLowerCase() || value.username.length > 80 ||
      !Number.isSafeInteger(value.exp) || (value.role !== 'owner' && value.role !== 'admin') || value.tenant !== FINANCE_TENANT || typeof value.fingerprint !== 'string' || !value.fingerprint || value.fingerprint.length > 128) return false;
    const key = await keyFor(env, value, ownerUsername, 'atlas-print-v2');
    if (!key || !(await crypto.subtle.verify('HMAC', key, new Uint8Array(decode(signature)), encoder.encode(payload)))) return false;
    if (value.fingerprint !== 'none') {
      const device = await env.DB.prepare('SELECT username FROM trusted_devices WHERE fingerprint = ?').bind(value.fingerprint).first() as { username?: string } | null;
      if (!device || (device.username && device.username.toLowerCase() !== value.username)) return false;
    }
    const current = Math.floor(now / 1000);
    return value.exp > current && value.exp <= current + 1800;
  } catch { return false; }
}
