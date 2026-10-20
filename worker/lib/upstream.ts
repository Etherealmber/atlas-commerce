/**
 * Upstream HTTP resilience for Workers (Groq, GitHub, mail APIs, …).
 * - timeout via AbortSignal
 * - retry with exponential backoff on 429 / 502 / 503 / network errors
 * - circuit breaker per named upstream (no Redis — isolate memory)
 */

import { circuitAllow, circuitFailure, circuitSuccess } from './circuit-breaker';

export type UpstreamOptions = {
  timeoutMs?: number;
  retries?: number;
  retryOn?: number[];
  label?: string;
};

const DEFAULT_RETRY = [429, 502, 503, 504];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function upstreamFetch(
  url: string,
  init: RequestInit = {},
  opts: UpstreamOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const retries = opts.retries ?? 2;
  const retryOn = opts.retryOn ?? DEFAULT_RETRY;
  const label = opts.label || new URL(url).hostname;
  let lastErr: unknown;

  if (!circuitAllow(label)) {
    throw new Error(`Circuit ouvert (${label}) — réessayez dans un instant`);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(timer);
      if (retryOn.includes(res.status) && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 300 * 2 ** attempt;
        await sleep(Math.min(backoff, 5000));
        continue;
      }
      if (res.ok) circuitSuccess(label);
      else if (res.status >= 500 || res.status === 429) circuitFailure(label);
      else circuitSuccess(label);
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      circuitFailure(label);
      throw e;
    }
  }
  circuitFailure(label);
  throw lastErr instanceof Error ? lastErr : new Error('upstream failed');
}
