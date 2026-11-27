import type { Env } from '../env';

export class JournalConfigurationError extends Error {
  constructor() { super('Journal configuration unavailable'); }
}

export class JournalServiceError extends Error {
  constructor(readonly status: number) { super('Journal service unavailable'); }
}

/** Server-side only. Never log keys, request bodies, or upstream response bodies. */
export function supabaseJournalConfig(env: Pick<Env, 'SUPABASE_JOURNAL_URL' | 'SUPABASE_JOURNAL_SECRET' | 'SUPABASE_JOURNAL_SECRET_KEY'>) {
  let url: URL;
  try { url = new URL(String(env.SUPABASE_JOURNAL_URL || '')); } catch { throw new JournalConfigurationError(); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new JournalConfigurationError();
  const key = String(env.SUPABASE_JOURNAL_SECRET_KEY || env.SUPABASE_JOURNAL_SECRET || '').trim();
  if (!key) throw new JournalConfigurationError();
  return { base: url.origin, key };
}
export async function journalRpc(env: Env, name: 'atlas_journal_ingest' | 'atlas_journal_ingest_batch' | 'atlas_journal_page', body: object): Promise<any> {
  const { base, key } = supabaseJournalConfig(env);
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  // Opaque sb_secret keys are sent only in apikey. Legacy service-role JWTs
  // require the bearer header as well.
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new JournalServiceError(res.status);
  return res.json();
}
