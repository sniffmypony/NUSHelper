-- Repeating Google Calendar events: null, or daily / weekdays / weekly /
-- monthly / yearly. All-day events need no new column: their start and end
-- are stored as dates (YYYY-MM-DD) instead of date-times.
alter table public.calendar_event_mappings
  add column if not exists repeat text
  check (repeat in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly'));

alter table public.calendar_pending_events
  add column if not exists repeat text
  check (repeat in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly'));
