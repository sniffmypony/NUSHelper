// Sets up the database in one go, and is safe to run again at any time:
//
//   pnpm setup:db                               # tables only
//   pnpm setup:db https://<your-app>.vercel.app # also the every-minute job
//
// 1. Runs every file in supabase/migrations in order. Each is written to be
//    re-run safely ("if not exists"), so there is no bookkeeping: running
//    them all again applies what is new and leaves the rest alone. Then it
//    checks every table has Row Level Security.
// 2. Given the site's address, it also sets up the job that calls the bot
//    every minute (reminders, the nightly expenditure check-in, deadline and
//    birthday checks): pg_cron and pg_net, with the address and
//    REMINDER_DISPATCH_SECRET kept in Supabase Vault. Running it again
//    updates them.
//
// Reads DATABASE_URL and REMINDER_DISPATCH_SECRET from the environment or
// ./.env. Never prints either.
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { setting } from "./env-file.ts";

const databaseUrl = setting("DATABASE_URL");
const siteArg = process.argv[2]?.trim();

if (!databaseUrl) {
  console.error("Set DATABASE_URL in the environment or in .env first.");
  process.exit(1);
}
if (siteArg && !/^https:\/\/[^/\s]+\/?$/.test(siteArg)) {
  console.error("Pass the site's address, e.g. https://your-app.vercel.app");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  prepare: false,
  max: 1,
  // "already exists, skipping" notices from re-runs are expected.
  onnotice: () => {},
});

async function migrate(): Promise<void> {
  const files = readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const text = readFileSync(`supabase/migrations/${name}`, "utf8");
    // One transaction per file: a file applies completely or not at all.
    await sql.begin((tx) => tx.unsafe(text));
    console.log(`  ✓ ${name}`);
  }
  const [row] = await sql<{ open: string | null; count: number }[]>`
    select
      string_agg(tablename, ', ') filter (where not rowsecurity) as open,
      count(*)::int as count
    from pg_tables
    where schemaname = 'public'
  `;
  if (row.open) {
    throw new Error(`Tables without Row Level Security: ${row.open}`);
  }
  console.log(
    `Database ready: ${row.count} tables, all with Row Level Security.`,
  );
}

const JOB = "dispatch-telegram-reminders";

// A Vault secret by name: updated if it exists, created if not.
async function putSecret(name: string, value: string): Promise<void> {
  const updated = await sql`
    select vault.update_secret(id, ${value})
    from vault.secrets
    where name = ${name}
  `;
  if (updated.length === 0) {
    await sql`select vault.create_secret(${value}, ${name})`;
  }
}

async function scheduleDispatch(site: string): Promise<void> {
  const secret = setting("REMINDER_DISPATCH_SECRET");
  if (!secret) {
    throw new Error(
      "Set REMINDER_DISPATCH_SECRET (the same value as in Vercel) to set up the every-minute job.",
    );
  }
  const url = `${site.replace(/\/+$/, "")}/api/cron/reminder-dispatch`;
  await sql`create extension if not exists pg_cron`;
  await sql`create extension if not exists pg_net`;
  await putSecret("reminder_dispatch_url", url);
  await putSecret("reminder_dispatch_secret", secret);
  // Scheduling under an existing name replaces that job.
  await sql.unsafe(`
    select cron.schedule(
      '${JOB}',
      '* * * * *',
      $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'reminder_dispatch_url'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'reminder_dispatch_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
      $job$
    )
  `);
  console.log(`Every-minute job set: Supabase calls ${url}.`);
}

try {
  console.log("Applying migrations…");
  await migrate();
  if (siteArg) {
    await scheduleDispatch(siteArg);
  } else {
    console.log(
      "Add your site's address to also set up the every-minute job: pnpm setup:db https://<your-app>.vercel.app",
    );
  }
} catch (error) {
  console.error(
    `Setup stopped: ${error instanceof Error ? error.message : "failed"}`,
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
