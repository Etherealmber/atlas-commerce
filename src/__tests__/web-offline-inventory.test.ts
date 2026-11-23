import { describe, expect, it } from 'vitest';
import { classifyOfflineOpError } from '../lib/offlineInventoryClient';

describe('Part 3 — web offline inventory error classification & conflict handling', () => {
  it('classifies 409 COUNT_CONFLICT as a visible conflict (never retryable)', () => {
    const outcome = classifyOfflineOpError({
      status: 409,
      code: 'COUNT_CONFLICT',
      message: 'Conflit de révision',
      body: {
        code: 'COUNT_CONFLICT',
        current_quantity: 17,
        current_revision: 4,
        product_total: 22,
      },
    });
    expect(outcome).toEqual({
      kind: 'conflict',
      current_quantity: 17,
      current_revision: 4,
      product_total: 22,
      message: 'Conflit de révision',
    });
  });

  it('classifies other 4xx errors as terminal (not retried) and 5xx/network as retryable', () => {
    const term = classifyOfflineOpError({
      status: 400,
      code: 'QTY_INVALID',
      message: 'Quantité invalide',
    });
    expect(term).toEqual({
      kind: 'terminal_error',
      status: 400,
      code: 'QTY_INVALID',
      message: 'Quantité invalide',
    });

    const retry = classifyOfflineOpError({
      status: 503,
      message: 'Service indisponible',
    });
    expect(retry.kind).toBe('retryable_error');

    const net = classifyOfflineOpError(new Error('Pas de connexion réseau'));
    expect(net.kind).toBe('retryable_error');
  });
});
