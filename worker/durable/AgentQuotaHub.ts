import type { Env } from '../env';

/**
 * AgentQuotaHub — per-user Atlas Agent token counters (day / week) stored in a
 * Durable Object so usage survives deploys, restarts and edge replay.
 * One instance per user: idFromName('agent-quota:' + username).
 * Writes happen only on /add (after a reply) and on rollover/seeding.
 */
export type QuotaCounters = {
  dailyUsed: number;
  weeklyUsed: number;
  dailyDate: string;
  weeklyStart: string;
  initialized: boolean;
};

const KEYS = ['daily_tokens', 'daily_date', 'weekly_tokens', 'weekly_start', 'initialized'] as const;

export class AgentQuotaHub {
  constructor(
    private readonly state: DurableObjectState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly env: Env,
  ) {}

  static today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  static weekStart(): string {
    const d = new Date();
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }

  private async read(): Promise<QuotaCounters> {
    const bag = await this.state.storage.get([...KEYS]);
    return {
      dailyUsed: Number(bag.get('daily_tokens') ?? 0),
      weeklyUsed: Number(bag.get('weekly_tokens') ?? 0),
      dailyDate: String(bag.get('daily_date') ?? ''),
      weeklyStart: String(bag.get('weekly_start') ?? ''),
      initialized: bag.get('initialized') === 1 || bag.get('initialized') === true,
    };
  }

  private async write(q: QuotaCounters): Promise<void> {
    await this.state.storage.put({
      daily_tokens: q.dailyUsed,
      daily_date: q.dailyDate,
      weekly_tokens: q.weeklyUsed,
      weekly_start: q.weeklyStart,
      initialized: q.initialized ? 1 : 0,
    });
  }

  private roll(q: QuotaCounters): { q: QuotaCounters; changed: boolean } {
    const today = AgentQuotaHub.today();
    const week = AgentQuotaHub.weekStart();
    let changed = false;
    if (q.dailyDate !== today) { q.dailyUsed = 0; q.dailyDate = today; changed = true; }
    if (q.weeklyStart !== week) { q.weeklyUsed = 0; q.weeklyStart = week; changed = true; }
    return { q, changed };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let q = (await this.read());
    const rolled = this.roll(q);
    q = rolled.q;
    let dirty = rolled.changed;

    if (request.method === 'POST' && url.pathname === '/add') {
      const body = (await request.json().catch(() => ({}))) as { tokens?: number };
      const tokens = Math.max(0, Math.min(200000, Number(body.tokens) || 0));
      q.dailyUsed += tokens;
      q.weeklyUsed += tokens;
      q.initialized = true;
      dirty = true;
    } else if (request.method === 'POST' && url.pathname === '/seed') {
      // One-time migration from the legacy D1 agent_controls counters.
      const body = (await request.json().catch(() => ({}))) as {
        daily?: number; weekly?: number; dailyDate?: string; weeklyStart?: string;
      };
      if (!q.initialized) {
        if (typeof body.daily === 'number' && body.daily > 0) { q.dailyUsed = body.daily; q.dailyDate = body.dailyDate || AgentQuotaHub.today(); }
        if (typeof body.weekly === 'number' && body.weekly > 0) { q.weeklyUsed = body.weekly; q.weeklyStart = body.weeklyStart || AgentQuotaHub.weekStart(); }
        q.initialized = true;
        dirty = true;
      }
    }

    if (dirty) await this.write(q);
    return Response.json({
      success: true,
      data: { dailyUsed: q.dailyUsed, weeklyUsed: q.weeklyUsed, dailyDate: q.dailyDate, weeklyStart: q.weeklyStart, initialized: q.initialized },
    });
  }
}

export default AgentQuotaHub;
