-- One-time website sign-in links sent by the bot's /web command. Only a
-- SHA-256 hash of each token is stored; a link works once, for 10 minutes.
create table if not exists public.web_login_links (
  token_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.web_login_links enable row level security;
