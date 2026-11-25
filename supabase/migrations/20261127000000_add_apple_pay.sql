-- Apple Pay payments sent by the owner's iPhone Shortcuts automation. Each
-- counted payment is also an expenditure adjustment (kind 'applepay') on its
-- day, so totals and reports include it.
create table if not exists public.apple_pay_payments (
  id serial primary key,
  received_at timestamptz not null default now(),
  spend_date date not null,
  -- Null until a foreign-currency payment is given its S$ amount.
  amount_cents integer check (amount_cents >= 0),
  -- The amount as the phone sent it, e.g. "S$5.40" or "¥500".
  amount_text text not null,
  currency text not null,
  merchant text not null default '',
  card text not null default '',
  status text not null default 'counted'
    check (status in ('counted', 'undone', 'awaiting_sgd', 'skipped')),
  -- While set and in the future, a bare amount sent on Telegram is this
  -- foreign payment's S$ amount.
  sgd_requested_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists apple_pay_payments_received_idx
  on public.apple_pay_payments (received_at);
create index if not exists apple_pay_payments_day_idx
  on public.apple_pay_payments (spend_date);

alter table public.apple_pay_payments enable row level security;

-- A day nobody replied for keeps its Apple Pay total ('auto') instead of
-- being recorded as S$0 ('auto_zero').
alter table public.expenditure_days
  drop constraint if exists expenditure_days_status_check;
alter table public.expenditure_days
  add constraint expenditure_days_status_check
  check (status in ('pending', 'logged', 'auto_zero', 'auto'));

alter table public.expenditure_adjustments
  drop constraint if exists expenditure_adjustments_kind_check;
alter table public.expenditure_adjustments
  add constraint expenditure_adjustments_kind_check
  check (kind in ('initial', 'add', 'remove', 'applepay'));
