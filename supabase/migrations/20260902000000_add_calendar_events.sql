create table if not exists public.calendar_event_mappings (
  id serial primary key,
  owner_id text not null,
  chat_id text not null,
  message_id integer not null,
  calendar_id text not null,
  google_event_id text not null,
  google_html_link text,
  action_token text not null unique,
  title text not null,
  start_datetime text not null,
  end_datetime text not null,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists calendar_mapping_source_unique
  on public.calendar_event_mappings (owner_id, chat_id, message_id);

create unique index if not exists calendar_mapping_google_event_unique
  on public.calendar_event_mappings (calendar_id, google_event_id);

create table if not exists public.calendar_pending_events (
  operation_id text primary key,
  kind text not null check (kind in ('create', 'update', 'delete')),
  owner_id text not null,
  chat_id text not null,
  message_id integer not null,
  title text,
  start_datetime text,
  end_datetime text,
  google_event_id text,
  target_mapping_id integer references public.calendar_event_mappings(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'cancelled', 'expired', 'failed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_pending_source_index
  on public.calendar_pending_events (owner_id, chat_id, message_id);

create index if not exists calendar_pending_expiry_index
  on public.calendar_pending_events (expires_at);
