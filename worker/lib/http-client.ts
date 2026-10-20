/**
 * External HTTP calls with mandatory timeout + optional retries.
 * Prefer this over raw fetch() for any third-party API.
 *
 * Compatible with fetch(url, init) — pass RequestInit as the 2nd argument,
 * or HttpClientOptions ({ timeoutMs, retries, init }).
 */

export type HttpClientOptions = {
  timeoutMs?: number;
  retries?: number;
  retryOn?: number[];
  label?: string;
  init?: RequestInit;
} & RequestInit;

const DEFAULT_TIMEOUT = 12_000;
const DEFAULT_RETRIES = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeOpts(opts: HttpClientOptions = {}): {
  timeoutMs: number;
  retries: number;
  retryOn: number[];
  label: string;
  init: RequestInit;
} {
  const { timeoutMs, retries, retryOn, label, init, ...rest } = opts as any;

  const hasFetchFields =
    rest.method != null ||
    rest.headers != null ||
    rest.body != null ||
    rest.signal != null ||
    rest.credentials != null ||
    rest.cache != null ||
    rest.redirect != null ||
    rest.mode != null;

  const requestInit: RequestInit = {
    ...(init || {}),
    ...(hasFetchFields ? rest : {}),
  };

  return {
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT,
    retries: retries ?? DEFAULT_RETRIES,
    retryOn: retryOn ?? [502, 503, 504],
    label: label || 'upstream',
    init: requestInit,
  };
}

/** fetch() with AbortSignal timeout. Drop-in for fetch(url, init). */
export async function fetchWithTimeout(
  url: string,
  opts: HttpClientOptions = {},
): Promise<Response> {
  const { timeoutMs, retries, retryOn, label, init } = normalizeOpts(opts);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      if (init.signal) {
        const parent = init.signal;
        if (parent.aborted) ac.abort();
        else parent.addEventListener('abort', () => ac.abort(), { once: true });
      }
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(timer);
      if (retryOn.includes(res.status) && attempt < retries) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const aborted =
        e instanceof Error && (e.name === 'AbortError' || /aborted|timeout/i.test(e.message));
      if (aborted && attempt >= retries) {
        const { AppError } = await import('./errors');
        throw new AppError('TIMEOUT', `Délai dépassé (${label})`);
      }
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`HTTP failed: ${label}`);
}

export async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  opts: HttpClientOptions = {},
): Promise<T> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) {
    const { AppError } = await import('./errors');
    throw new AppError(
      res.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'BAD_REQUEST',
      `Service distant indisponible (${res.status})`,
    );
  }
  return (await res.json()) as T;
}
