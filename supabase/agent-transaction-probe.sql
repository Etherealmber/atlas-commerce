-- Reversible SQL-only verification of Agent RPC behavior in this project.
-- This creates temporary synthetic records inside ONE transaction and rolls it
-- back. It does not call the global expire/claim functions, access R2, deploy
-- a Worker, or use real account identifiers, messages or encryption keys.
-- It does NOT verify PostgREST, Cloudflare connectivity, or encryption.
-- Success with no result rows means all assertions passed and ROLLBACK ran.
-- If any statement errors, do not proceed; inspect the SQL error. The database
-- transaction must be rolled back (a closed SQL-editor connection rolls it back).

begin;
do $$
declare
  a text := 'probe-' || pg_catalog.gen_random_uuid()::text;
  b text := 'probe-' || pg_catalog.gen_random_uuid()::text;
  t text := 'probe-thread';
  r jsonb;
begin
  r := public.atlas_agent_put(a, t, 'synthetic-ciphertext', null, 'synthetic-summary');
  if r is distinct from '{"ok":true,"version":"1"}'::jsonb then raise exception 'create assertion failed'; end if;
  if public.atlas_agent_get(b, t) is not null then raise exception 'account isolation assertion failed'; end if;
  if (public.atlas_agent_get(a, t)->>'payload') is distinct from 'synthetic-ciphertext' then raise exception 'get assertion failed'; end if;
  if jsonb_array_length(public.atlas_agent_list(a, 20)) <> 1 then raise exception 'list assertion failed'; end if;
  r := public.atlas_agent_put(a, t, 'synthetic-update', '1', 'synthetic-summary');
  if r is distinct from '{"ok":true,"version":"2"}'::jsonb then raise exception 'update assertion failed'; end if;
  if (public.atlas_agent_put(a, t, 'stale', '1', 'synthetic-summary')->>'conflict') is distinct from 'true' then raise exception 'CAS assertion failed'; end if;
  r := public.atlas_agent_transcript_put(a, t, 'synthetic-transcript', null);
  if r is distinct from '{"ok":true,"version":"1"}'::jsonb then raise exception 'transcript write assertion failed'; end if;
  if (public.atlas_agent_transcript_get(a, t)->>'payload') is distinct from 'synthetic-transcript' then raise exception 'transcript read assertion failed'; end if;
  if (public.atlas_agent_tombstone(a, t)->>'ok') is distinct from 'true' then raise exception 'delete assertion failed'; end if;
  if public.atlas_agent_get(a, t) is not null or public.atlas_agent_transcript_get(a, t) is not null then raise exception 'tombstone visibility assertion failed'; end if;
  if (public.atlas_agent_put(a, t, 'recreate', null, 'synthetic-summary')->>'conflict') is distinct from 'true' then raise exception 'resurrection assertion failed'; end if;
end $$;
rollback;
