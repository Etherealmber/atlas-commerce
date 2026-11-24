import type { AtlasApp } from './types';
import { round2 } from '../lib/financeCore';
import { normalizeRole } from '../lib/rbac';
import { escapeHtml } from '../lib/security';
import { schemaOnceForDb } from '../lib/schema';

interface CashShiftRouteDeps {
  sessionUserFromHeader: (authHeader?: string) => { username?: string; role?: string };
  writeAudit: (db: D1Database, entry: { username?: string; role?: string; action: string; entity?: string; entity_id?: string; detail?: string; ip?: string }) => Promise<void>;
  reportShell: (title: string, company: string, period: string, body: string, footer?: string, backUrl?: string) => string;
}

export async function ensureCashShiftSchema(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'cash_shift_schema_v14', async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS cash_shifts (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          till_id         TEXT NOT NULL DEFAULT 'CAISSE-1',
          operator        TEXT NOT NULL,
          opened_at       TEXT NOT NULL,
          closed_at       TEXT,
          opening_float   REAL NOT NULL DEFAULT 0,
          counted_amount  REAL,
          expected_amount REAL,
          variance        REAL,
          status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
          denominations   TEXT NOT NULL DEFAULT '{}',
          by_method_json  TEXT NOT NULL DEFAULT '{}',
          notes           TEXT NOT NULL DEFAULT '',
          closed_by       TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
      )
      .run();
    await db
      .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_till ON cash_shifts(till_id) WHERE status = 'open'`)
      .run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened ON cash_shifts(opened_at DESC)`).run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS cash_shift_movements (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_id        INTEGER NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
          source_table    TEXT NOT NULL DEFAULT 'manual',
          source_id       INTEGER,
          direction       TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
          payment_method  TEXT NOT NULL DEFAULT 'cash',
          amount          REAL NOT NULL DEFAULT 0,
          reference       TEXT NOT NULL DEFAULT '',
          label           TEXT NOT NULL DEFAULT '',
          created_by      TEXT NOT NULL DEFAULT '',
          occurred_at     TEXT NOT NULL
        )`,
      )
      .run();
    await db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_cash_shift_movements_shift ON cash_shift_movements(shift_id, occurred_at)`)
      .run();
  });
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  card: 'Carte bancaire',
  transfer: 'Virement',
  check: 'Chèque',
  other: 'Autre',
};

function normMethod(raw: unknown): string {
  const m = String(raw || 'cash').trim().toLowerCase();
  if (m === 'especes' || m === 'espèces' || m === 'cash') return 'cash';
  if (m === 'carte' || m === 'card' || m === 'tpe') return 'card';
  if (m === 'virement' || m === 'transfer' || m === 'bank') return 'transfer';
  if (m === 'cheque' || m === 'chèque' || m === 'check') return 'check';
  return m || 'other';
}

function sumDenominations(denominations: Record<string, unknown>): number {
  let total = 0;
  for (const [k, v] of Object.entries(denominations || {})) {
    const face = Number(k);
    const count = Number(v);
    if (Number.isFinite(face) && face > 0 && Number.isFinite(count) && count >= 0) {
      total += face * count;
    }
  }
  return round2(total);
}

interface ShiftMovementRow {
  source_table: string;
  source_id: number | null;
  direction: 'in' | 'out';
  payment_method: string;
  amount: number;
  reference: string;
  label: string;
  created_by: string;
  occurred_at: string;
}

async function gatherShiftWindowMovements(
  db: D1Database,
  shift: { id: number; opened_at: string; closed_at: string | null },
): Promise<ShiftMovementRow[]> {
  const endTs = shift.closed_at || new Date().toISOString();
  const explicitRes = await db
    .prepare(
      `SELECT source_table, source_id, direction, payment_method, amount, reference, label, created_by, occurred_at
       FROM cash_shift_movements WHERE shift_id = ? ORDER BY occurred_at ASC, id ASC`,
    )
    .bind(shift.id)
    .all();
  const explicit = ((explicitRes.results || []) as any[]).map((r) => ({
    source_table: String(r.source_table || 'manual'),
    source_id: r.source_id != null ? Number(r.source_id) : null,
    direction: (r.direction === 'out' ? 'out' : 'in') as 'in' | 'out',
    payment_method: normMethod(r.payment_method),
    amount: round2(Number(r.amount || 0)),
    reference: String(r.reference || ''),
    label: String(r.label || ''),
    created_by: String(r.created_by || ''),
    occurred_at: String(r.occurred_at || ''),
  }));

  const linkedKeys = new Set(
    explicit.filter((m) => m.source_id != null).map((m) => `${m.source_table}:${m.source_id}`),
  );

  // Pull window expenses (income/expense) if the expenses table exists
  try {
    const fromDate = String(shift.opened_at).slice(0, 10);
    const toDate = String(endTs).slice(0, 10);
    const expRes = await db
      .prepare(
        `SELECT id, entry_type, amount, payment_method, reference, description, expense_date, created_at
         FROM expenses
         WHERE COALESCE(expense_date, substr(created_at, 1, 10)) >= ?
           AND COALESCE(expense_date, substr(created_at, 1, 10)) <= ?
           AND COALESCE(entry_type, 'expense') IN ('income', 'expense')
         ORDER BY id ASC`,
      )
      .bind(fromDate, toDate)
      .all();
    for (const e of (expRes.results || []) as any[]) {
      const key = `expenses:${Number(e.id)}`;
      if (linkedKeys.has(key)) continue;
      const createdIso = String(e.created_at || `${e.expense_date}T00:00:00Z`);
      if (e.created_at && (createdIso < shift.opened_at || createdIso > endTs)) continue;
      const amt = round2(Math.abs(Number(e.amount || 0)));
      if (amt <= 0) continue;
      explicit.push({
        source_table: 'expenses',
        source_id: Number(e.id),
        direction: e.entry_type === 'income' ? 'in' : 'out',
        payment_method: normMethod(e.payment_method),
        amount: amt,
        reference: String(e.reference || ''),
        label: String(e.description || ''),
        created_by: '',
        occurred_at: createdIso,
      });
    }
  } catch {
    /* expenses table optional in minimal test harnesses */
  }

  return explicit;
}

interface MethodSummary {
  method: string;
  label: string;
  in_total: number;
  out_total: number;
  net_total: number;
  expected: number;
  counted: number | null;
  variance: number | null;
}

function summarizeByMethod(
  openingFloat: number,
  movements: ShiftMovementRow[],
  countedByMethod?: Record<string, number> | null,
  cashCountedTotal?: number | null,
): { expectedCash: number; totalExpectedAll: number; methods: Record<string, MethodSummary> } {
  const methods: Record<string, MethodSummary> = {
    cash: {
      method: 'cash',
      label: METHOD_LABELS.cash,
      in_total: 0,
      out_total: 0,
      net_total: 0,
      expected: round2(openingFloat),
      counted: null,
      variance: null,
    },
  };

  for (const m of movements) {
    const key = normMethod(m.payment_method);
    if (!methods[key]) {
      methods[key] = {
        method: key,
        label: METHOD_LABELS[key] || key,
        in_total: 0,
        out_total: 0,
        net_total: 0,
        expected: 0,
        counted: null,
        variance: null,
      };
    }
    if (m.direction === 'in') methods[key].in_total = round2(methods[key].in_total + m.amount);
    else methods[key].out_total = round2(methods[key].out_total + m.amount);
  }

  let totalExpectedAll = 0;
  for (const [k, s] of Object.entries(methods)) {
    s.net_total = round2(s.in_total - s.out_total);
    s.expected = round2((k === 'cash' ? openingFloat : 0) + s.net_total);
    totalExpectedAll = round2(totalExpectedAll + s.expected);
    if (k === 'cash' && cashCountedTotal != null) {
      s.counted = round2(cashCountedTotal);
      s.variance = round2(s.counted - s.expected);
    } else if (countedByMethod && countedByMethod[k] != null) {
      s.counted = round2(Number(countedByMethod[k]));
      s.variance = round2(s.counted - s.expected);
    }
  }

  return {
    expectedCash: methods.cash.expected,
    totalExpectedAll,
    methods,
  };
}

function renderShiftHtmlReport(
  reportKind: 'X' | 'Z',
  shift: any,
  summary: { expectedCash: number; totalExpectedAll: number; methods: Record<string, MethodSummary> },
  movements: ShiftMovementRow[],
  company: string,
  footer: string,
  reportShell: CashShiftRouteDeps['reportShell'],
): string {
  const fmt = (n: number | null | undefined) =>
    n == null ? '—' : `${round2(Number(n)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;

  let denoms: Record<string, number> = {};
  try {
    denoms = JSON.parse(String(shift.denominations || '{}')) || {};
  } catch {
    denoms = {};
  }
  const denomRows = Object.entries(denoms)
    .filter(([, cnt]) => Number(cnt) > 0)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(
      ([face, cnt]) =>
        `<tr><td>${escapeHtml(face)} DH</td><td class="num">${Number(cnt)}</td><td class="num">${fmt(Number(face) * Number(cnt))}</td></tr>`,
    )
    .join('');

  const methodRows = Object.values(summary.methods)
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.label)}</td>
        <td class="num">${fmt(m.in_total)}</td>
        <td class="num">${fmt(m.out_total)}</td>
        <td class="num">${fmt(m.expected)}</td>
        <td class="num">${fmt(m.counted)}</td>
        <td class="num">${fmt(m.variance)}</td>
      </tr>`,
    )
    .join('');

  const moveRows = movements
    .slice(0, 100)
    .map(
      (m) => `<tr>
        <td>${escapeHtml(String(m.occurred_at).slice(0, 19).replace('T', ' '))}</td>
        <td>${m.direction === 'in' ? 'Entrée' : 'Sortie'}</td>
        <td>${escapeHtml(METHOD_LABELS[m.payment_method] || m.payment_method)}</td>
        <td>${escapeHtml(m.reference || m.label || '—')}</td>
        <td class="num">${fmt(m.amount)}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:16px">
      <div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px">
        <div style="font-size:11px;color:#52525b">Caisse</div>
        <strong>${escapeHtml(shift.till_id)}</strong>
      </div>
      <div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px">
        <div style="font-size:11px;color:#52525b">Opérateur</div>
        <strong>${escapeHtml(shift.operator)}</strong>
      </div>
      <div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px">
        <div style="font-size:11px;color:#52525b">Fond d'ouverture</div>
        <strong>${fmt(shift.opening_float)}</strong>
      </div>
      <div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px">
        <div style="font-size:11px;color:#52525b">Attendu espèces</div>
        <strong>${fmt(shift.status === 'closed' && shift.expected_amount != null ? shift.expected_amount : summary.expectedCash)}</strong>
      </div>
      ${
        reportKind === 'Z'
          ? `<div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px">
              <div style="font-size:11px;color:#52525b">Compté espèces</div>
              <strong>${fmt(shift.counted_amount)}</strong>
            </div>
            <div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px">
              <div style="font-size:11px;color:#52525b">Écart</div>
              <strong>${fmt(shift.variance)}</strong>
            </div>`
          : ''
      }
    </div>
    <p style="font-size:12px;color:#52525b;margin:0 0 14px">
      Ouverture : ${escapeHtml(String(shift.opened_at).replace('T', ' ').slice(0, 19))}
      ${shift.closed_at ? ` · Clôture : ${escapeHtml(String(shift.closed_at).replace('T', ' ').slice(0, 19))}` : ' · Session en cours'}
      ${shift.closed_by ? ` · Clôturée par ${escapeHtml(shift.closed_by)}` : ''}
    </p>

    <h3 style="margin:14px 0 8px;font-size:14px">Synthèse par moyen de paiement</h3>
    <table>
      <thead>
        <tr>
          <th>Moyen</th>
          <th class="num">Entrées</th>
          <th class="num">Sorties</th>
          <th class="num">Attendu</th>
          <th class="num">Compté</th>
          <th class="num">Écart</th>
        </tr>
      </thead>
      <tbody>${methodRows}</tbody>
    </table>

    ${
      denomRows
        ? `<h3 style="margin:18px 0 8px;font-size:14px">Détail des coupures (espèces)</h3>
           <table>
             <thead><tr><th>Coupure</th><th class="num">Nombre</th><th class="num">Total</th></tr></thead>
             <tbody>${denomRows}</tbody>
           </table>`
        : ''
    }

    <h3 style="margin:18px 0 8px;font-size:14px">Mouvements (${movements.length})</h3>
    <table>
      <thead><tr><th>Date/Heure</th><th>Sens</th><th>Mode</th><th>Libellé / Réf.</th><th class="num">Montant</th></tr></thead>
      <tbody>${moveRows || '<tr><td colspan="5">Aucun mouvement enregistré.</td></tr>'}</tbody>
    </table>
    ${shift.notes ? `<p style="margin-top:14px;font-size:12px"><strong>Observations :</strong> ${escapeHtml(shift.notes)}</p>` : ''}
  `;

  const title = reportKind === 'Z' ? `Rapport Z — Clôture #${shift.id}` : `Rapport X — Mi-session #${shift.id}`;
  const period = `${shift.till_id} · ${String(shift.opened_at).slice(0, 10)}`;
  return reportShell(title, company, period, body, footer, '/cash-shifts');
}

export function registerCashShiftRoutes(app: AtlasApp, deps: CashShiftRouteDeps): void {
  const { sessionUserFromHeader, writeAudit, reportShell } = deps;

  function requireShiftUser(c: any): { ok: true; username: string; role: string } | { ok: false; response: Response } {
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    const role = normalizeRole(sess?.role);
    if (!sess?.username || !(role === 'owner' || role === 'admin' || role === 'secretaire' || role === 'user')) {
      return {
        ok: false,
        response: c.json({ success: false, error: 'Accès refusé.', code: 'FORBIDDEN_ROLE', role }, 403),
      };
    }
    return { ok: true, username: sess.username, role };
  }

  function requireOwnerOrAdmin(c: any): { ok: true; username: string; role: string } | { ok: false; response: Response } {
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    const role = normalizeRole(sess?.role);
    if (!sess?.username || (role !== 'owner' && role !== 'admin')) {
      return {
        ok: false,
        response: c.json(
          { success: false, error: 'Réservé au propriétaire ou administrateur.', code: 'OWNER_OR_ADMIN_ONLY', role },
          403,
        ),
      };
    }
    return { ok: true, username: sess.username, role };
  }

  app.get('/api/cash-shifts', async (c) => {
    const gate = requireShiftUser(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const tillId = String(c.req.query('till_id') || '').trim();
    const status = String(c.req.query('status') || '').trim();
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
    const clauses: string[] = [];
    const binds: any[] = [];
    if (tillId) {
      clauses.push('till_id = ?');
      binds.push(tillId);
    }
    if (status === 'open' || status === 'closed') {
      clauses.push('status = ?');
      binds.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await c.env.DB.prepare(
      `SELECT * FROM cash_shifts ${where} ORDER BY opened_at DESC, id DESC LIMIT ?`,
    )
      .bind(...binds, limit)
      .all();
    return c.json({ success: true, data: res.results || [] });
  });

  app.post('/api/cash-shifts/open', async (c) => {
    const gate = requireShiftUser(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const tillId = String(body.till_id || 'CAISSE-1').trim().slice(0, 64) || 'CAISSE-1';
    const openingFloat = round2(Number(body.opening_float ?? 0));
    if (!Number.isFinite(openingFloat) || openingFloat < 0) {
      return c.json({ success: false, error: 'Fond de caisse invalide (≥ 0 requis).', code: 'INVALID_FLOAT' }, 400);
    }
    const notes = String(body.notes || '').slice(0, 500);
    const nowIso = new Date().toISOString();

    const existingOpen = await c.env.DB.prepare(
      `SELECT id, operator, opened_at FROM cash_shifts WHERE till_id = ? AND status = 'open'`,
    )
      .bind(tillId)
      .first();
    if (existingOpen) {
      return c.json(
        {
          success: false,
          code: 'SHIFT_ALREADY_OPEN',
          error: `Une session est déjà ouverte sur ${tillId}.`,
          data: existingOpen,
        },
        409,
      );
    }

    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO cash_shifts (till_id, operator, opened_at, opening_float, status, notes)
         VALUES (?, ?, ?, ?, 'open', ?)`,
      )
        .bind(tillId, gate.username, nowIso, openingFloat, notes)
        .run();
      const shiftId = Number(ins.meta?.last_row_id || 0);
      await writeAudit(c.env.DB, {
        username: gate.username,
        role: gate.role,
        action: 'cash_shift.open',
        entity: 'cash_shifts',
        entity_id: String(shiftId),
        detail: `${tillId} float=${openingFloat}`,
      });
      const created = await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(shiftId).first();
      return c.json({ success: true, data: created }, 201);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/unique/i.test(msg)) {
        return c.json(
          { success: false, code: 'SHIFT_ALREADY_OPEN', error: `Une session est déjà ouverte sur ${tillId}.` },
          409,
        );
      }
      throw e;
    }
  });

  app.get('/api/cash-shifts/:id', async (c) => {
    const gate = requireShiftUser(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const id = Number(c.req.param('id'));
    const shift = (await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(id).first()) as any;
    if (!shift) return c.json({ success: false, error: 'Session de caisse introuvable.', code: 'NOT_FOUND' }, 404);
    const movements = await gatherShiftWindowMovements(c.env.DB, shift);
    let savedMethods: any = null;
    try {
      const parsed = JSON.parse(String(shift.by_method_json || '{}'));
      if (parsed && Object.keys(parsed).length) savedMethods = parsed;
    } catch {
      savedMethods = null;
    }
    const summary = summarizeByMethod(Number(shift.opening_float || 0), movements, null, shift.counted_amount);
    return c.json({
      success: true,
      data: {
        ...shift,
        movements,
        summary: {
          ...summary,
          methods: savedMethods || summary.methods,
        },
      },
    });
  });

  app.post('/api/cash-shifts/:id/movements', async (c) => {
    const gate = requireShiftUser(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const id = Number(c.req.param('id'));
    const shift = (await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(id).first()) as any;
    if (!shift) return c.json({ success: false, error: 'Session de caisse introuvable.', code: 'NOT_FOUND' }, 404);
    if (shift.status !== 'open') {
      return c.json({ success: false, error: 'Session déjà clôturée.', code: 'SHIFT_CLOSED' }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const direction = body.direction === 'out' ? 'out' : 'in';
    const method = normMethod(body.payment_method || 'cash');
    const amount = round2(Number(body.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ success: false, error: 'Montant invalide (> 0 requis).', code: 'INVALID_AMOUNT' }, 400);
    }
    const sourceTable = String(body.source_table || 'manual').slice(0, 40);
    const sourceId = body.source_id != null && Number.isFinite(Number(body.source_id)) ? Number(body.source_id) : null;
    const reference = String(body.reference || '').slice(0, 120);
    const label = String(body.label || (direction === 'in' ? 'Apport caisse' : 'Retrait caisse')).slice(0, 200);
    const occurredAt = String(body.occurred_at || new Date().toISOString()).slice(0, 64);

    const res = await c.env.DB.prepare(
      `INSERT INTO cash_shift_movements (shift_id, source_table, source_id, direction, payment_method, amount, reference, label, created_by, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, sourceTable, sourceId, direction, method, amount, reference, label, gate.username, occurredAt)
      .run();

    return c.json({
      success: true,
      data: {
        id: Number(res.meta?.last_row_id || 0),
        shift_id: id,
        direction,
        payment_method: method,
        amount,
        reference,
        label,
        occurred_at: occurredAt,
      },
    }, 201);
  });

  app.post('/api/cash-shifts/:id/close', async (c) => {
    const gate = requireOwnerOrAdmin(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const id = Number(c.req.param('id'));
    const shift = (await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(id).first()) as any;
    if (!shift) return c.json({ success: false, error: 'Session de caisse introuvable.', code: 'NOT_FOUND' }, 404);
    if (shift.status !== 'open') {
      return c.json({ success: false, error: 'Session déjà clôturée.', code: 'SHIFT_ALREADY_CLOSED' }, 409);
    }

    const body = await c.req.json().catch(() => ({}));
    const denominations = body.denominations && typeof body.denominations === 'object' ? body.denominations : {};
    const denomSum = sumDenominations(denominations);
    const hasDenoms = Object.keys(denominations).length > 0 && denomSum > 0;
    const countedRaw = body.counted_amount != null ? Number(body.counted_amount) : denomSum;
    if (!Number.isFinite(countedRaw) || countedRaw < 0) {
      return c.json({ success: false, error: 'Montant compté invalide.', code: 'INVALID_COUNTED' }, 400);
    }
    const countedAmount = round2(body.counted_amount != null ? countedRaw : hasDenoms ? denomSum : countedRaw);
    const countedByMethod = body.counted_by_method && typeof body.counted_by_method === 'object'
      ? (body.counted_by_method as Record<string, number>)
      : null;
    const notes = String(body.notes || '').slice(0, 1000);
    const closedAt = new Date().toISOString();

    const movements = await gatherShiftWindowMovements(c.env.DB, { ...shift, closed_at: closedAt });
    const summary = summarizeByMethod(Number(shift.opening_float || 0), movements, countedByMethod, countedAmount);
    const expectedAmount = summary.expectedCash;
    const variance = round2(countedAmount - expectedAmount);

    // Snapshot any auto-discovered window movements (e.g. expenses) into cash_shift_movements
    const stmts: D1PreparedStatement[] = [];
    const existingExplicit = await c.env.DB.prepare(
      `SELECT source_table, source_id FROM cash_shift_movements WHERE shift_id = ? AND source_id IS NOT NULL`,
    )
      .bind(id)
      .all();
    const alreadyLinked = new Set(
      ((existingExplicit.results || []) as any[]).map((r) => `${r.source_table}:${r.source_id}`),
    );
    for (const m of movements) {
      if (m.source_id != null && !alreadyLinked.has(`${m.source_table}:${m.source_id}`)) {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO cash_shift_movements (shift_id, source_table, source_id, direction, payment_method, amount, reference, label, created_by, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(id, m.source_table, m.source_id, m.direction, m.payment_method, m.amount, m.reference, m.label, m.created_by, m.occurred_at),
        );
      }
    }

    stmts.push(
      c.env.DB.prepare(
        `UPDATE cash_shifts
         SET status = 'closed',
             closed_at = ?,
             counted_amount = ?,
             expected_amount = ?,
             variance = ?,
             denominations = ?,
             by_method_json = ?,
             notes = ?,
             closed_by = ?
         WHERE id = ? AND status = 'open'`,
      ).bind(
        closedAt,
        countedAmount,
        expectedAmount,
        variance,
        JSON.stringify(denominations),
        JSON.stringify(summary.methods),
        notes,
        gate.username,
        id,
      ),
    );

    await c.env.DB.batch(stmts);
    await writeAudit(c.env.DB, {
      username: gate.username,
      role: gate.role,
      action: 'cash_shift.close',
      entity: 'cash_shifts',
      entity_id: String(id),
      detail: `till=${shift.till_id} expected=${expectedAmount} counted=${countedAmount} variance=${variance}`,
    });

    const updated = await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(id).first();
    return c.json({
      success: true,
      data: {
        ...updated,
        summary,
        movements,
      },
    });
  });

  app.get('/api/cash-shifts/:id/x-report', async (c) => {
    const gate = requireShiftUser(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const id = Number(c.req.param('id'));
    const shift = (await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(id).first()) as any;
    if (!shift) return c.json({ success: false, error: 'Session de caisse introuvable.', code: 'NOT_FOUND' }, 404);

    const movements = await gatherShiftWindowMovements(c.env.DB, shift);
    const summary = summarizeByMethod(Number(shift.opening_float || 0), movements, null, shift.counted_amount);
    const settings = (await c.env.DB.prepare(`SELECT company_name, report_footer, notes FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;
    const html = renderShiftHtmlReport(
      'X',
      shift,
      summary,
      movements,
      settings?.company_name || 'Atlas Commerce',
      settings?.report_footer || settings?.notes || '',
      reportShell,
    );
    return c.html(html);
  });

  app.get('/api/cash-shifts/:id/z-report', async (c) => {
    const gate = requireOwnerOrAdmin(c);
    if (!gate.ok) return gate.response;
    await ensureCashShiftSchema(c.env.DB);
    const id = Number(c.req.param('id'));
    const shift = (await c.env.DB.prepare(`SELECT * FROM cash_shifts WHERE id = ?`).bind(id).first()) as any;
    if (!shift) return c.json({ success: false, error: 'Session de caisse introuvable.', code: 'NOT_FOUND' }, 404);
    if (shift.status !== 'closed') {
      return c.json({ success: false, error: 'Le rapport Z nécessite une session clôturée (utilisez le rapport X en cours de session).', code: 'SHIFT_NOT_CLOSED' }, 409);
    }

    const movements = await gatherShiftWindowMovements(c.env.DB, shift);
    const summary = summarizeByMethod(Number(shift.opening_float || 0), movements, null, shift.counted_amount);
    try {
      const saved = JSON.parse(String(shift.by_method_json || '{}'));
      if (saved && Object.keys(saved).length) summary.methods = saved;
    } catch { /* fallback to recomputed */ }

    if (c.req.query('reprint') === '1') {
      await writeAudit(c.env.DB, {
        username: gate.username,
        role: gate.role,
        action: 'cash_shift.z_reprint',
        entity: 'cash_shifts',
        entity_id: String(id),
        detail: `till=${shift.till_id}`,
      });
    }

    const settings = (await c.env.DB.prepare(`SELECT company_name, report_footer, notes FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;
    const html = renderShiftHtmlReport(
      'Z',
      shift,
      summary,
      movements,
      settings?.company_name || 'Atlas Commerce',
      settings?.report_footer || settings?.notes || '',
      reportShell,
    );
    return c.html(html);
  });
}
