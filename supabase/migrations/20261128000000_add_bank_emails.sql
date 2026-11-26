-- DBS payment alert emails, sent by a Google Apps Script in the owner's own
-- Gmail, join Apple Pay payments in the same table. They are never counted
-- until the owner answers Count it / Skip / Edit amount ('awaiting_ok').
alter table public.apple_pay_payments
  add column if not exists source text not null default 'applepay',
  add column if not exists kind text not null default '',
  add column if not exists external_ref text,
  add column if not exists read_by_ai boolean not null default false;

alter table public.apple_pay_payments
  drop constraint if exists apple_pay_payments_source_check;
alter table public.apple_pay_payments
  add constraint apple_pay_payments_source_check
  check (source in ('applepay', 'email'));

alter table public.apple_pay_payments
  drop constraint if exists apple_pay_payments_status_check;
alter table public.apple_pay_payments
  add constraint apple_pay_payments_status_check
  check (status in ('counted', 'undone', 'awaiting_sgd', 'skipped', 'awaiting_ok'));

-- One row per bank transaction (DBS reference, or the Gmail message id).
create unique index if not exists apple_pay_payments_external_ref_idx
  on public.apple_pay_payments (external_ref)
  where external_ref is not null;
