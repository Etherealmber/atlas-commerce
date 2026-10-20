/**
 * Products controller — HTTP boundary only.
 */
import type { Context } from 'hono';
import type { Env } from '../env';
import { runController, rejectValidation } from './base';
import * as productsService from '../services/productsService';

export function listProductsController(c: Context<{ Bindings: Env }>) {
  return runController(c, async () => {
    const data = await productsService.listProductsSafe(c.env, {
      q: c.req.query('q') || undefined,
      limit: c.req.query('limit') || undefined,
      offset: c.req.query('offset') || undefined,
    });
    return { ok: true, data };
  });
}

export function getProductController(c: Context<{ Bindings: Env }>) {
  return runController(c, async () => {
    const data = await productsService.getProductSafe(c.env, c.req.param('id'));
    return { ok: true, data };
  });
}
