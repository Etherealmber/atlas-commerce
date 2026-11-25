/**
 * Minimal D1-compatible SQL engine used by the demo sandbox.
 *
 * The demo database lives in a SQLite-backed Durable Object (DemoHub). This
 * module turns `{ sql, params, mode }` requests into D1-shaped results on top
 * of any synchronous SQLite backend: `ctx.storage.sql` in production, and
 * `node:sqlite` in the unit tests. Keeping it backend-agnostic lets the tests
 * exercise exactly the code the Durable Object runs.
 */

export type SqlValue = string | number | null | ArrayBuffer;

export interface SqlBackend {
  /** Execute ONE statement; returns column names and rows as arrays. */
  run(sql: string, params: SqlValue[]): { columns: string[]; rows: SqlValue[][] };
  /** Atomic block: rolls back every write if `fn` throws. */
  transaction<T>(fn: () => T): T;
}

export type QueryMode = 'all' | 'first' | 'run' | 'raw';

export interface WireStatement {
  sql: string;
  params?: unknown[];
}

export interface StatementResult {
  columns: string[];
  rows: SqlValue[][];
  meta: {
    changes: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
    duration: number;
    changed_db: boolean;
    size_after: number;
    served_by: string;
  };
}

/** D1 accepts booleans/undefined loosely in practice; normalise like it does. */
export function normaliseParam(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v && '__b64' in (v as Record<string, unknown>)) {
    return b64ToBuffer(String((v as Record<string, unknown>).__b64));
  }
  return String(v);
}

const READ_ONLY_RE = /^\s*(?:select|pragma|explain|values)\b/i;

function isReadOnly(sql: string): boolean {
  return READ_ONLY_RE.test(stripLeadingComments(sql));
}

function stripLeadingComments(sql: string): string {
  let s = sql;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n');
      s = nl < 0 ? '' : t.slice(nl + 1);
      continue;
    }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      s = end < 0 ? '' : t.slice(end + 2);
      continue;
    }
    return t;
  }
}

function scalar(backend: SqlBackend, sql: string): number {
  try {
    const r = backend.run(sql, []);
    return Number(r.rows[0]?.[0] ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Run one statement and collect D1-style metadata. */
export function runStatement(backend: SqlBackend, sql: string, rawParams: unknown[] = []): StatementResult {
  const params = rawParams.map(normaliseParam);
  const started = Date.now();
  const readOnly = isReadOnly(sql);
  const before = readOnly ? 0 : scalar(backend, 'SELECT total_changes()');
  const { columns, rows } = backend.run(sql, params);
  let changes = 0;
  let lastRowId = 0;
  if (!readOnly) {
    changes = Math.max(0, scalar(backend, 'SELECT total_changes()') - before);
    lastRowId = scalar(backend, 'SELECT last_insert_rowid()');
  }
  return {
    columns,
    rows,
    meta: {
      changes,
      last_row_id: lastRowId,
      rows_read: rows.length,
      rows_written: changes,
      duration: Date.now() - started,
      changed_db: changes > 0,
      size_after: 0,
      served_by: 'atlas-demo',
    },
  };
}

/** D1 batch semantics: every statement in one transaction, all-or-nothing. */
export function runBatch(backend: SqlBackend, statements: WireStatement[]): StatementResult[] {
  return backend.transaction(() => statements.map((s) => runStatement(backend, s.sql, s.params || [])));
}

/**
 * Split a SQL script into statements (quotes, comments and trigger bodies
 * aware). Used for `db.exec()` and for applying the bundled migrations.
 */
export function splitSqlStatements(script: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let depthBeginEnd = 0;
  const n = script.length;
  while (i < n) {
    const ch = script[i];
    const next = script[i + 1];
    if (ch === '-' && next === '-') {
      const nl = script.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      cur += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = script.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      cur += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < n) {
        if (script[j] === close) {
          if (close !== ']' && script[j + 1] === close) { j += 2; continue; }
          break;
        }
        j++;
      }
      cur += script.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(script[i - 1]))) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(script.slice(i, i + 32));
      const word = m ? m[0] : ch;
      const upper = word.toUpperCase();
      if (upper === 'BEGIN' && /\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(cur)) depthBeginEnd++;
      else if (upper === 'END' && depthBeginEnd > 0) depthBeginEnd--;
      cur += word;
      i += word.length;
      continue;
    }
    if (ch === ';' && depthBeginEnd === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Statements the sandbox refuses (transaction control is implicit, like D1). */
const FORBIDDEN_RE = /^\s*(?:begin|commit|end|rollback|savepoint|release|attach|detach|vacuum)\b/i;

export function execScript(backend: SqlBackend, script: string, opts: { tolerant?: boolean } = {}): { count: number; errors: string[] } {
  const errors: string[] = [];
  let count = 0;
  for (const stmt of splitSqlStatements(script)) {
    if (FORBIDDEN_RE.test(stmt)) continue;
    try {
      backend.run(stmt, []);
      count++;
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (!opts.tolerant) throw e;
      if (!/duplicate column|already exists/i.test(msg)) errors.push(msg.slice(0, 200));
    }
  }
  return { count, errors };
}

/* ── wire encoding (JSON-safe blobs) ───────────────────────────────────── */

export function bufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64ToBuffer(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export function encodeValue(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { __b64: bufferToB64(v) };
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    return { __b64: bufferToB64(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer) };
  }
  return v;
}

export function decodeValue(v: unknown): unknown {
  if (v && typeof v === 'object' && '__b64' in (v as Record<string, unknown>)) {
    return b64ToBuffer(String((v as Record<string, unknown>).__b64));
  }
  return v;
}

export function encodeResult(r: StatementResult): StatementResult {
  return { ...r, rows: r.rows.map((row) => row.map(encodeValue) as SqlValue[]) };
}

export function decodeResult(r: StatementResult): StatementResult {
  return { ...r, rows: r.rows.map((row) => row.map(decodeValue) as SqlValue[]) };
}

/** Rows as objects (D1 `.all()` / `.first()` shape; duplicate names → last wins). */
export function rowsToObjects(r: StatementResult): Record<string, unknown>[] {
  return r.rows.map((row) => {
    const o: Record<string, unknown> = {};
    r.columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}
