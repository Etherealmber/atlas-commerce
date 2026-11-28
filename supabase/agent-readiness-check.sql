-- Read-only diagnostics. Run in the SQL Editor of the existing journal project.
-- No conversation text, ciphertext, account IDs, project URL or keys are returned.
-- This does not install RPCs, modify permissions, create records or enable Atlas.
-- All rows should be present, with RLS enabled on tables, no table read or write privileges for
-- API roles, and RPC EXECUTE only for service_role. Other grants/ownership and
-- the Supabase Data API must also be independently reviewed before activation.
with expected(kind, name, signature) as (values
  ('table', 'conversations', 'public.atlas_agent_conversations'),
  ('table', 'transcripts', 'public.atlas_agent_transcripts'),
  ('table', 'cleanup_queue', 'public.atlas_agent_cleanup_queue'),
  ('table', 'upload_intents', 'public.atlas_agent_upload_intents'),
  ('rpc', 'get', 'public.atlas_agent_get(text,text)'),
  ('rpc', 'list', 'public.atlas_agent_list(text,integer)'),
  ('rpc', 'put', 'public.atlas_agent_put(text,text,text,text,text)'),
  ('rpc', 'tombstone', 'public.atlas_agent_tombstone(text,text)'),
  ('rpc', 'transcript_get', 'public.atlas_agent_transcript_get(text,text)'),
  ('rpc', 'transcript_put', 'public.atlas_agent_transcript_put(text,text,text,text)'),
  ('rpc', 'expire', 'public.atlas_agent_expire(integer)'),
  ('rpc', 'cleanup_claim', 'public.atlas_agent_cleanup_claim(text,integer)'),
  ('rpc', 'cleanup_finish', 'public.atlas_agent_cleanup_finish(text,text,text,boolean)'),
  ('rpc', 'upload_begin', 'public.atlas_agent_upload_begin(text,text,text)'),
  ('rpc', 'upload_finish', 'public.atlas_agent_upload_finish(text,text,text,boolean)')
), objects as (
  select *, case when kind = 'table' then to_regclass(signature)::oid else to_regprocedure(signature)::oid end as object_id from expected
)
select o.kind, o.name, o.object_id is not null as present,
  case when o.kind = 'table' then c.relrowsecurity end as rls_enabled,
  case when o.kind = 'rpc' then p.prosecdef end as security_definer,
  case when o.kind = 'rpc' then coalesce(p.proconfig @> array['search_path=pg_catalog'], false) end as restricted_search_path,
  case when o.object_id is null then null when o.kind = 'table' then has_table_privilege('anon', o.object_id, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') else has_function_privilege('anon', o.object_id, 'EXECUTE') end as anon_allowed,
  case when o.object_id is null then null when o.kind = 'table' then has_table_privilege('authenticated', o.object_id, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') else has_function_privilege('authenticated', o.object_id, 'EXECUTE') end as authenticated_allowed,
  case when o.object_id is null then null when o.kind = 'table' then has_table_privilege('service_role', o.object_id, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') else has_function_privilege('service_role', o.object_id, 'EXECUTE') end as service_role_allowed
from objects o left join pg_class c on o.kind = 'table' and c.oid = o.object_id
left join pg_proc p on o.kind = 'rpc' and p.oid = o.object_id
order by o.kind, o.name;
