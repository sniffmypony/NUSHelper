-- The website's saved AI chats. Uploaded photos and files are never stored;
-- a message only notes that one was sent.
create table if not exists public.web_chats (
  id serial primary key,
  title text not null default 'New chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_chat_messages (
  id serial primary key,
  chat_id integer not null references public.web_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tool_context text,
  cards jsonb not null default '[]'::jsonb,
  failed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists web_chat_messages_chat_idx
  on public.web_chat_messages (chat_id, id);

-- Only the bot's server connection uses these tables.
alter table public.web_chats enable row level security;
alter table public.web_chat_messages enable row level security;
