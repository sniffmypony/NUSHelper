-- Row Level Security on every table. The bot connects as the table owner,
-- which bypasses RLS, so nothing changes for it; with RLS on and no
-- policies, Supabase's public API keys (anon, authenticated) can't read or
-- write anything. Earlier migrations missed some tables, so a new project
-- would have left them open.
alter table public.calendar_event_mappings enable row level security;
alter table public.calendar_pending_events enable row level security;
alter table public.expenditure_adjustments enable row level security;
alter table public.expenditure_days enable row level security;
alter table public.expenditure_input_sessions enable row level security;
alter table public.expenditure_reports enable row level security;
alter table public.morning_acknowledgements enable row level security;
alter table public.reminders enable row level security;
alter table public.tasks enable row level security;
alter table public.todos enable row level security;
