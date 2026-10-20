
import { addColumnIfMissing } from './schema';

const _localSchemaOnce = new Set<string>();
/** Client schema helpers — shared by routes/clients and invoice credit checks */

export async function ensureClientTaxExempt(db: D1Database) {
  if (_localSchemaOnce.has('ensureClientTaxExempt')) return;

  await addColumnIfMissing(db, 'clients', 'tax_exempt', 'INTEGER DEFAULT 0');

  _localSchemaOnce.add('ensureClientTaxExempt');
}

/** Max outstanding credit in currency units; 0 or null = unlimited */
export async function ensureClientCreditLimit(db: D1Database) {
  if (_localSchemaOnce.has('ensureClientCreditLimit')) return;

  await addColumnIfMissing(db, 'clients', 'credit_limit', 'REAL DEFAULT 0');

  _localSchemaOnce.add('ensureClientCreditLimit');
}

/**
 * Outstanding balance for a client (open invoices only).
 * Returns { outstanding, limit, ok, message }
 */
export async function checkClientCreditLimit(
  db: D1Database,
  opts: { clientId?: number | null; clientName?: string; clientIce?: string; addAmount: number },
): Promise<{ ok: boolean; outstanding: number; limit: number; message?: string }> {
  await ensureClientCreditLimit(db);
  let client: any = null;
  if (opts.clientId) {
    client = await db.prepare(`SELECT * FROM clients WHERE id = ?`).bind(opts.clientId).first();
  }
  if (!client && opts.clientIce) {
    client = await db.prepare(`SELECT * FROM clients WHERE ice = ?`).bind(opts.clientIce).first();
  }
  if (!client && opts.clientName) {
    client = await db.prepare(`SELECT * FROM clients WHERE lower(name) = lower(?)`).bind(opts.clientName).first();
  }
  if (!client) {
    return { ok: true, outstanding: 0, limit: 0 };
  }
  const limit = Number(client.credit_limit || 0);
  if (!limit || limit <= 0) {
    return { ok: true, outstanding: 0, limit: 0 };
  }
  let row: any;
  if (client.ice) {
    row = await db
      .prepare(
        `SELECT COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as due
       FROM invoices
       WHERE status NOT IN ('quote','devis','cancelled','paid')
         AND (client_id = ? OR client_ice = ? OR lower(client_name) = lower(?))`,
      )
      .bind(client.id, client.ice, client.name)
      .first();
  } else {
    row = await db
      .prepare(
        `SELECT COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as due
       FROM invoices
       WHERE status NOT IN ('quote','devis','cancelled','paid')
         AND (client_id = ? OR lower(client_name) = lower(?))`,
      )
      .bind(client.id, client.name)
      .first();
  }
  const outstanding = Number(row?.due || 0);
  const projected = outstanding + Number(opts.addAmount || 0);
  if (projected > limit + 0.001) {
    return {
      ok: false,
      outstanding,
      limit,
      message: `Limite de crédit dépassée pour ${client.name}: en cours ${outstanding} + cette facture ${(opts.addAmount || 0)} = ${projected} (plafond ${limit}).`,
    };
  }
  return { ok: true, outstanding, limit };
}
