import { describe, expect, it } from 'vitest';
import { phoneStockIsLow, phoneStockThreshold } from '../mobile/phoneStock';

describe('phone inventory threshold', () => {
  it('uses the mobile API threshold, including zero and the equality boundary', () => {
    expect(phoneStockThreshold({ low_stock_threshold: 0, min_stock: 5 })).toBe(0);
    expect(phoneStockIsLow({ stock_quantity: 2, low_stock_threshold: 2, track_inventory: 1 })).toBe(true);
    expect(phoneStockIsLow({ stock_quantity: 3, low_stock_threshold: 2, track_inventory: 1 })).toBe(false);
  });
  it('does not flag products that do not track inventory', () => {
    expect(phoneStockIsLow({ stock_quantity: 0, low_stock_threshold: 5, track_inventory: 0 })).toBe(false);
    expect(phoneStockIsLow({ stock_quantity: 0, low_stock_threshold: 5, track_inventory: false })).toBe(false);
  });
  it('supports older cached product fields', () => {
    expect(phoneStockThreshold({ min_stock: 3 })).toBe(3);
    expect(phoneStockIsLow({ stock: 3, min_stock: 3 })).toBe(true);
    expect(phoneStockThreshold({})).toBe(5);
  });
});
