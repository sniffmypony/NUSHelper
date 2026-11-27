-- The first tables, from before migrations were kept here: tasks and the
-- day's to-dos. Later migrations change them (link_tasks_to_todos adds
-- todos.task_id). "if not exists" makes this a no-op on databases that
-- already have them.
create table if not exists public.tasks (
  id serial primary key,
  description text not null,
  module text,
  due_date date,
  done boolean not null default false,
  created_at timestamp not null default now()
);

create table if not exists public.todos (
  id serial primary key,
  description text not null,
  created_at timestamp not null default now()
);

-- Like the other tables: the bot connects as the owner, and RLS with no
-- policies keeps Supabase's public API keys out.
alter table public.tasks enable row level security;
alter table public.todos enable row level security;
