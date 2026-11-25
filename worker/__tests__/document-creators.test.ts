/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { creatorsForDocuments, withLedgerCreators, withMovementCreators } from '../lib/documentCreators';

function makeSqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
    return {
      params: [] as any[],
      bind(...params: any[]) { this.params = params; return this; },
      async first() {
        const row = sqlite.prepare(sql).get(...this.params);
        return row === undefined ? null : { ...(row as any) };
      },
      async all() {
        return { success: true, results: sqlite.prepare(sql).all(...this.params).map((r: any) => ({ ...r })), meta: {} };
      },
      async run() {
        const info = sqlite.prepare(sql).run(...this.params);
        return { success: true, meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) } };
      },
    };
  }
  return { prepare } as unknown as D1Database;
}

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, number TEXT, created_by TEXT);
    CREATE TABLE receipts (id INTEGER PRIMARY KEY, number TEXT, invoice_id INTEGER);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, number TEXT);
    CREATE TABLE stock_movements (id INTEGER PRIMARY KEY, reference TEXT, created_by TEXT);
    INSERT INTO invoices (id, number, created_by) VALUES (1, 'FA-0001', 'amina'), (2, 'VR-0002', 'youssef');
    INSERT INTO receipts (id, number, invoice_id) VALUES (1, 'RC-0001', 1);
    INSERT INTO stock_movements (id, reference, created_by) VALUES (1, 'FA-0099', 'karim'), (2, 'FA-0099', '');
  `);
  return makeSqliteD1(sqlite);
}

describe('document creators', () => {
  it('resolves creators by document number and by invoice id (receipts inherit their invoice)', async () => {
    const db = setup();
    const { byNumber, byInvoiceId } = await creatorsForDocuments(db, ['FA-0001', 'RC-0001', 'XX-1'], [2]);
    expect(byNumber.get('FA-0001')).toBe('amina');
    expect(byNumber.get('RC-0001')).toBe('amina');
    expect(byNumber.has('XX-1')).toBe(false);
    expect(byInvoiceId.get(2)).toBe('youssef');
  });

  it('ledger transactions from an invoice or quick sale carry the same creator', async () => {
    const db = setup();
    const rows = await withLedgerCreators(db, [
      { id: 1, reference: 'FA-0001', notes: '' },
      { id: 2, reference: '', notes: 'invoice_id:2|paiement' },
      { id: 3, reference: 'FA-0001', notes: '', created_by: 'manual-user' },
      { id: 4, reference: 'NOPE', notes: '' },
    ]);
    expect(rows.map((r) => r.created_by)).toEqual(['amina', 'youssef', 'manual-user', null]);
  });

  it('stock movements inherit the document creator, or a sibling movement of a deleted document', async () => {
    const db = setup();
    const rows = await withMovementCreators(db, [
      { id: 10, reference: 'VR-0002', created_by: '' },
      { id: 11, reference: 'FA-0099', created_by: null },
      { id: 12, reference: 'FA-0001', created_by: 'samir' },
    ]);
    expect(rows.map((r) => r.created_by)).toEqual(['youssef', 'karim', 'samir']);
  });
});
