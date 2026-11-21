-- Canvas assignments with a due date, copied by the daily deadline sync
-- (api/cron/canvas-deadlines). Each is on Google Calendar as an hour ending
-- at the deadline, and gets a "have you submitted?" message an hour before.
create table if not exists public.canvas_deadlines (
  assignment_id bigint primary key,
  course_id bigint not null,
  module_code text not null,
  name text not null,
  due_at timestamptz not null,
  html_url text,
  checked_for_due_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists canvas_deadlines_due_idx
  on public.canvas_deadlines (due_at);

-- Like the other tables: the bot connects as the owner, and RLS with no
-- policies keeps it out of the public Data API.
alter table public.canvas_deadlines enable row level security;
