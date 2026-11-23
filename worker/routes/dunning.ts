import type { Hono } from 'hono';
import { round2 } from '../lib/financeCore';
import { schemaOnceForDb } from '../lib/schema';

export interface DunningRouteDeps {
  requireEmployeeAdmin: (c: any) => Promise<Response | null>;
  sessionUserFromHeader: (hdr?: string) => { username?: string; role?: string };
  writeAudit: (
    db: D1Database,
    entry: { username?: string; role?: string; action: string; entity?: string; entity_id?: string; detail?: string; ip?: string },
  ) => Promise<void>;
  clientIp: (c: any) => string;
}

const DEFAULT_STAGES = ['D-3', 'D+1', 'D+7', 'D+15'];
const DEFAULT_EMAIL_SUBJECT = 'Rappel facture {{invoice_number}} — {{company}}';
const DEFAULT_EMAIL_BODY =
  "Bonjour {{client}},\n\nSauf erreur de notre part, la facture {{invoice_number}} d'un montant restant de {{amount}} (échéance {{due_date}}) reste à régler.\n\nClient ICE : {{ice}}\nMerci de procéder au règlement.\n\nCordialement,\n{{company}}";
const DEFAULT_WA_TEMPLATE =
  'Bonjour {{client}}, rappel concernant la facture {{invoice_number}} (reste dû : {{amount}}, échéance : {{due_date}}, ICE : {{ice}}). Merci — {{company}}.';

export async function ensureDunningSchema(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'dunning_schema_v18', async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS dunning_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          stages_json TEXT NOT NULL DEFAULT '["D-3","D+1","D+7","D+15"]',
          email_subject_template TEXT NOT NULL DEFAULT '',
          email_body_template TEXT NOT NULL DEFAULT '',
          whatsapp_template TEXT NOT NULL DEFAULT '',
          updated_at TEXT DEFAULT (datetime('now')),
          updated_by TEXT DEFAULT ''
        )`,
      )
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO dunning_settings (id, enabled, stages_json, email_subject_template, email_body_template, whatsapp_template)
         VALUES (1, 0, ?, ?, ?, ?)`,
      )
      .bind(JSON.stringify(DEFAULT_STAGES), DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_BODY, DEFAULT_WA_TEMPLATE)
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS dunning_invoice_overrides (
          invoice_id INTEGER PRIMARY KEY,
          paused INTEGER NOT NULL DEFAULT 0,
          reason TEXT DEFAULT '',
          paused_by TEXT DEFAULT '',
          paused_at TEXT DEFAULT (datetime('now'))
        )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS dunning_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL,
          stage TEXT NOT NULL,
          channel TEXT NOT NULL,
          recipient TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'sent',
          message_preview TEXT DEFAULT '',
          error_text TEXT DEFAULT '',
          sent_at TEXT DEFAULT (datetime('now')),
          UNIQUE(invoice_id, stage)
        )`,
      )
      .run();
    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_dunning_events_inv ON dunning_events(invoice_id, sent_at DESC)`).run();
    } catch {
      /* */
    }
  });
}

export function renderDunningTemplate(
  template: string,
  vars: {
    client: string;
    amount: string;
    due_date: string;
    invoice_number: string;
    ice: string;
    company: string;
  },
): string {
  const map: Record<string, string> = {
    client: vars.client,
    amount: vars.amount,
    montant: vars.amount,
    due_date: vars.due_date,
    echeance: vars.due_date,
    invoice_number: vars.invoice_number,
    numero: vars.invoice_number,
    ice: vars.ice || '—',
    company: vars.company || 'Atlas Commerce',
    societe: vars.company || 'Atlas Commerce',
  };
  return String(template || '').replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (m, k) => {
    const key = String(k).toLowerCase();
    return key in map ? map[key] : m;
  });
}

export function normalizeWaPhone(raw: string | null | undefined): string {
  let digits = String(raw || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = `212${digits.slice(1)}`;
  return digits.length >= 8 ? digits : '';
}

export function buildWhatsAppDeepLink(phone: string | null | undefined, message: string): string | null {
  const digits = normalizeWaPhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function parseStageOffset(stage: string): number | null {
  const m = String(stage || '').trim().toUpperCase().match(/^D([+-]\d+)$/);
  return m ? Number(m[1]) : null;
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return null;
  const a = new Date(`${fromYmd}T12:00:00Z`).getTime();
  const b = new Date(`${toYmd}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

async function sendDunningEmail(
  env: any,
  to: string,
  subject: string,
  textBody: string,
): Promise<{ sent: boolean; provider: string; error?: string }> {
  const addr = String(to || '').trim();
  if (!addr.includes('@')) {
    return { sent: false, provider: 'none', error: 'Adresse email client manquante' };
  }
  const resendKey = String(env?.RESEND_API_KEY || '').trim();
  if (resendKey) {
    try {
      const from = String(env?.RESEND_FROM || 'onboarding@resend.dev');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [addr],
          subject,
          text: textBody,
        }),
      });
      if (res.ok) return { sent: true, provider: 'resend' };
      const errJson = (await res.json().catch(() => ({}))) as any;
      return { sent: false, provider: 'resend', error: errJson?.message || `Resend HTTP ${res.status}` };
    } catch (e: any) {
      return { sent: false, provider: 'resend', error: String(e?.message || e) };
    }
  }
  if (env?.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      await env.EMAIL.send({ to: addr, subject, text: textBody });
      return { sent: true, provider: 'cf_email' };
    } catch (e: any) {
      return { sent: false, provider: 'cf_email', error: String(e?.message || e) };
    }
  }
  return { sent: false, provider: 'none', error: 'RESEND_API_KEY / EMAIL non configuré' };
}

async function loadDunningConfig(db: D1Database) {
  await ensureDunningSchema(db);
  const row = (await db.prepare(`SELECT * FROM dunning_settings WHERE id = 1`).first()) as any;
  let stages = DEFAULT_STAGES;
  try {
    const parsed = JSON.parse(String(row?.stages_json || ''));
    if (Array.isArray(parsed) && parsed.length) stages = parsed.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  } catch {
    /* */
  }
  return {
    enabled: Number(row?.enabled || 0) === 1,
    stages,
    email_subject_template: String(row?.email_subject_template || DEFAULT_EMAIL_SUBJECT),
    email_body_template: String(row?.email_body_template || DEFAULT_EMAIL_BODY),
    whatsapp_template: String(row?.whatsapp_template || DEFAULT_WA_TEMPLATE),
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || '',
  };
}

export async function runDailyDunning(
  env: { DB: D1Database; RESEND_API_KEY?: string; RESEND_FROM?: string; EMAIL?: any },
  opts?: { today?: string; force?: boolean },
): Promise<{ skipped: boolean; checked: number; sent: number; failed: number; details: any[] }> {
  const db = env.DB;
  await ensureDunningSchema(db);
  const cfg = await loadDunningConfig(db);
  if (!cfg.enabled && !opts?.force) {
    return { skipped: true, checked: 0, sent: 0, failed: 0, details: [] };
  }

  const today = String(opts?.today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const settings = (await db.prepare(`SELECT company_name, currency FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;
  const companyName = String(settings?.company_name || 'Atlas Commerce');
  const currency = String(settings?.currency || 'MAD');

  let invoices: any[] = [];
  try {
    const res = await db
      .prepare(
        `SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid, i.status, i.doc_kind,
                COALESCE(c.name, i.client_name, 'Client') AS client_name,
                COALESCE(c.email, i.client_email, '') AS client_email,
                COALESCE(c.phone, i.client_phone, '') AS client_phone,
                COALESCE(c.ice, i.client_ice, '') AS client_ice,
                COALESCE(o.paused, 0) AS paused
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN dunning_invoice_overrides o ON o.invoice_id = i.id
         WHERE COALESCE(i.status, '') NOT IN ('paid', 'cancelled', 'void', 'draft', 'quote', 'devis')
           AND COALESCE(i.doc_kind, 'invoice') <> 'credit'
           AND COALESCE(o.paused, 0) = 0
           AND i.due_date IS NOT NULL AND TRIM(i.due_date) <> ''`,
      )
      .all();
    invoices = (res.results || []) as any[];
  } catch {
    invoices = [];
  }

  let sent = 0;
  let failed = 0;
  const details: any[] = [];

  for (const inv of invoices) {
    const remaining = round2(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)));
    if (remaining <= 0) continue;
    const dueYmd = String(inv.due_date || '').slice(0, 10);
    const diff = daysBetweenYmd(dueYmd, today);
    if (diff == null) continue;

    const matchingStage = cfg.stages.find((st) => parseStageOffset(st) === diff);
    if (!matchingStage) continue;

    // Dedup check via UNIQUE(invoice_id, stage)
    const vars = {
      client: String(inv.client_name || 'Client'),
      amount: `${remaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
      due_date: dueYmd,
      invoice_number: String(inv.invoice_number || `FAC-${inv.id}`),
      ice: String(inv.client_ice || ''),
      company: companyName,
    };
    const subject = renderDunningTemplate(cfg.email_subject_template, vars);
    const body = renderDunningTemplate(cfg.email_body_template, vars);

    const ins = await db
      .prepare(
        `INSERT OR IGNORE INTO dunning_events (invoice_id, stage, channel, recipient, status, message_preview)
         VALUES (?, ?, 'email', ?, 'pending', ?)`,
      )
      .bind(inv.id, matchingStage, String(inv.client_email || ''), body)
      .run();

    if (!ins.meta?.changes) {
      // Already processed for this (invoice_id, stage)
      continue;
    }

    const emailResult = await sendDunningEmail(env, inv.client_email, subject, body);
    const finalStatus = emailResult.sent ? 'sent' : 'failed';
    if (emailResult.sent) sent += 1;
    else failed += 1;

    await db
      .prepare(`UPDATE dunning_events SET status = ?, error_text = ?, sent_at = datetime('now') WHERE invoice_id = ? AND stage = ?`)
      .bind(finalStatus, emailResult.error || '', inv.id, matchingStage)
      .run();

    details.push({
      invoice_id: inv.id,
      invoice_number: vars.invoice_number,
      stage: matchingStage,
      status: finalStatus,
      error: emailResult.error || null,
    });
  }

  return { skipped: false, checked: invoices.length, sent, failed, details };
}

export function registerDunningRoutes(app: Hono<any>, deps: DunningRouteDeps): void {
  const { requireEmployeeAdmin, sessionUserFromHeader, writeAudit, clientIp } = deps;

  app.get('/api/dunning/settings', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    const cfg = await loadDunningConfig(c.env.DB);
    return c.json({ success: true, data: cfg });
  });

  app.put('/api/dunning/settings', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensureDunningSchema(c.env.DB);
    const actor = sessionUserFromHeader(c.req.header('Authorization'));
    const body = await c.req.json().catch(() => ({}));
    const current = await loadDunningConfig(c.env.DB);

    const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : current.enabled ? 1 : 0;
    const stages = Array.isArray(body.stages)
      ? body.stages.map((s: any) => String(s).trim().toUpperCase()).filter((s: string) => parseStageOffset(s) !== null)
      : current.stages;
    const emailSubject = body.email_subject_template !== undefined ? String(body.email_subject_template) : current.email_subject_template;
    const emailBody = body.email_body_template !== undefined ? String(body.email_body_template) : current.email_body_template;
    const waTpl = body.whatsapp_template !== undefined ? String(body.whatsapp_template) : current.whatsapp_template;

    await c.env.DB.prepare(
      `UPDATE dunning_settings
       SET enabled = ?, stages_json = ?, email_subject_template = ?, email_body_template = ?, whatsapp_template = ?,
           updated_at = datetime('now'), updated_by = ?
       WHERE id = 1`,
    )
      .bind(enabled, JSON.stringify(stages.length ? stages : DEFAULT_STAGES), emailSubject, emailBody, waTpl, actor.username || '')
      .run();

    await writeAudit(c.env.DB, {
      username: actor.username,
      role: actor.role,
      action: 'dunning.settings_update',
      entity: 'dunning_settings',
      entity_id: '1',
      detail: JSON.stringify({ enabled: Boolean(enabled), stages }),
      ip: clientIp(c),
    });

    return c.json({ success: true, data: await loadDunningConfig(c.env.DB) });
  });

  app.get('/api/dunning/invoices/:id', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensureDunningSchema(c.env.DB);
    const invoiceId = Number(c.req.param('id') || 0);
    const inv = (await c.env.DB
      .prepare(
        `SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid, i.status,
                COALESCE(c.name, i.client_name, 'Client') AS client_name,
                COALESCE(c.email, i.client_email, '') AS client_email,
                COALESCE(c.phone, i.client_phone, '') AS client_phone,
                COALESCE(c.ice, i.client_ice, '') AS client_ice,
                COALESCE(o.paused, 0) AS paused,
                COALESCE(o.reason, '') AS pause_reason
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN dunning_invoice_overrides o ON o.invoice_id = i.id
         WHERE i.id = ?`,
      )
      .bind(invoiceId)
      .first()) as any;
    if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    const cfg = await loadDunningConfig(c.env.DB);
    const settings = (await c.env.DB.prepare(`SELECT company_name, currency FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;
    const currency = String(settings?.currency || 'MAD');
    const remaining = round2(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)));
    const vars = {
      client: String(inv.client_name || 'Client'),
      amount: `${remaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
      due_date: String(inv.due_date || '—').slice(0, 10),
      invoice_number: String(inv.invoice_number || `FAC-${inv.id}`),
      ice: String(inv.client_ice || ''),
      company: String(settings?.company_name || 'Atlas Commerce'),
    };
    const renderedSubject = renderDunningTemplate(cfg.email_subject_template, vars);
    const renderedEmail = renderDunningTemplate(cfg.email_body_template, vars);
    const renderedWa = renderDunningTemplate(cfg.whatsapp_template, vars);
    const whatsappUrl = buildWhatsAppDeepLink(inv.client_phone, renderedWa);

    const eventsRes = await c.env.DB
      .prepare(`SELECT * FROM dunning_events WHERE invoice_id = ? ORDER BY sent_at DESC, id DESC`)
      .bind(invoiceId)
      .all();

    return c.json({
      success: true,
      data: {
        invoice_id: invoiceId,
        remaining,
        paused: Number(inv.paused || 0) === 1,
        pause_reason: inv.pause_reason || '',
        client_email: inv.client_email || '',
        client_phone: inv.client_phone || '',
        rendered_subject: renderedSubject,
        rendered_email: renderedEmail,
        rendered_whatsapp: renderedWa,
        whatsapp_url: whatsappUrl,
        events: eventsRes.results || [],
      },
    });
  });

  app.post('/api/dunning/invoices/:id/pause', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensureDunningSchema(c.env.DB);
    const actor = sessionUserFromHeader(c.req.header('Authorization'));
    const invoiceId = Number(c.req.param('id') || 0);
    const body = await c.req.json().catch(() => ({}));
    const paused = body.paused ? 1 : 0;
    const reason = String(body.reason || '');

    await c.env.DB.prepare(
      `INSERT INTO dunning_invoice_overrides (invoice_id, paused, reason, paused_by, paused_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(invoice_id) DO UPDATE SET
         paused = excluded.paused,
         reason = excluded.reason,
         paused_by = excluded.paused_by,
         paused_at = datetime('now')`,
    )
      .bind(invoiceId, paused, reason, actor.username || '')
      .run();

    await writeAudit(c.env.DB, {
      username: actor.username,
      role: actor.role,
      action: paused ? 'dunning.invoice_pause' : 'dunning.invoice_resume',
      entity: 'invoices',
      entity_id: String(invoiceId),
      detail: reason,
      ip: clientIp(c),
    });

    return c.json({ success: true, data: { invoice_id: invoiceId, paused: Boolean(paused), reason } });
  });

  app.post('/api/dunning/invoices/:id/send', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensureDunningSchema(c.env.DB);
    const actor = sessionUserFromHeader(c.req.header('Authorization'));
    const invoiceId = Number(c.req.param('id') || 0);
    const body = await c.req.json().catch(() => ({}));
    const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const stage = String(body.stage || `MANUAL-${Date.now()}`).trim();

    const inv = (await c.env.DB
      .prepare(
        `SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid,
                COALESCE(c.name, i.client_name, 'Client') AS client_name,
                COALESCE(c.email, i.client_email, '') AS client_email,
                COALESCE(c.phone, i.client_phone, '') AS client_phone,
                COALESCE(c.ice, i.client_ice, '') AS client_ice
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         WHERE i.id = ?`,
      )
      .bind(invoiceId)
      .first()) as any;
    if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    const cfg = await loadDunningConfig(c.env.DB);
    const settings = (await c.env.DB.prepare(`SELECT company_name, currency FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;
    const currency = String(settings?.currency || 'MAD');
    const remaining = round2(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)));
    const vars = {
      client: String(inv.client_name || 'Client'),
      amount: `${remaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
      due_date: String(inv.due_date || '—').slice(0, 10),
      invoice_number: String(inv.invoice_number || `FAC-${inv.id}`),
      ice: String(inv.client_ice || ''),
      company: String(settings?.company_name || 'Atlas Commerce'),
    };

    const preview =
      channel === 'whatsapp'
        ? renderDunningTemplate(cfg.whatsapp_template, vars)
        : renderDunningTemplate(cfg.email_body_template, vars);

    const ins = await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO dunning_events (invoice_id, stage, channel, recipient, status, message_preview)
         VALUES (?, ?, ?, ?, 'prepared', ?)`,
      )
      .bind(invoiceId, stage, channel, channel === 'whatsapp' ? inv.client_phone : inv.client_email, preview)
      .run();

    if (!ins.meta?.changes) {
      return c.json(
        { success: false, error: `Relance déjà envoyée pour l’étape ${stage}.`, code: 'DUNNING_ALREADY_SENT' },
        409,
      );
    }

    if (channel === 'whatsapp') {
      const whatsapp_url = buildWhatsAppDeepLink(inv.client_phone, preview);
      return c.json({
        success: true,
        data: { channel: 'whatsapp', stage, whatsapp_url, message: preview },
      });
    }

    const subject = renderDunningTemplate(cfg.email_subject_template, vars);
    const res = await sendDunningEmail(c.env, inv.client_email, subject, preview);
    await c.env.DB
      .prepare(`UPDATE dunning_events SET status = ?, error_text = ? WHERE invoice_id = ? AND stage = ?`)
      .bind(res.sent ? 'sent' : 'failed', res.error || '', invoiceId, stage)
      .run();

    if (!res.sent) {
      return c.json({ success: false, error: res.error || 'Envoi email impossible', code: 'EMAIL_SEND_FAILED' }, 422);
    }

    await writeAudit(c.env.DB, {
      username: actor.username,
      role: actor.role,
      action: 'dunning.manual_send',
      entity: 'invoices',
      entity_id: String(invoiceId),
      detail: JSON.stringify({ stage, channel, to: inv.client_email }),
      ip: clientIp(c),
    });

    return c.json({ success: true, data: { channel: 'email', stage, sent: true, to: inv.client_email } });
  });

  app.post('/api/dunning/run-now', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    const body = await c.req.json().catch(() => ({}));
    const report = await runDailyDunning(c.env, {
      today: body.today ? String(body.today).slice(0, 10) : undefined,
      force: Boolean(body.force),
    });
    return c.json({ success: true, data: report });
  });
}
