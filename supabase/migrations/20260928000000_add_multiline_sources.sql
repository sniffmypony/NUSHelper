alter table public.calendar_event_mappings
  add column if not exists source_line integer not null default 0
  check (source_line >= 0);

drop index if exists public.calendar_mapping_source_unique;

create unique index if not exists calendar_mapping_source_unique
  on public.calendar_event_mappings
  (owner_id, chat_id, message_id, source_line);

alter table public.calendar_pending_events
  add column if not exists source_line integer not null default 0
  check (source_line >= 0);

drop index if exists public.calendar_pending_source_index;

create index if not exists calendar_pending_source_index
  on public.calendar_pending_events
  (owner_id, chat_id, message_id, source_line);
