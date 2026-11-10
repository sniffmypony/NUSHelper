alter table public.todos
  add column if not exists task_id integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'todos_task_id_fkey'
      and conrelid = 'public.todos'::regclass
  ) then
    alter table public.todos
      add constraint todos_task_id_fkey
      foreign key (task_id)
      references public.tasks(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'todos_task_id_unique'
      and conrelid = 'public.todos'::regclass
  ) then
    alter table public.todos
      add constraint todos_task_id_unique unique (task_id);
  end if;
end
$$;
