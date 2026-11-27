import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { registerDocPreviewRoutes } from '../routes/docPreviews';

describe('document previews', () => {
  it('uses fictional data for every type and never reads transactions or creates report links', async () => {
    const app = new Hono<any>();
    const queries: string[] = [];
    const calls: any[] = [];
    const template = (...args: any[]) => { calls.push(args); return '<html><head></head><body>template</body></html>'; };
    const deps: any = { requireEmployeeAdmin: vi.fn(async () => null), generateInvoiceHTML: template, generateReceiptHTML: template, generateEmployeeFormHTML: template, reportShell: template, previewEmbed: (s: string) => s, mintPreviewReportTicket: vi.fn(() => { throw new Error('must not mint'); }) };
    registerDocPreviewRoutes(app, deps);
    const env = { DB: { prepare: (sql: string) => { queries.push(sql); return { first: async () => ({ company_name: 'Test', tax_rate: 20 }) }; } } };
    for (const type of ['invoice', 'quote', 'bill', 'credit', 'receipt', 'employee', 'report', 'delivery']) {
      const response = await app.request(`/api/settings/invoice-preview?type=${type}&qr_situation=1`, {}, env);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('APERÇU DÉMO');
    }
    expect(queries).toHaveLength(8);
    expect(queries.every(query => query.includes('company_settings'))).toBe(true);
    expect(deps.mintPreviewReportTicket).not.toHaveBeenCalled();
    expect(JSON.stringify(calls)).toContain('Client Démo');
    expect(JSON.stringify(calls)).toContain('SITUATION DÉMO');
    expect(deps.requireEmployeeAdmin).toHaveBeenCalledTimes(2);
  });
  it('preserves report and employee authorization', async () => {
    const app = new Hono<any>();
    registerDocPreviewRoutes(app, { requireEmployeeAdmin: async () => new Response('Denied', { status: 403 }) } as any);
    for (const type of ['report', 'employee']) expect((await app.request(`/api/settings/invoice-preview?type=${type}`)).status).toBe(403);
  });
});
