-- The Google Calendar can now be switched on the website, so event mappings
-- may name any calendar (the old check allowed only one).
alter table public.calendar_event_mappings
  drop constraint if exists calendar_event_mappings_calendar_id_check;

-- Reminders linked to a Google Calendar event move or disappear with it.
alter table public.reminders
  add column if not exists event_id text,
  add column if not exists event_offset_min integer,
  add column if not exists event_checked_at timestamptz;

alter table public.reminders
  drop constraint if exists reminders_event_offset_check;
alter table public.reminders
  add constraint reminders_event_offset_check
  check (
    (event_id is null and event_offset_min is null)
    or (event_id is not null and event_offset_min between 0 and 10080)
  );

create index if not exists reminders_linked_pending_idx
  on public.reminders (scheduled_at)
  where event_id is not null and status = 'pending';
