import { api } from '../api';
import {
  enqueueOfflineInventoryOp,
  flushOfflineInventoryOps,
  isOnline,
  newOperationUuid,
  type OfflineOpSendOutcome,
  type QueuedOfflineInventoryOp,
} from './offlineCatalog';

export function classifyOfflineOpError(err: any): OfflineOpSendOutcome {
  const status = Number(err?.status || 0);
  const code = String(err?.code || err?.body?.code || '');
  const message = String(err?.message || err?.body?.error || 'Erreur lors de la synchronisation.');

  if (status === 409 && code === 'COUNT_CONFLICT') {
    const body = err?.body || {};
    const current_quantity = Number(body.current_quantity ?? body?.data?.current_quantity ?? 0);
    const current_revision = Number(body.current_revision ?? body?.data?.current_revision ?? 0);
    const product_total = body.product_total ?? body?.data?.product_total;
    return {
      kind: 'conflict',
      current_quantity,
      current_revision,
      product_total: product_total !== undefined ? Number(product_total) : undefined,
      message,
    };
  }

  if (status >= 400 && status < 500) {
    return { kind: 'terminal_error', status, code, message };
  }

  return { kind: 'retryable_error', message };
}

async function sendQueuedOpViaApi(op: QueuedOfflineInventoryOp): Promise<OfflineOpSendOutcome> {
  try {
    const res = await api.postOfflineInventoryOp(
      {
        operation_id: op.operation_id,
        kind: op.kind,
        product_id: op.product_id,
        location_id: op.location_id,
        quantity_delta: op.quantity_delta,
        counted_quantity: op.counted_quantity,
        observed_quantity: op.observed_quantity,
        observed_revision: op.observed_revision,
        note: op.note,
        client_occurred_at: op.client_occurred_at,
      },
      op.operation_id,
    );
    return { kind: 'applied', data: (res as any)?.data };
  } catch (err: any) {
    return classifyOfflineOpError(err);
  }
}

export async function executeOrQueueOfflineInventoryOp(input: {
  kind: 'receive' | 'issue' | 'count';
  product_id: number;
  location_id: number;
  quantity_delta?: number;
  counted_quantity?: number;
  observed_quantity?: number;
  observed_revision?: number;
  note?: string;
  product_name?: string;
  location_name?: string;
}): Promise<
  | { state: 'applied'; data: any }
  | { state: 'queued'; operation_id: string }
  | { state: 'conflict'; current_quantity: number; current_revision: number; product_total?: number; message: string }
> {
  const operation_id = newOperationUuid();
  const client_occurred_at = new Date().toISOString();

  if (!isOnline()) {
    await enqueueOfflineInventoryOp({
      ...input,
      operation_id,
      client_occurred_at,
    });
    return { state: 'queued', operation_id };
  }

  try {
    const res = await api.postOfflineInventoryOp(
      {
        operation_id,
        kind: input.kind,
        product_id: input.product_id,
        location_id: input.location_id,
        quantity_delta: input.quantity_delta,
        counted_quantity: input.counted_quantity,
        observed_quantity: input.observed_quantity,
        observed_revision: input.observed_revision,
        note: input.note,
        client_occurred_at,
      },
      operation_id,
    );
    return { state: 'applied', data: (res as any)?.data };
  } catch (err: any) {
    const outcome = classifyOfflineOpError(err);
    if (outcome.kind === 'conflict') {
      return {
        state: 'conflict',
        current_quantity: outcome.current_quantity,
        current_revision: outcome.current_revision,
        product_total: outcome.product_total,
        message: outcome.message,
      };
    }
    if (outcome.kind === 'terminal_error') {
      throw new Error(outcome.message, { cause: err });
    }
    // 5xx or transient network error -> queue in IndexedDB with SAME operation_id for FIFO retry
    await enqueueOfflineInventoryOp({
      ...input,
      operation_id,
      client_occurred_at,
    });
    return { state: 'queued', operation_id };
  }
}

export async function replayOfflineInventoryQueue() {
  return flushOfflineInventoryOps(sendQueuedOpViaApi);
}
