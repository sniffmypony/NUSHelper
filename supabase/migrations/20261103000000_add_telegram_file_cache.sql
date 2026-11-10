create table if not exists public.telegram_file_cache (
  canvas_file_id bigint primary key,
  canvas_updated_at text not null,
  telegram_file_id text not null,
  cached_at timestamptz not null default now()
);

-- Like the other assistant tables: the bot connects as the owner, and RLS with
-- no policies keeps the table out of the public Data API.
alter table public.telegram_file_cache enable row level security;
