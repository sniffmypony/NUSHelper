create table if not exists public.assistant_update_claims (
  update_id bigint primary key,
  claimed_at timestamptz not null default now()
);

create index if not exists assistant_update_claims_claimed_idx
  on public.assistant_update_claims (claimed_at);

create table if not exists public.assistant_messages (
  id serial primary key,
  chat_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tool_context text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_messages_chat_created_idx
  on public.assistant_messages (chat_id, created_at);

-- The bot connects as the table owner, which bypasses RLS. Enabling it with
-- no policies keeps Canvas-derived history out of the public Data API.
alter table public.assistant_update_claims enable row level security;
alter table public.assistant_messages enable row level security;
