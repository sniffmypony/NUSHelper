#!/usr/bin/env bash
# Runs every migration, in filename order, on an empty database (as a new
# Supabase project would), then checks every table has Row Level Security.
# Usage: DATABASE_URL=postgres://... scripts/check-migrations.sh
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to an empty database}"

for file in supabase/migrations/*.sql; do
  echo "Applying $(basename "$file")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done

open=$(psql "$DATABASE_URL" -tA -c \
  "select string_agg(tablename, ', ') from pg_tables where schemaname = 'public' and not rowsecurity")
if [ -n "$open" ]; then
  echo "Tables without Row Level Security: $open" >&2
  exit 1
fi
count=$(psql "$DATABASE_URL" -tA -c "select count(*) from pg_tables where schemaname = 'public'")
echo "All migrations applied; $count tables, all with Row Level Security."
