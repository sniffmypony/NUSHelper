create table if not exists public.reminders (
  id serial primary key,
  owner_id text not null,
  chat_id text not null,
  source_message_id integer not null,
  source_line integer not null default 0,
  description text not null,
  scheduled_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'expired')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_source_unique unique (
    owner_id,
    chat_id,
    source_message_id,
    source_line
  ),
  constraint reminders_expiry_after_schedule check (expires_at > scheduled_at)
);

create index if not exists reminders_due_idx
  on public.reminders (scheduled_at, id)
  where status = 'pending';

create table if not exists public.morning_acknowledgements (
  id serial primary key,
  owner_id text not null,
  acknowledgement_date date not null,
  message_id integer,
  acknowledged_at timestamptz not null default now(),
  constraint morning_ack_owner_date_unique unique (
    owner_id,
    acknowledgement_date
  )
);
