import type { Env } from '../env';

export type RestoreJobState = {
  id: string;
  status: string;
  message?: string;
  progress?: number;
  safety_key?: string | null;
  source_key?: string;
  error?: string;
  started_at?: string;
  finished_at?: string;
  tables?: string[];
  rows?: number;
  /** R2 key of decrypted work payload JSON */
  work_key?: string | null;
  /** Next table index to process */
  table_index?: number;
  /** Ordered table names */
  table_order?: string[];
  /** Cancel requested */
  cancel?: boolean;
};

const BATCH = 40;

function tableLabelFr(table: string): string {
  const map: Record<string, string> = {
    products: 'Produits',
    clients: 'Clients',
    vendors: 'Fournisseurs',
    invoices: 'Factures',
    invoice_items: 'Lignes de facture',
    quotes: 'Devis',
    bills: 'Achats',
    bill_items: 'Lignes d’achat',
    product_units: 'Unités produit',
    product_categories: 'Catégories produit',
    product_catalog: 'Catalogue',
    categories: 'Catégories',
    units: 'Unités',
    audit_log: 'Journal d’audit',
    expenses: 'Dépenses',
    app_config: 'Configuration',
    company_settings: 'Société',
    stock_locations: 'Entrepôts',
    stock_movements: 'Mouvements de stock',
  };
  return map[table] || table;
}

/**
 * Durable Object that owns restore progress AND drives one-table-at-a-time execution
 * via alarms so large backups never blow a single Worker waitUntil/CPU budget.
 */
export class RestoreHub {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async putJob(job: RestoreJobState): Promise<void> {
    await this.state.storage.put('job', job);
    if (job.id) await this.state.storage.put('latest_id', job.id);
    try {
      const cache = (this.env as any).CACHE;
      if (cache && job.id) {
        await cache.put(`restore_job:${job.id}`, JSON.stringify(job), { expirationTtl: 3600 * 6 });
        await cache.put('restore_job:latest', job.id, { expirationTtl: 3600 * 6 });
      }
    } catch { /* */ }
  }

  private async getJob(): Promise<RestoreJobState | null> {
    return (await this.state.storage.get<RestoreJobState>('job')) || null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/' || path === '/status')) {
      const job = await this.getJob();
      return Response.json({ success: true, data: job });
    }

    // Bootstrap: store job + schedule first table
    if ((request.method === 'PUT' || request.method === 'POST') && (path === '/' || path === '/job' || path === '/start')) {
      const body = (await request.json()) as RestoreJobState & { start?: boolean };
      if (!body?.id) {
        return Response.json({ success: false, error: 'id required' }, { status: 400 });
      }
      const prev = (await this.getJob()) || ({} as RestoreJobState);
      const next: RestoreJobState = { ...prev, ...body, cancel: false };
      await this.putJob(next);
      if (body.start || path === '/start') {
        // Process first table inline so UI leaves 20% immediately, then alarm for the rest
        try {
          await this.alarm();
        } catch {
          await this.state.storage.setAlarm(Date.now() + 100);
        }
      }
      return Response.json({ success: true, data: await this.getJob() });
    }

    // Force cancel
    if (request.method === 'POST' && path === '/cancel') {
      const job = await this.getJob();
      if (job) {
        const finished = new Date().toISOString();
        const failed: RestoreJobState = {
          ...job,
          status: 'failed',
          message: 'Restauration annulée',
          error: 'CANCELLED',
          progress: 100,
          finished_at: finished,
          cancel: true,
        };
        await this.putJob(failed);
        try { await this.state.storage.deleteAlarm(); } catch { /* */ }
        // Cleanup work payload
        try {
          if (job.work_key && (this.env as any).IMAGES) {
            await (this.env as any).IMAGES.delete(job.work_key);
          }
        } catch { /* */ }
      }
      return Response.json({ success: true });
    }

    if (request.method === 'DELETE') {
      try { await this.state.storage.deleteAlarm(); } catch { /* */ }
      await this.state.storage.delete('job');
      return Response.json({ success: true });
    }

    return Response.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  /** Alarm: process exactly one table, then schedule next. */
  async alarm(): Promise<void> {
    const job = await this.getJob();
    if (!job || job.cancel || job.status === 'ok' || job.status === 'failed') return;
    if (job.status !== 'running' && job.status !== 'pending') return;

    const order = job.table_order || [];
    let index = Number(job.table_index || 0);
    const total = Math.max(1, order.length);
    const db = (this.env as any).DB as D1Database;
    const images = (this.env as any).IMAGES;

    if (!db || !job.work_key || !images) {
      await this.putJob({
        ...job,
        status: 'failed',
        message: 'Environnement restore incomplet (DB/R2)',
        error: 'ENV',
        progress: 100,
        finished_at: new Date().toISOString(),
      });
      return;
    }

    // Load work payload (decrypted tables JSON)
    let payload: any = null;
    try {
      const obj = await images.get(job.work_key);
      if (!obj) throw new Error('work payload missing');
      payload = await obj.json();
    } catch (e: any) {
      await this.putJob({
        ...job,
        status: 'failed',
        message: 'Payload de travail introuvable ou illisible',
        error: String(e?.message || e),
        progress: 100,
        finished_at: new Date().toISOString(),
      });
      return;
    }

    const tables = payload?.tables || {};

    // Done?
    if (index >= order.length) {
      try { await images.delete(job.work_key); } catch { /* */ }
      try {
        // Invalidate caches after full restore
        const cache = (this.env as any).CACHE;
        if (cache) {
          // best-effort: mark mutation
          await cache.put('biz_mutated_at', new Date().toISOString(), { expirationTtl: 86400 });
        }
      } catch { /* */ }
      await this.putJob({
        ...job,
        status: 'ok',
        message: `Terminé — ${(job.tables?.length || order.length)} tables, ${job.rows || 0} lignes`,
        progress: 100,
        finished_at: new Date().toISOString(),
        work_key: null,
      });
      return;
    }

    const table = order[index];
    const data = Array.isArray(tables[table]) ? (tables[table] as any[]) : [];
    const label = tableLabelFr(table);
    const basePct = Math.min(92, Math.round(18 + ((index + 1) / total) * 74));
    let rows = Number(job.rows || 0);
    const restoredTables = [...(job.tables || [])];

    await this.putJob({
      ...job,
      status: 'running',
      message: `Restauration « ${label} » (${index + 1}/${total})…`,
      progress: basePct,
      table_index: index,
    });

    if (!data.length) {
      // skip empty
      index += 1;
      await this.putJob({
        ...job,
        table_index: index,
        message: `« ${label} » vide — suivant…`,
        progress: basePct,
        rows,
      });
      await this.state.storage.setAlarm(Date.now() + 30);
      return;
    }

    const sample = data[0];
    if (!sample || typeof sample !== 'object') {
      index += 1;
      await this.putJob({ ...job, table_index: index, rows });
      await this.state.storage.setAlarm(Date.now() + 30);
      return;
    }

    const cols = Object.keys(sample);
    let tableRows = 0;

    try {
      try {
        await db.prepare(`DELETE FROM ${table}`).run();
      } catch {
        // table missing — skip
        index += 1;
        await this.putJob({
          ...job,
          table_index: index,
          message: `« ${label} » ignoré (table absente)`,
          progress: basePct,
          rows,
        });
        await this.state.storage.setAlarm(Date.now() + 30);
        return;
      }

      const placeholders = cols.map(() => '?').join(',');
      const colList = cols.join(', ');
      const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;

      for (let i = 0; i < data.length; i += BATCH) {
        // Re-check cancel between batches
        const live = await this.getJob();
        if (live?.cancel) return;

        const chunk = data.slice(i, i + BATCH);
        const stmts: D1PreparedStatement[] = [];
        for (const row of chunk) {
          try {
            const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
            stmts.push(db.prepare(sql).bind(...vals));
          } catch { /* skip */ }
        }
        if (stmts.length) {
          try {
            await db.batch(stmts);
            tableRows += stmts.length;
            rows += stmts.length;
          } catch {
            for (const row of chunk) {
              try {
                const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
                await db.prepare(sql).bind(...vals).run();
                tableRows++;
                rows++;
              } catch { /* skip bad row */ }
            }
          }
        }

        // Mid-table progress for large tables
        if (data.length > BATCH * 2 && i + BATCH < data.length) {
          const frac = (i + BATCH) / data.length;
          await this.putJob({
            ...job,
            status: 'running',
            table_index: index,
            rows,
            message: `Restauration « ${label} »… ${Math.min(data.length, i + BATCH)}/${data.length}`,
            progress: Math.min(94, basePct + Math.round(frac * 3)),
          });
        }
      }

      restoredTables.push(table);
      index += 1;
      await this.putJob({
        ...job,
        status: 'running',
        table_index: index,
        tables: restoredTables,
        rows,
        message: `« ${label} » restauré (${tableRows} lignes)`,
        progress: Math.min(96, basePct + 2),
      });
    } catch (e: any) {
      // Table failed — continue with next
      index += 1;
      await this.putJob({
        ...job,
        table_index: index,
        rows,
        message: `« ${label} » erreur partielle — suite…`,
        progress: basePct,
      });
    }

    // Schedule next table (or finalization)
    await this.state.storage.setAlarm(Date.now() + 40);
  }
}
