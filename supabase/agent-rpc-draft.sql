-- DRAFT ONLY: not applied by Atlas; review and validate in isolated staging.
-- Requires agent-preparation.sql. Does not schedule cleanup, store images,
-- migrate R2 or enable a production cutover. Run only with explicit approval.
-- Every account_id is supplied by the trusted Worker, NEVER by a browser.

begin;

alter table public.atlas_agent_conversations add column if not exists deleted_at timestamptz;
alter table public.atlas_agent_conversations add column if not exists encrypted_summary text;

-- Durable cleanup intent, created in the same transaction as the tombstone.
-- No worker or schedule is installed by this draft.
create table if not exists public.atlas_agent_cleanup_queue (
  account_id text not null,
  thread_id text not null,
  enqueued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_token text,
  lease_until timestamptz,
  attempts integer not null default 0,
  primary key (account_id, thread_id),
  foreign key (account_id, thread_id) references public.atlas_agent_conversations(account_id, thread_id)
);
create index if not exists atlas_agent_cleanup_ready on public.atlas_agent_cleanup_queue(next_attempt_at, enqueued_at);
alter table public.atlas_agent_cleanup_queue enable row level security;
revoke all on table public.atlas_agent_cleanup_queue from public, anon, authenticated, service_role;

-- Durable upload intents. Never expire automatically: an R2 PUT with an
-- unknown outcome could still complete after a timeout or Worker crash.
create table if not exists public.atlas_agent_upload_intents (
  account_id text not null,
  thread_id text not null,
  image_id text not null check (image_id ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default now(),
  primary key (account_id, thread_id, image_id),
  foreign key (account_id, thread_id) references public.atlas_agent_conversations(account_id, thread_id)
);
alter table public.atlas_agent_upload_intents enable row level security;
revoke all on table public.atlas_agent_upload_intents from public, anon, authenticated, service_role;

-- Lock the same row as tombstone/expiry to linearize reservation and deletion.
create or replace function public.atlas_agent_upload_begin(p_account text, p_thread text, p_image text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_account is null or p_thread is null or p_image is null or p_image !~ '^[a-f0-9]{32}$' then raise exception 'invalid input'; end if;
  perform 1 from public.atlas_agent_conversations where account_id = p_account and thread_id = p_thread
    and deleted_at is null and last_activity_at > now() - interval '30 days' for update;
  if not found then return false; end if;
  insert into public.atlas_agent_upload_intents(account_id, thread_id, image_id) values(p_account, p_thread, p_image);
  return true;
end $$;

-- On an active conversation, a known-completed PUT may be committed. After a
-- tombstone, only a known-completed PUT followed by confirmed R2 deletion may
-- be released. UNKNOWN PUT outcomes must never call with p_removed=true.
create or replace function public.atlas_agent_upload_finish(p_account text, p_thread text, p_image text, p_removed boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare active boolean; affected integer;
begin
  if p_account is null or p_thread is null or p_image is null or p_image !~ '^[a-f0-9]{32}$' or p_removed is null then raise exception 'invalid input'; end if;
  select deleted_at is null and last_activity_at > now() - interval '30 days' into active
    from public.atlas_agent_conversations where account_id = p_account and thread_id = p_thread for update;
  if not found or (not active and not p_removed) then return false; end if;
  delete from public.atlas_agent_upload_intents where account_id = p_account and thread_id = p_thread and image_id = p_image;
  get diagnostics affected = row_count;
  return affected = 1;
end $$;
revoke all on function public.atlas_agent_upload_begin(text,text,text) from public, anon, authenticated;
revoke all on function public.atlas_agent_upload_finish(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.atlas_agent_upload_begin(text,text,text) to service_role;
grant execute on function public.atlas_agent_upload_finish(text,text,text,boolean) to service_role;

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
  insert into public.atlas_agent_cleanup_queue(account_id, thread_id) values(p_account, p_thread) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Expiry uses row locks so an active conditional update cannot race a sweep.
-- Expired records remain tombstoned; a cleanup worker must remove image objects.
create or replace function public.atlas_agent_expire(p_limit integer default 50)
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  with candidates as (
    select account_id, thread_id from public.atlas_agent_conversations
    where deleted_at is null and last_activity_at <= now() - interval '30 days'
    order by last_activity_at, account_id, thread_id
    for update skip locked limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ), expired as (
    update public.atlas_agent_conversations c
      set encrypted_payload = '', encrypted_summary = null, deleted_at = now(), revision = c.revision + 1
      from candidates x where c.account_id = x.account_id and c.thread_id = x.thread_id
      returning c.account_id, c.thread_id
  ), queued as (
    insert into public.atlas_agent_cleanup_queue(account_id, thread_id)
    select account_id, thread_id from expired on conflict do nothing returning 1
  ) select count(*)::integer into n from queued;
  return n;
end $$;

-- A caller-generated unique token and lease prevents a stale worker from
-- acknowledging another worker's job after its own lease has expired.
create or replace function public.atlas_agent_cleanup_claim(p_token text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare jobs jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32,64}$' then raise exception 'invalid token'; end if;
  with candidates as (
    select account_id, thread_id from public.atlas_agent_cleanup_queue
    where next_attempt_at <= now() and (lease_until is null or lease_until <= now())
    order by next_attempt_at, enqueued_at, account_id, thread_id
    for update skip locked limit least(greatest(coalesce(p_limit, 10), 1), 25)
  ), claimed as (
    update public.atlas_agent_cleanup_queue q
      set lease_token = p_token, lease_until = now() + interval '2 minutes', attempts = attempts + 1
      from candidates x where q.account_id = x.account_id and q.thread_id = x.thread_id
      returning q.account_id, q.thread_id, q.attempts
  ) select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'thread_id', thread_id, 'attempts', attempts)), '[]'::jsonb) into jobs from claimed;
  return jobs;
end $$;

-- Acknowledge only the current unexpired lease. Failed batches are released
-- with a delay; completion must not be called until image upload races are fenced.
create or replace function public.atlas_agent_cleanup_finish(p_account text, p_thread text, p_token text, p_complete boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare affected integer;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{32,64}$' or p_complete is null then raise exception 'invalid input'; end if;
  if p_complete then
    delete from public.atlas_agent_cleanup_queue q where q.account_id = p_account and q.thread_id = p_thread and q.lease_token = p_token and q.lease_until > now()
      and not exists (select 1 from public.atlas_agent_upload_intents i where i.account_id = q.account_id and i.thread_id = q.thread_id);
  else
    update public.atlas_agent_cleanup_queue set lease_token = null, lease_until = null, next_attempt_at = now() + interval '1 minute'
      where account_id = p_account and thread_id = p_thread and lease_token = p_token and lease_until > now();
  end if;
  get diagnostics affected = row_count;
  return affected = 1;
end $$;

revoke all on function public.atlas_agent_expire(integer) from public, anon, authenticated;
revoke all on function public.atlas_agent_cleanup_claim(text,integer) from public, anon, authenticated;
revoke all on function public.atlas_agent_cleanup_finish(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.atlas_agent_expire(integer) to service_role;
grant execute on function public.atlas_agent_cleanup_claim(text,integer) to service_role;
grant execute on function public.atlas_agent_cleanup_finish(text,text,text,boolean) to service_role;

revoke all on function public.atlas_agent_list(text,integer) from public, anon, authenticated;
revoke all on function public.atlas_agent_get(text,text) from public, anon, authenticated;
revoke all on function public.atlas_agent_put(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.atlas_agent_tombstone(text,text) from public, anon, authenticated;
grant execute on function public.atlas_agent_list(text,integer) to service_role;
grant execute on function public.atlas_agent_get(text,text) to service_role;
grant execute on function public.atlas_agent_put(text,text,text,text,text) to service_role;
grant execute on function public.atlas_agent_tombstone(text,text) to service_role;

commit;
