-- Run in the dedicated Supabase project's SQL editor before enabling the Worker.
-- Journal rows contain operational and personal data. Never grant browser roles access.
create table if not exists public.atlas_journal (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  kind text not null check (kind in ('api', 'audit')),
  created_at timestamptz not null,
  data jsonb not null
);
create index if not exists atlas_journal_kind_time_id on public.atlas_journal (kind, created_at desc, id desc);
create index if not exists atlas_journal_time on public.atlas_journal (created_at);
create index if not exists atlas_journal_kind_id on public.atlas_journal (kind, id desc);
alter table public.atlas_journal enable row level security;
revoke all on public.atlas_journal from public, anon, authenticated;
revoke all on sequence public.atlas_journal_id_seq from public, anon, authenticated;

create or replace function public.atlas_journal_ingest(p_key text, p_kind text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_kind not in ('api', 'audit') or p_key is null or length(p_key) > 200 or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid journal event'; end if;
  insert into public.atlas_journal(event_key, kind, created_at, data)
  values (p_key, p_kind, (p_data->>'created_at')::timestamptz, p_data)
  on conflict (event_key) do nothing;
  return jsonb_build_object('accepted', true);
end $$;

-- One transaction per bounded outbox batch. Duplicate event keys are never
-- updated, so retries after a lost acknowledgement cause no repeated writes.
create or replace function public.atlas_journal_ingest_batch(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare item jsonb; n integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid journal batch'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 25 then raise exception 'invalid journal batch size'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if item->>'p_kind' not in ('api','audit') or item->>'p_kind' is null
      or item->>'p_key' is null or length(item->>'p_key') > 200
      or jsonb_typeof(item->'p_data') is distinct from 'object'
      or item->'p_data'->>'created_at' is null then raise exception 'invalid journal event'; end if;
  end loop;
  insert into public.atlas_journal(event_key, kind, created_at, data)
    select t.event->>'p_key', t.event->>'p_kind', (t.event->'p_data'->>'created_at')::timestamptz, t.event->'p_data'
    from jsonb_array_elements(p_items) as t(event)
    on conflict (event_key) do nothing;
  return jsonb_build_object('accepted', true, 'count', n);
end $$;

create or replace function public.atlas_journal_page(p_kind text, p_range text, p_limit integer, p_cursor bigint, p_query text, p_action text, p_status text, p_username text, p_ip text, p_stats boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; metrics jsonb; from_time timestamptz; lim integer;
begin
  if p_kind not in ('api','audit') then raise exception 'invalid kind'; end if;
  from_time := now() - case p_range when '24h' then interval '1 day' when '7d' then interval '7 days' else interval '30 days' end;
  lim := greatest(1, least(coalesce(p_limit, 40), 100));
  with eligible as (
    select id, created_at, data from public.atlas_journal
    where kind = p_kind and created_at >= from_time and created_at >= now() - interval '30 days'
      and (coalesce(p_cursor, 0) = 0 or id < p_cursor)
      and (coalesce(p_action, '') = '' or data->>'action' = p_action)
      and (coalesce(p_username, '') = '' or lower(data->>'username') = lower(p_username))
      and (coalesce(p_ip, '') = '' or data->>'ip' = p_ip)
      and (coalesce(p_query, '') = '' or data::text ilike '%' || replace(replace(replace(p_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%')
      and (coalesce(p_status, '') = '' or (p_status = 'ok' and coalesce((data->>'status')::int, 0) < 400) or (p_status = 'error' and coalesce((data->>'status')::int, 0) >= 400) or (p_status = 'auth' and (data->>'status')::int in (401,403)))
    order by id desc limit lim + 1
  ), page as (select * from eligible order by id desc limit lim)
  select jsonb_build_object('data', coalesce((select jsonb_agg(data || jsonb_build_object('id', id, 'created_at', created_at) order by id desc) from page), '[]'::jsonb),
    'meta', jsonb_build_object('limit', lim, 'has_more', (select count(*) > lim from eligible), 'next_cursor', case when (select count(*) > lim from eligible) then (select min(id)::text from page) else null end, 'range', p_range)) into result;
  if coalesce(p_stats, false) and coalesce(p_cursor, 0) = 0 then
    with base as (select data, created_at from public.atlas_journal where kind = p_kind and created_at >= from_time and created_at >= now() - interval '30 days'),
    days as (select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as "day", count(*) n, count(*) filter (where p_kind = 'api' and coalesce((data->>'status')::int, 0) >= 400) errors from base group by 1 order by 1),
    actions as (select data->>'action' action, count(*) n from base where p_kind = 'audit' and data->>'action' is not null group by 1 order by 2 desc, 1 limit 8),
    paths as (select data->>'method' method, data->>'path' path, count(*) n, count(*) filter (where coalesce((data->>'status')::int, 0) >= 400) errors from base where p_kind = 'api' group by 1, 2 order by 3 desc, 1, 2 limit 6)
    select jsonb_build_object('total', (select count(*) from base), 'unique_actors', (select count(distinct data->>'username') from base),
      'previous_total', null, 'previous_actors', null, 'top_actions', coalesce((select jsonb_agg(to_jsonb(actions)) from actions), '[]'::jsonb),
      'by_day', coalesce((select jsonb_agg(to_jsonb(days) order by "day") from days), '[]'::jsonb),
      'errors', (select count(*) from base where p_kind = 'api' and coalesce((data->>'status')::int, 0) >= 400),
      'auth_failures', (select count(*) from base where p_kind = 'api' and (data->>'status')::int in (401,403)),
      'unique_ips', (select count(distinct data->>'ip') from base), 'avg_ms', (select coalesce(round(avg((data->>'ms')::numeric)), 0) from base where p_kind = 'api'),
      'risky_calls', null, 'top_paths', coalesce((select jsonb_agg(to_jsonb(paths)) from paths), '[]'::jsonb), 'retention_days', 30, 'range', p_range) into metrics;
    result := jsonb_set(result, '{meta,stats}', metrics, true);
  end if;
  return result;
end $$;
revoke all on function public.atlas_journal_ingest(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.atlas_journal_ingest_batch(jsonb) from public, anon, authenticated;
revoke all on function public.atlas_journal_page(text,text,integer,bigint,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.atlas_journal_ingest(text,text,jsonb) to service_role;
grant execute on function public.atlas_journal_ingest_batch(jsonb) to service_role;
grant execute on function public.atlas_journal_page(text,text,integer,bigint,text,text,text,text,text,boolean) to service_role;

-- Requires pg_cron availability and project permissions. If this fails, do not
-- enable Supabase mode until scheduled retention is configured and verified.
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'atlas-journal-retention';
select cron.schedule('atlas-journal-retention', '17 * * * *', $$delete from public.atlas_journal where created_at < now() - interval '30 days'$$);
