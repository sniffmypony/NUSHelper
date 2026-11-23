-- Settings changed on the NUSHelper website. A value overrides the Vercel
-- environment variable named by its key; clearing it goes back to Vercel's.
create table if not exists public.bot_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Keys saved on the website, AES-256-GCM encrypted by the app. Only the last
-- four characters are readable, to show which key is saved.
create table if not exists public.bot_secrets (
  key text primary key,
  ciphertext text not null,
  last_four text not null,
  updated_at timestamptz not null default now()
);

-- What changed and when; never the values.
create table if not exists public.settings_audit (
  id serial primary key,
  key text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists settings_audit_created_idx
  on public.settings_audit (created_at desc);

-- Like the other tables: the bot connects as the owner, and RLS with no
-- policies keeps these out of the public Data API.
alter table public.bot_settings enable row level security;
alter table public.bot_secrets enable row level security;
alter table public.settings_audit enable row level security;
