/**
 * v0.7.1 — boot guard: importing worker/index.ts must not throw.
 * Cloudflare's deploy validation EXECUTES the worker init; a missing
 * identifier in a route-module deps object (e.g. previewEmbed) only surfaces
 * there — this test catches the same class of error in CI, before deploy.
 */
import { describe, it, expect } from 'vitest';

describe('worker boot', () => {
  it('worker/index.ts initializes without ReferenceError', async () => {
    const mod: any = await import('../index');
    const app = mod.default?.fetch ? mod.default : mod.app;
    expect(app).toBeTruthy();
    expect(typeof app.fetch).toBe('function');
  });

  it('route modules register without throwing', async () => {
    const { Hono } = await import('hono');
    const { registerDeviceRoutes } = await import('../routes/devices');
    const { registerDocPreviewRoutes } = await import('../routes/docPreviews');
    const { registerStockAdjustmentRoutes } = await import('../routes/stockAdjustments');
    const a: any = new Hono();
    const noop: any = () => {};
    registerStockAdjustmentRoutes(a, { session: () => null });
    registerDeviceRoutes(a, {
      sessionUserFromHeader: () => ({ username: '', role: '' }),
      authFailReason: async () => 'missing',
      clientIp: () => '',
      ensureSecurityTables: async () => {},
      touchTrustedDevice: async () => {},
      deviceLabelFromUA: (u: unknown) => String(u || ''),
      cfGeo: () => ({ city: '', country: '' }),
      writeAudit: async () => {},
    });
    registerDocPreviewRoutes(a, {
      sessionUserFromHeader: () => ({ username: '', role: '' }),
      authFailReason: async () => 'missing',
      generateInvoiceHTML: noop,
      generateReceiptHTML: noop,
      generateEmployeeFormHTML: noop,
      reportShell: noop,
      qrToSvg: noop,
      makeSecureQrPayload: async () => '',
      previewEmbed: (h: string) => h,
    });
    expect(typeof a.fetch).toBe('function');
  });
});
