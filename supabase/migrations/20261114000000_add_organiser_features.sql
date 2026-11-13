-- Which topic (thread) of a chat each kind of message goes to (/topics).
create table if not exists public.chat_topics (
  chat_id text not null,
  category text not null
    check (category in ('planner', 'study', 'canvas', 'expenditure')),
  thread_id integer not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, category)
);

-- To-dos shown in the last nightly check-in, kept one day so
-- "Move to tomorrow" can put one back after the list is cleared.
create table if not exists public.todo_carryovers (
  id serial primary key,
  description text not null,
  task_id integer,
  created_at timestamptz not null default now()
);

-- Items added to the to-do list by themselves on matching days (/every).
create table if not exists public.recurring_items (
  id serial primary key,
  description text not null,
  rule text not null
    check (rule ~ '^(daily|weekly:[1-7](,[1-7])*|monthly:([1-9]|[12][0-9]|3[01]))$'),
  last_added_on date,
  created_at timestamptz not null default now()
);

-- Classes from a NUSMods timetable link (/timetable), one row per lesson.
create table if not exists public.timetable_lessons (
  id serial primary key,
  acad_year text not null,
  semester integer not null check (semester between 1 and 4),
  module_code text not null,
  lesson_type text not null,
  class_no text not null,
  day integer not null check (day between 1 and 7),
  start_time text not null check (start_time ~ '^[0-2][0-9][0-5][0-9]$'),
  end_time text not null check (end_time ~ '^[0-2][0-9][0-5][0-9]$'),
  venue text not null default '',
  weeks jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists timetable_lessons_term_day_idx
  on public.timetable_lessons (acad_year, semester, day);

-- Like the other tables: the bot connects as the owner, and RLS with no
-- policies keeps these tables out of the public Data API.
alter table public.chat_topics enable row level security;
alter table public.todo_carryovers enable row level security;
alter table public.recurring_items enable row level security;
alter table public.timetable_lessons enable row level security;
