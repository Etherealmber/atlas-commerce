/** Non-production compatibility experiment. Not exported by the Worker. */
import { Actor } from '@cloudflare/actors';
import type { Env } from '../../worker/env';
import { JournalBuffer as LegacyJournalBuffer } from '../../worker/durable/JournalBuffer';

// The existing class name is deliberately preserved by the local test harness.
// Never deploy this adapter without a separately reviewed cutover plan.
export class JournalBuffer extends Actor<Env> {
  private readonly legacy: LegacyJournalBuffer;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.legacy = new LegacyJournalBuffer(ctx, env);
  }
  // Bypass the Actor's setName-dependent request handler to retain the
  // current /enqueue and /health protocol. Not a typed RPC migration.
  override fetch(request: Request): Promise<Response> { return this.legacy.fetch(request); }
  // Preserve the existing single-alarm protocol. Do NOT use Actor's multi-alarm
  // scheduler on the same instance until their interaction has been designed.
  override alarm(): Promise<void> { return this.legacy.alarm(); }
}
