-- DRAFT ONLY: not applied by Atlas; review and validate in isolated staging.
-- Requires agent-preparation.sql. Does not schedule cleanup, store images,
-- migrate R2 or enable a production cutover. Run only with explicit approval.
-- Every account_id is supplied by the trusted Worker, NEVER by a browser.

begin;

alter table public.atlas_agent_conversations add column if not exists deleted_at timestamptz;
alter table public.atlas_agent_conversations add column if not exists encrypted_summary text;

create or replace function public.atlas_agent_get(p_account text, p_thread text)
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select jsonb_build_object('payload', encrypted_payload, 'version', revision::text,
    'last_activity_at', last_activity_at)
  from public.atlas_agent_conversations
  where account_id = p_account and thread_id = p_thread and deleted_at is null
    and last_activity_at > now() - interval '30 days';
$$;

-- Lightweight bounded history discovery: only encrypted summaries, never message bodies.
-- No physical retention cleanup is performed by this read.
create or replace function public.atlas_agent_list(p_account text, p_limit integer default 20)
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', thread_id, 'updated_at', last_activity_at, 'encrypted_summary', encrypted_summary)
    order by last_activity_at desc, thread_id desc), '[]'::jsonb)
  from (
    select thread_id, last_activity_at, encrypted_summary from public.atlas_agent_conversations
    where account_id = p_account and deleted_at is null
      and last_activity_at > now() - interval '30 days'
    order by last_activity_at desc, thread_id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 40)
  ) rows;
$$;

-- A null base version means create-only. Existing, expired, or deleted IDs
-- cannot be silently recreated. All updates are compare-and-swap.
drop function if exists public.atlas_agent_put(text,text,text,text);
create or replace function public.atlas_agent_put(p_account text, p_thread text, p_payload text, p_expected_version text, p_summary text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare new_revision bigint;
begin
  if p_account is null or length(p_account) not between 1 and 200 or p_thread is null or length(p_thread) not between 1 and 80
     or p_payload is null or length(p_payload) not between 1 and 2100000 or p_summary is null or length(p_summary) not between 1 and 4096 then raise exception 'invalid input'; end if;
  if p_expected_version is null then
    insert into public.atlas_agent_conversations(account_id, thread_id, encrypted_payload, encrypted_summary)
      values(p_account, p_thread, p_payload, p_summary) on conflict do nothing returning revision into new_revision;
  else
    -- Compare text rather than casting untrusted values to bigint.
    update public.atlas_agent_conversations set encrypted_payload = p_payload, encrypted_summary = p_summary,
      revision = revision + 1, last_activity_at = now()
      where account_id = p_account and thread_id = p_thread and deleted_at is null
        and last_activity_at > now() - interval '30 days' and revision::text = p_expected_version
      returning revision into new_revision;
  end if;
  if new_revision is null then return jsonb_build_object('ok', false, 'conflict', true); end if;
  return jsonb_build_object('ok', true, 'version', new_revision::text);
end $$;

-- Retain a tombstone so stale requests cannot recreate deleted conversations.
-- Does not yet delete R2 images and MUST NOT be exposed as complete deletion.
create or replace function public.atlas_agent_tombstone(p_account text, p_thread text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_account is null or length(p_account) not between 1 and 200 or p_thread is null or length(p_thread) not between 1 and 80 then raise exception 'invalid input'; end if;
  insert into public.atlas_agent_conversations(account_id, thread_id, encrypted_payload, deleted_at)
    values(p_account, p_thread, '', now())
  on conflict (account_id, thread_id) do update set encrypted_payload = '', encrypted_summary = null, deleted_at = coalesce(atlas_agent_conversations.deleted_at, now()), revision = atlas_agent_conversations.revision + 1;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.atlas_agent_list(text,integer) from public, anon, authenticated;
revoke all on function public.atlas_agent_get(text,text) from public, anon, authenticated;
revoke all on function public.atlas_agent_put(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.atlas_agent_tombstone(text,text) from public, anon, authenticated;
grant execute on function public.atlas_agent_list(text,integer) to service_role;
grant execute on function public.atlas_agent_get(text,text) to service_role;
grant execute on function public.atlas_agent_put(text,text,text,text,text) to service_role;
grant execute on function public.atlas_agent_tombstone(text,text) to service_role;

commit;
