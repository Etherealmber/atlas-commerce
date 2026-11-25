/**
 * Atlas Agent quota policy — normalised so a partial or malformed
 * `/api/agent/policy` payload never renders « NaN% du quota jour ».
 */
export interface AgentPolicy {
  blocked: boolean;
  isAdmin: boolean;
  dailyUsed: number;
  weeklyUsed: number;
  dailyLimit: number;
  weeklyLimit: number;
  dailyResetsAt?: string;
  weeklyResetsAt?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function normalizeAgentPolicy(raw: unknown): AgentPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    blocked: r.blocked === true,
    isAdmin: r.isAdmin === true,
    dailyUsed: num(r.dailyUsed),
    weeklyUsed: num(r.weeklyUsed),
    dailyLimit: num(r.dailyLimit),
    weeklyLimit: num(r.weeklyLimit),
    dailyResetsAt: typeof r.dailyResetsAt === 'string' ? r.dailyResetsAt : undefined,
    weeklyResetsAt: typeof r.weeklyResetsAt === 'string' ? r.weeklyResetsAt : undefined,
  };
}

/** 0–100 usage percentage, or null when the limit is unknown (row is hidden). */
export function quotaPercent(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

/** True when a known limit is reached. Unknown limits never lock the UI. */
export function quotaReached(used: number, limit: number): boolean {
  return limit > 0 && used >= limit;
}
