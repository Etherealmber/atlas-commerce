/**
 * v0.7.1 — Unit tests for the server-side inventory-privacy policy and the
 * device-label helper (worker/lib/inventory-policy.ts). Pure functions: no
 * D1/Hono needed.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeInventoryRole,
  roleCanSeeFinancial,
  roleCanSeeSellPrices,
  roleCanApproveStockAdjustment,
  roleCanSubmitStockAdjustmentRequest,
  roleCanDirectAdjustStock,
  scrubProductForRole,
  deviceLabelFromUA,
} from '../lib/inventory-policy';

const ROW = {
  id: 7,
  name: 'Carrelage grès cérame 60×60',
  sku: 'CR-6060',
  barcode: '610000000001',
  stock_quantity: 42,
  low_stock_threshold: 5,
  track_inventory: 1,
  price: 89,
  unit_price: 89,
  cost: 61,
  cost_price: 61,
  stock_value: 2562,
};

describe('inventory privacy — scrub matrix', () => {
  it('owner/admin keep every field (financial access)', () => {
    for (const role of ['owner', 'admin']) {
      const out = scrubProductForRole(ROW, role) as any;
      expect(out.price).toBe(89);
      expect(out.cost).toBe(61);
      expect(out.stock_value).toBe(2562);
      expect(out.stock_quantity).toBe(42);
    }
  });

  it('secretaire keeps selling prices but never costs/valuation', () => {
    const out = scrubProductForRole(ROW, 'secretaire') as any;
    expect(out.price).toBe(89);
    expect(out.unit_price).toBe(89);
    expect(out.cost).toBeUndefined();
    expect(out.cost_price).toBeUndefined();
    expect(out.stock_value).toBeUndefined();
    expect(out.stock_quantity).toBe(42);
  });

  it('stock (magasinier) and user (operator) get operational basics only', () => {
    for (const role of ['stock', 'user']) {
      const out = scrubProductForRole(ROW, role) as any;
      expect(out.price).toBeUndefined();
      expect(out.unit_price).toBeUndefined();
      expect(out.cost).toBeUndefined();
      expect(out.cost_price).toBeUndefined();
      expect(out.stock_value).toBeUndefined();
      // operational basics survive
      expect(out.id).toBe(7);
      expect(out.name).toBe(ROW.name);
      expect(out.sku).toBe('CR-6060');
      expect(out.stock_quantity).toBe(42);
      expect(out.low_stock_threshold).toBe(5);
    }
  });

  it('unknown/empty roles fall back to the strictest profile', () => {
    for (const role of ['', 'hacker', undefined as any]) {
      const out = scrubProductForRole(ROW, role) as any;
      expect(out.price).toBeUndefined();
      expect(out.cost).toBeUndefined();
      expect(normalizeInventoryRole(role)).toBe('user');
    }
  });

  it('scrub never mutates the source row', () => {
    const copy = { ...ROW };
    scrubProductForRole(ROW, 'stock');
    expect(ROW).toEqual(copy);
  });
});

describe('inventory privacy — role gates', () => {
  it('financial access = owner/admin only', () => {
    expect(roleCanSeeFinancial('owner')).toBe(true);
    expect(roleCanSeeFinancial('admin')).toBe(true);
    expect(roleCanSeeFinancial('secretaire')).toBe(false);
    expect(roleCanSeeFinancial('stock')).toBe(false);
    expect(roleCanSeeFinancial('user')).toBe(false);
  });

  it('selling prices = owner/admin/secretaire', () => {
    expect(roleCanSeeSellPrices('secretaire')).toBe(true);
    expect(roleCanSeeSellPrices('stock')).toBe(false);
    expect(roleCanSeeSellPrices('user')).toBe(false);
  });

  it('approval = owner/admin/secretaire; submission = everyone authenticated', () => {
    expect(roleCanApproveStockAdjustment('secretaire')).toBe(true);
    expect(roleCanApproveStockAdjustment('stock')).toBe(false);
    expect(roleCanApproveStockAdjustment('user')).toBe(false);
    for (const r of ['owner', 'admin', 'secretaire', 'stock', 'user']) {
      expect(roleCanSubmitStockAdjustmentRequest(r)).toBe(true);
    }
  });

  it('direct stock mutation = owner/admin/secretaire (stock/user → approval flow)', () => {
    expect(roleCanDirectAdjustStock('owner')).toBe(true);
    expect(roleCanDirectAdjustStock('admin')).toBe(true);
    expect(roleCanDirectAdjustStock('secretaire')).toBe(true);
    expect(roleCanDirectAdjustStock('stock')).toBe(false);
    expect(roleCanDirectAdjustStock('user')).toBe(false);
  });
});

describe('device labels (devices modal shows names, not fingerprint hex)', () => {
  it('Android app UA → model + Android version', () => {
    expect(deviceLabelFromUA('Atlas-Android/1.2.3 (Android 14; PGEM10)')).toBe(
      'Atlas Android 1.2.3 · PGEM10 (Android 14)',
    );
  });
  it('Windows Chrome UA → browser + OS', () => {
    const label = deviceLabelFromUA(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    );
    expect(label).toContain('Chrome');
    expect(label).toContain('Windows 10/11');
    expect(label).not.toContain('Mozilla');
  });
  it('iPhone Safari UA → device + iOS version', () => {
    const label = deviceLabelFromUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
    );
    expect(label).toContain('iPhone');
    expect(label).toContain('iOS 18.7');
  });
  it('empty UA → generic label, never an empty string', () => {
    expect(deviceLabelFromUA('')).toBe('Appareil');
  });
});
