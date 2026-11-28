-- PREPARATION ONLY: creates an empty, inaccessible Agent conversation table.
-- It does not migrate chats, activate Atlas, schedule cleanup, or delete data.
-- Run in the SQL Editor of the existing journal Supabase project after review.
-- All ciphertext must be encrypted by the server before storage. Do not place
-- plaintext messages, titles, credentials, or image bytes in this table.

create table if not exists public.atlas_agent_conversations (
  account_id text not null check (length(account_id) between 1 and 200),
  thread_id text not null check (length(thread_id) between 1 and 80),
  -- Versioned opaque ciphertext envelope, including nonce and authentication tag.
  encrypted_payload text not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  primary key (account_id, thread_id)
);

create index if not exists atlas_agent_conversations_account_activity
  on public.atlas_agent_conversations (account_id, last_activity_at desc, thread_id);
create index if not exists atlas_agent_conversations_expiry
  on public.atlas_agent_conversations (last_activity_at);

alter table public.atlas_agent_conversations enable row level security;
-- No API access is granted as part of preparation. A future integration must
-- define and review narrowly scoped server-only functions and permissions.
revoke all on table public.atlas_agent_conversations from public, anon, authenticated, service_role;
