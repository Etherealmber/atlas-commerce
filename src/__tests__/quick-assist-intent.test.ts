import { describe, expect, it } from 'vitest';
import { isQuickSaleIntent as matches } from '../../worker/lib/quick-assist-intent';

describe('quick assist sales intent', () => {
  it('preserves the anchored vente and substring vendre/encaisser behavior', () => {
    expect(matches('vente rapide')).toBe(true);
    expect(matches('comment vendre un produit')).toBe(true);
    expect(matches('comment encaisser')).toBe(true);
    expect(matches('avant vente')).toBe(false);
    expect(matches('vente du jour')).toBe(false);
  });
});
