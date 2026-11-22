import { expect, it } from 'vitest';
import { dualStockLabel } from '../lib/dualUnit';
it('derives square metres from cartons without changing the primary quantity', () => {
  const product = { unit:'carton', secondary_unit:'m²', secondary_unit_factor:1.59, stock_quantity:6 };
  expect(dualStockLabel(product)).toBe('6 carton · 9,54 m²');
  expect(product.stock_quantity).toBe(6);
  expect(dualStockLabel(product, 2)).toBe('2 carton · 3,18 m²');
});
it('keeps legacy or invalid conversions single-unit', () => {
  expect(dualStockLabel({ unit:'m²', stock_quantity:3 })).toBe('3 m²');
  expect(dualStockLabel({ unit:'carton', secondary_unit:'m²', secondary_unit_factor:0, stock_quantity:6 })).toBe('6 carton');
});
