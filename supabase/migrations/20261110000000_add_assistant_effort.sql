-- The /effort setting per chat: auto, low, medium or high.
create table if not exists public.assistant_settings (
  chat_id text primary key,
  effort text not null check (effort in ('auto', 'low', 'medium', 'high')),
  updated_at timestamptz not null default now()
);

-- Study questions the assistant answered, so "Think harder" can ask again.
-- Only the question text and Telegram's file id are kept, never file contents;
-- rows older than 7 days are deleted.
create table if not exists public.assistant_requests (
  id serial primary key,
  chat_id text not null,
  text text not null,
  attachment_kind text check (attachment_kind in ('image', 'file')),
  attachment_file_id text,
  attachment_name text,
  attachment_mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists assistant_requests_created_idx
  on public.assistant_requests (created_at);

-- Like the other assistant tables: the bot connects as the owner, and RLS with
-- no policies keeps these tables out of the public Data API.
alter table public.assistant_settings enable row level security;
alter table public.assistant_requests enable row level security;
