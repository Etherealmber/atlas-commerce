import { addColumnIfMissing } from './schema';

/** Optional metadata, added lazily as in 0008; old rows remain unknown. */
export async function ensureProductActors(db: D1Database): Promise<void> {
  await addColumnIfMissing(db, 'products', 'created_by', 'TEXT DEFAULT NULL');
  await addColumnIfMissing(db, 'products', 'approved_by', 'TEXT DEFAULT NULL');
}

export async function ensureMovementApprover(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
    type TEXT DEFAULT '', quantity REAL DEFAULT 0, previous_quantity REAL DEFAULT 0,
    new_quantity REAL DEFAULT 0, reason TEXT DEFAULT '', reference TEXT DEFAULT '',
    created_by TEXT DEFAULT '', approved_by TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await addColumnIfMissing(db, 'stock_movements', 'created_by', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'stock_movements', 'approved_by', 'TEXT DEFAULT NULL');
}

const actorName = (v: unknown) => typeof v === 'string' && v.trim() ? v : null;

/** Do not invent identities for old rows or workflows without approval. */
export function withInventoryActors<T extends Record<string, any>>(row: T): T & { created_by: string | null; approved_by: string | null } {
  return { ...row, created_by: actorName(row.created_by), approved_by: actorName(row.approved_by) };
}
