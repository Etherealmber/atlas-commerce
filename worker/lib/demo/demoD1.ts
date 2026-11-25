/**
 * D1Database look-alike that forwards every statement to the demo sandbox
 * (a SQLite Durable Object). The rest of the Worker keeps using
 * `c.env.DB.prepare(...).bind(...).all()` unchanged.
 */
import { decodeResult, encodeValue, rowsToObjects, type StatementResult, type WireStatement } from './sqlEngine';

export type DemoTransport = (op: 'query' | 'batch' | 'exec', payload: unknown) => Promise<unknown>;

export class DemoExpiredError extends Error {
  code = 'DEMO_EXPIRED';
  constructor() {
    super('DEMO_EXPIRED: la session de démo est terminée');
  }
}

function d1Error(msg: string): Error {
  const clean = String(msg || 'Erreur SQL').replace(/^D1_ERROR:\s*/, '');
  return new Error(`D1_ERROR: ${clean}`);
}

function d1Result(r: StatementResult) {
  return {
    success: true as const,
    results: rowsToObjects(r),
    meta: { ...r.meta },
  };
}

export class DemoPreparedStatement {
  constructor(
    private readonly db: DemoD1,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): DemoPreparedStatement {
    return new DemoPreparedStatement(this.db, this.sql, values);
  }

  /** Wire form used by `batch()`. */
  toWire(): WireStatement {
    return { sql: this.sql, params: this.params.map(encodeValue) };
  }

  private exec(): Promise<StatementResult> {
    return this.db.queryOne(this.toWire());
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const r = await this.exec();
    const row = rowsToObjects(r)[0];
    if (!row) return null;
    if (column) return (column in row ? (row[column] as T) : null);
    return row as T;
  }

  async all<T = Record<string, unknown>>() {
    const r = await this.exec();
    return d1Result(r) as unknown as { success: true; results: T[]; meta: StatementResult['meta'] };
  }

  async run<T = Record<string, unknown>>() {
    return this.all<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const r = await this.exec();
    const rows = r.rows as unknown as T[];
    return options?.columnNames ? [r.columns as unknown as T, ...rows] : rows;
  }
}

export class DemoD1 {
  /** Identifies the sandbox generation this binding talks to. */
  readonly demoKey: string;

  constructor(private readonly transport: DemoTransport, demoKey: string) {
    this.demoKey = demoKey;
  }

  prepare(sql: string): DemoPreparedStatement {
    return new DemoPreparedStatement(this, sql);
  }

  async queryOne(stmt: WireStatement): Promise<StatementResult> {
    const res = (await this.transport('query', stmt)) as { ok?: boolean; result?: StatementResult; error?: string; expired?: boolean };
    if (res?.expired) throw new DemoExpiredError();
    if (!res?.ok || !res.result) throw d1Error(res?.error || 'Erreur SQL');
    return decodeResult(res.result);
  }

  async batch(statements: DemoPreparedStatement[]) {
    if (!statements.length) return [];
    const res = (await this.transport('batch', { statements: statements.map((s) => s.toWire()) })) as {
      ok?: boolean; results?: StatementResult[]; error?: string; expired?: boolean;
    };
    if (res?.expired) throw new DemoExpiredError();
    if (!res?.ok || !res.results) throw d1Error(res?.error || 'Erreur SQL');
    return res.results.map((r) => d1Result(decodeResult(r)));
  }

  async exec(sql: string) {
    const res = (await this.transport('exec', { sql })) as { ok?: boolean; count?: number; error?: string; expired?: boolean };
    if (res?.expired) throw new DemoExpiredError();
    if (!res?.ok) throw d1Error(res?.error || 'Erreur SQL');
    return { count: Number(res.count || 0), duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    throw d1Error('dump() indisponible en mode démo');
  }
}

export function isDemoD1(db: unknown): db is DemoD1 {
  return db instanceof DemoD1;
}
