# NUSHelper

A private Telegram assistant for NUS students. It keeps your tasks, daily to-dos, same-day reminders and spending in one chat. An AI assistant lets you do all of that in plain language, answers study questions with real LaTeX maths, reads photos, and (optionally) works with Canvas and Google Calendar.

Each person runs their **own copy** for their own Telegram account: your data, keys and AI provider stay yours. It runs on free tiers of Vercel and Supabase.

> **Singapore only (for now).** Times, reminders, scheduled messages and the `S$` currency all assume `Asia/Singapore`.

## Features

| Feature                      | What it does                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks and to-dos             | Long-term tasks with module and due date, plus a daily to-do list that clears every night. Tasks due today roll into the to-do list each morning.                   |
| Reminders                    | `/remind 1800 do tutorial` sends a reminder later the same day.                                                                                                     |
| Expenditure                  | An `expenditure:` prompt every night at 11:30pm, or just send amounts like `5 3.9` any time. Weekly and monthly reports, plus a day-by-day breakdown for any range. |
| AI assistant                 | Plain-language requests ("remind me at 6pm to do tut"), study questions with LaTeX that Telegram renders, and photos (solves a problem or carries out a note).      |
| Canvas _(optional)_          | "What's due this week?", "send me the lecture 5 slides for CS2102". Tested with NUS Canvas.                                                                         |
| Google Calendar _(optional)_ | Add events by typing `14:00-16:00, Tutorial, 05-11-2026`, list them, and delete with confirmation. Shown in the morning summary.                                    |

Deleting anything always asks for a **Delete** tap, and anything the assistant adds gets an **Undo** button.

## Telegram usage

| Input                                    | Result                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `/task <text> #MODULE @YYYY-MM-DD`       | Add a long-term task. Module and due date are optional. |
| `/list`                                  | List unfinished tasks.                                  |
| `/done <id>`                             | Complete a task and remove its linked daily to-do.      |
| `/remove <id>`                           | Permanently delete a task.                              |
| `/todo <text>`                           | Add an item to today's list.                            |
| `/todos`                                 | Show today's list.                                      |
| `/remind HHMM <text>`                    | Send a reminder later today in Singapore time.          |
| `<amounts>`                              | Add spending to today (or answer the nightly prompt).   |
| `<month> <year> expenditure`             | Show a stored monthly expenditure report.               |
| `/expenditure <DD-MM-YYYY> <DD-MM-YYYY>` | Show spending on each day of a date range.              |
| `<time>, <title>, <DD-MM-YYYY>`          | Preview a Google Calendar event.                        |
| `/effort [auto\|low\|medium\|high]`      | Show or set how hard the assistant thinks.              |
| `/help`                                  | Show the bot's help text.                               |
| Anything else, or a photo                | Ask the AI assistant.                                   |

```text
/task Finish ER diagram #CS2102 @2026-09-05
/remind 1800 do tutorial
12-2, CS2040 tutorial, 05-09-2026
what's due this week?
how much did I spend each day from 3 to 8 Nov?
prove that sqrt(2) is irrational
```

Calendar messages need exactly three comma-separated fields; put a title containing a comma in double quotes. The bot shows a preview first, and nothing is created until you press **Create**. You can send several `/todo`, `/remind` or calendar lines in one message; malformed lines are skipped and reported.

### Expenditure

Reply to the 11:30pm `expenditure:` prompt with amounts separated by spaces, commas or new lines (`10.95 11 3`). If nothing is logged, the prompt repeats at 1am and S$0.00 is recorded at 7am. A message made only of amounts at any other time is added to today's total. Each entry has **Add amount** / **Remove amount** buttons for 365 days. Weekly reports follow Sunday's entry and monthly reports follow the last day of the month. Only each day's total is stored, not individual purchases.

### AI assistant

Any message that isn't a command, a number-only message or a calendar line goes to the assistant. It uses the same code and validation as the slash commands, so it can't create anything a command would reject. It:

- runs bot actions from plain language: tasks, to-dos, reminders, expenditure, calendar events;
- answers study questions (maths, proofs, algorithms, code) with LaTeX (`$...$`, `$$...$$`) that Telegram renders as typeset maths;
- reads photos and images sent as files (JPG/PNG/WebP/GIF, up to 20 MB): a note meant for the bot is carried out, a problem is solved, and anything else is summarised without creating anything unless your caption asks;
- reads files: reply to any file or photo with a question, or send a PDF, PowerPoint (`.pptx`), Word (`.docx`), text or code file with a caption. PDFs are read as text plus images of up to 6 pages, so formulas, tables and diagrams come through (your AI provider only needs to accept images);
- with Canvas set up, lists modules and deadlines, finds and sends course files (up to 10 at once, as one album; files sent before are re-sent instantly), and reads them, so "solve Q2" works right after it sends a tutorial.

Rich messages (LaTeX, formatting) need a Telegram app from June 2026 or later; otherwise the same reply arrives as plain text.

#### Thinking effort

The assistant chooses how hard the model thinks (`reasoning_effort`): **low** for bot actions and chat, so they stay quick, and **medium** for study questions, photos and files. Study answers have a **Think harder** button that asks again at **high**. `/effort low`, `/effort medium` or `/effort high` uses one level for every message; `/effort auto` goes back to the default.

One message may take up to 270 seconds (Vercel stops the function at 300). Replies are streamed, so a long think isn't mistaken for a hang. If a level runs out of time, the bot answers with the next lower level (high → medium → low) and says so, unless the slow attempt had already changed something (added a to-do, sent a file) that a retry would repeat. After 20 seconds a "Working on it" note appears; it is deleted when the answer arrives.

Models that don't accept `reasoning_effort` still work: after the first rejection the bot stops sending it and uses the model's default.

## Requirements

| You need                                                   | Free?      | Required?         |
| ---------------------------------------------------------- | ---------- | ----------------- |
| A Telegram bot from [@BotFather](https://t.me/BotFather)   | Yes        | Yes               |
| A [Vercel](https://vercel.com) account                     | Hobby plan | Yes               |
| A [Supabase](https://supabase.com) project                 | Free plan  | Yes               |
| An OpenAI-compatible AI API that supports **tool calling** | Depends    | For the assistant |
| A Canvas personal access token                             | Yes        | Optional          |
| A Google Cloud project with the Calendar API               | Yes        | Optional          |

The assistant works with any OpenAI-compatible chat-completions endpoint whose model supports tool calling (and image input, for photos). NUS students can use [SoCLaaS](https://soclaas-api.comp.nus.edu.sg); other providers such as OpenAI or OpenRouter work too.

## Setup

### 1. Telegram

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and keep the **token** it gives you.
2. Get your numeric Telegram user ID, for example from [@userinfobot](https://t.me/userinfobot). Only this ID can use your bot.

### 2. Supabase

1. Create a project. In **Project Settings → Database → Connection string**, copy the **Transaction pooler** URI; this is `DATABASE_URL`.
2. In the **SQL Editor**, run every file in `supabase/migrations` in filename order.

### 3. Vercel

1. Fork this repository and import it into Vercel.
2. Add the environment variables below (**Settings → Environment Variables**, Production), then deploy.
3. `vercel.json` sets the region to `sin1` (Singapore) and a 300-second limit for the webhook, which needs Fluid compute (the default for new projects).

### 4. Reminders and nightly expenditure prompt

Supabase calls the bot every minute to deliver reminders and run the expenditure prompt. Open `supabase/reminder-cron.sql.example`, replace both placeholders (your deployment URL and a new random secret), and run it once in the SQL Editor. Set the same secret as `REMINDER_DISPATCH_SECRET` in Vercel.

### 5. Register the webhook

The webhook only accepts requests carrying a secret derived from your bot token. Put `TELEGRAM_BOT_TOKEN=...` in a local `.env` (never committed), then run:

```sh
pnpm install
pnpm run setup:webhook https://<your-project>.vercel.app/api/webhook
```

Send `/help` to your bot to check it works. Re-run this command if you ever rotate the bot token.

### 6. Optional: Google Calendar

1. In a Google Cloud project, enable the **Google Calendar API** and create a **service account**.
2. Create a JSON key for it and base64-encode the file. In PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`; on macOS/Linux: `base64 -w0 key.json`. Set the result as `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`.
3. In Google Calendar, share your calendar with the service account's email using **Make changes to events**.
4. Set `GOOGLE_CALENDAR_ID` to that calendar's ID (your Gmail address for your main calendar).

Advanced: instead of a JSON key, the bot can authenticate without stored keys via Vercel OIDC and Google Workload Identity Federation (`GCP_*` variables in `.env.example`).

### 7. Optional: Canvas

In Canvas, go to **Account → Settings → New access token**, and set `CANVAS_API_TOKEN` and `CANVAS_BASE_URL`. The token can act as you on Canvas, so keep it only in Vercel.

## Environment variables

See `.env.example` for the full list with comments.

| Variable                              | Required  | Purpose                                                             |
| ------------------------------------- | --------- | ------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`                  | Yes       | BotFather token.                                                    |
| `TELEGRAM_OWNER_ID`                   | Yes       | Your numeric Telegram user ID.                                      |
| `DATABASE_URL`                        | Yes       | Supabase transaction-pooler connection string.                      |
| `CRON_SECRET`                         | Yes       | Protects the Vercel cron endpoints (any random string).             |
| `REMINDER_DISPATCH_SECRET`            | Yes       | Protects the per-minute dispatcher (a different random string).     |
| `LLM_API_KEY`                         | Assistant | API key for your AI provider.                                       |
| `LLM_BASE_URL`                        | Assistant | OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`.       |
| `LLM_MODEL`                           | Assistant | A model that supports tool calling (and images, for photos).        |
| `GOOGLE_CALENDAR_ID`                  | Optional  | The one calendar the bot may use. Leave empty to turn Calendar off. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`  | Optional  | Base64 of the service-account JSON key.                             |
| `CANVAS_API_TOKEN`, `CANVAS_BASE_URL` | Optional  | Canvas access; leave empty to turn Canvas off.                      |

`SOCLAAS_API_KEY`, `SOCLAAS_BASE_URL` and `SOCLAAS_MODEL` are accepted in place of the `LLM_*` names.

## Scheduled jobs

Vercel cron runs in UTC; Singapore is UTC+8.

| Job                 | UTC schedule            | Singapore time | Purpose                                                  |
| ------------------- | ----------------------- | -------------- | -------------------------------------------------------- |
| `weekly-digest`     | `0 0 * * 1`             | Monday 8am     | Calendar events and tasks for the week.                  |
| `daily-morning`     | `0 0 * * *`             | Daily 8am      | Task rollover, 3-day calendar view, morning summary.     |
| `checkin-and-clear` | `0 15 * * *`            | Daily 11pm     | Send the final to-do list, then clear it.                |
| `reminder-dispatch` | every minute (Supabase) | —              | Reminders and the 11:30pm / 1am / 7am expenditure steps. |

## Security and privacy

- **Webhook secret:** every webhook request must carry the secret Telegram was given at registration, so forged updates are rejected.
- **Single owner:** only `TELEGRAM_OWNER_ID`, in a private chat, can use the bot; everyone else is ignored silently.
- **One calendar:** the bot only ever uses `GOOGLE_CALENDAR_ID`; messages can't choose another calendar. The only Google scope is `calendar.events`.
- **Your AI provider sees what you send the assistant**, including photos. Canvas file names and deadlines it looks up are sent to it too.
- **Secrets** live only in Vercel environment variables and are never logged.

## Development

```sh
pnpm install
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
```

Unit tests don't contact Telegram, Google, Canvas, Supabase or Vercel. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Troubleshooting

- **Bot doesn't reply:** re-run `pnpm run setup:webhook` with the right URL, and check Vercel's logs for `Webhook request rejected`.
- **Calendar `403` / `404`:** the calendar isn't shared with the service account, or `GOOGLE_CALENDAR_ID` is wrong.
- **"The AI service returned an error":** check `LLM_*` values and that the model supports tool calling.
- **"The AI took too long to answer":** even low effort ran out of time; ask one part at a time. Vercel's logs show `Assistant timing` lines with the effort used for each answer.
- **Formulas show as `$x^2$`:** update your Telegram app; rich messages need a June 2026 or later version.

## Licence

[MIT](LICENSE). Not affiliated with NUS, Instructure (Canvas) or Telegram.
