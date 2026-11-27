import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('cleans orphan invoice notes and cascades new deletions without removing standalone notes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY);
    CREATE TABLE delivery_notes (id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, invoice_id INTEGER, client_name TEXT DEFAULT '', issue_date TEXT, notes TEXT DEFAULT '', status TEXT DEFAULT 'draft', created_at TEXT);
    CREATE TABLE delivery_note_items (id INTEGER PRIMARY KEY, delivery_note_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT, quantity REAL NOT NULL, unit TEXT DEFAULT 'u');
    INSERT INTO invoices VALUES (1);
    INSERT INTO delivery_notes (id,number,invoice_id) VALUES (1,'linked',1),(2,'orphan',99),(3,'standalone',NULL);
    INSERT INTO delivery_note_items (id,delivery_note_id,quantity) VALUES (1,1,1),(2,2,1),(3,3,1);`);
  db.exec(readFileSync('migrations/0024_delivery_note_cleanup.sql', 'utf8'));
  expect(db.prepare('SELECT id FROM delivery_notes ORDER BY id').all().map(x => x.id)).toEqual([1,3]);
  expect(db.prepare('SELECT id FROM delivery_note_items ORDER BY id').all().map(x => x.id)).toEqual([1,3]);
  db.exec('DELETE FROM invoices WHERE id = 1');
  expect(db.prepare('SELECT id FROM delivery_notes').all().map(x => x.id)).toEqual([3]);
  expect(db.prepare('SELECT id FROM delivery_note_items').all().map(x => x.id)).toEqual([3]);
  db.close();
});
