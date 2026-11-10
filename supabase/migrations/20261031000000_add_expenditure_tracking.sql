create table if not exists public.expenditure_days (
  spend_date date primary key,
  total_cents integer not null default 0 check (total_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'logged', 'auto_zero')),
  prompt_sent_at timestamptz,
  reminder_sent_at timestamptz,
  logged_at timestamptz,
  auto_zeroed_at timestamptz,
  missing_notice_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenditure_adjustments (
  id serial primary key,
  spend_date date not null references public.expenditure_days(spend_date) on delete cascade,
  owner_id text not null,
  chat_id text not null,
  source_message_id integer not null,
  kind text not null check (kind in ('initial', 'add', 'remove')),
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists expenditure_adjustment_source_unique
  on public.expenditure_adjustments(owner_id, chat_id, source_message_id);

create table if not exists public.expenditure_input_sessions (
  owner_id text primary key,
  chat_id text not null,
  spend_date date not null references public.expenditure_days(spend_date) on delete cascade,
  mode text not null check (mode in ('initial', 'add', 'remove')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenditure_input_sessions_expiry_idx
  on public.expenditure_input_sessions(expires_at);

create table if not exists public.expenditure_reports (
  id serial primary key,
  report_type text not null check (report_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  revision integer not null default 1 check (revision > 0),
  sent_revision integer not null default 0 check (sent_revision >= 0),
  claimed_revision integer,
  claimed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenditure_report_period_unique unique (report_type, period_start, period_end),
  constraint expenditure_report_period_order check (period_start <= period_end)
);

create index if not exists expenditure_reports_pending_idx
  on public.expenditure_reports(sent_revision, revision, claimed_at);
