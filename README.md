# NUSHelper

A private Telegram assistant for NUS students. It keeps your tasks, daily to-dos, reminders and spending in one chat. An AI assistant lets you do all of that in plain language, answers study questions with real LaTeX maths, reads photos, and (optionally) works with Canvas and Google Calendar.

Each person runs their **own copy** for their own Telegram account: your data, keys and AI provider stay yours. It runs on free tiers of Vercel and Supabase.

> **Singapore only (for now).** Times, reminders, scheduled messages and the `S$` currency all assume `Asia/Singapore`.

## Features

| Feature                      | What it does                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tasks and to-dos             | Long-term tasks with module and due date, plus a daily to-do list that clears every night. Tasks due today roll into the to-do list each morning.                        |
| Reminders                    | `/remind 1800 do tutorial` for today, or `/remind 20-11 0900 submit form` for another day. Every reminder has snooze buttons.                                            |
| Repeating to-dos             | `/every mon tutorial prep` adds itself to the to-do list on those mornings.                                                                                              |
| Class timetable              | Paste a NUSMods share link once; each day's classes show in the 8am message during teaching weeks 1–13.                                                                  |
| Topics                       | `/topics` sorts the bot's messages into Planner, Study, Canvas files and Expenditure topics inside the one chat.                                                         |
| Expenditure                  | An `expenditure:` prompt every night at 11:30pm, or just send amounts like `5 3.9` any time. Weekly and monthly reports, plus a day-by-day breakdown for any range.      |
| AI assistant                 | Plain-language requests ("remind me at 6pm to do tut"), study questions with LaTeX that Telegram renders, and photos (solves a problem or carries out a note).           |
| Canvas _(optional)_          | "What's due this week?", "send me the lecture 5 slides for CS2102". Tested with NUS Canvas.                                                                              |
| Google Calendar _(optional)_ | Add events by typing `14:00-16:00, Tutorial, 05-11-2026` (or `all day, …`, optionally repeating), list them, and delete with confirmation. Shown in the morning summary. |

Deleting anything always asks for a **Delete** tap, and anything the assistant adds gets an **Undo** button.

## Telegram usage

| Input                                    | Result                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `/task <text> #MODULE @YYYY-MM-DD`       | Add a long-term task. Module and due date are optional. |
| `/list`                                  | List unfinished tasks.                                  |
| `/done [name]`                           | Complete a task (pick from buttons, or match by name).  |
| `/remove [name]`                         | Delete a task, after a Delete tap.                      |
| `/todo <text>`                           | Add an item to today's list.                            |
| `/todos`                                 | Show today's list.                                      |
| `/remind [day] HHMM <text>`              | Send a reminder today, or on `tmr` / `DD-MM` / a date.  |
| `/every <when> <text>`                   | Add a repeating to-do (`mon`, `mon,thu`, `day`, `1`).   |
| `/repeats`                               | List repeating to-dos and stop one.                     |
| `/timetable [NUSMods link \| clear]`     | Save, show or remove your class timetable.              |
| `/topics`                                | Create the four topics (needs Threaded mode).           |
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

**Canvas deadlines on Calendar.** With Canvas set up, a daily job at 7:30am copies every assignment due in the next 180 days and, with Google Calendar set up, adds each as `<CODE> <name>`, the hour ending at the deadline (due 23:59 → 22:59–23:59), with the deadline as its only note. Each event is created once and then left alone, so your own edits or deletions stick. It tells you about new deadlines, ones moved on Canvas (the event is rewritten at the new time) and ones removed from Canvas (the event is deleted). An hour before each deadline the bot checks Canvas: ⚠️ if nothing is submitted, or a plain reminder for work it can't see on Canvas (on paper, external tools). Submitted work gets no message.

Calendar messages need three comma-separated fields, `<time>, <title>, <DD-MM-YYYY>`; put a title containing a comma in double quotes. Write `all day` instead of a time for an all-day event, and add a fourth field `daily`, `weekdays`, `weekly`, `monthly` or `yearly` to repeat it, e.g. `all day, Mum's birthday, 19-08-2027, yearly` or `5pm-6pm, CS2102 project, 06-11-2026, weekly`. Monthly repeats on the same day of the month and yearly on the same date. The assistant can do the same ("add Mum's birthday on 19 Aug every year"). The bot shows a preview first, and nothing is created until you press **Create**. You can send several `/todo`, `/remind` or calendar lines in one message; malformed lines are skipped and reported.

### Reminders, repeating to-dos and the nightly check-in

- **Reminders:** `/remind 1800 text` is for today. Put a day first for later: `/remind tmr 0900 text`, `/remind 20-11 0900 text` or `/remind 20-11-2027 0900 text`, up to a year ahead. A date without a year means the next time it comes round. Each reminder arrives with **+15 min** and **+1 hr** buttons.
- **Repeating to-dos:** `/every <when> <text>`, where `<when>` is `day`, `weekdays`, weekday names (`mon`, `mon,thu`) or a day of the month (`1`, `15`; the 29th–31st fall on the last day of shorter months). They join the to-do list at 8am. `/repeats` lists them with a button to stop each one.
- **Nightly check-in:** at 11pm the to-do list is cleared and the message listing it has one button per item, plus **Move all to tomorrow**. A tapped item goes back on the fresh list. The buttons work until the next check-in.

### Class timetable

On NUSMods, copy your timetable's share link and send it to the bot, on its own, inside a message or as `/timetable <link>`. The bot looks the classes up on NUSMods once and stores them. In teaching weeks 1–13 the 8am message lists that day's classes with times and venues, skipping classes that don't run that week. Nothing is announced in recess, reading, exam or vacation weeks. Send a new link each semester.

`/classes [today|tomorrow|mon-sun|DD-MM-YYYY]` shows any day's classes the same way, and the assistant answers "what are my classes tomorrow?" with its `classes_on` tool.

Saving a timetable also lists the semester's finals from NUSMods and, if Google Calendar is set up, puts each on it as `📝 Final: <CODE> <title>`. Each exam event's id comes from the year, semester and module, so sending the link again updates the events instead of adding new ones, and the finals of modules dropped since the last link are removed. NUSMods has no exam venues. If Calendar can't be reached, the timetable is still saved and sending the link again retries.

`/week` shows the current academic week, e.g. `Y2S1W7, AY 26/27` (year of study, semester, teaching week), with its dates, whether it is an odd or even week, and when finals start or end (or when the next semester starts during the vacation); `/week DD-MM-YYYY` does the same for another date. Other weeks read `Y2S1 Recess Week`, `Reading Week`, `Exam Week 1`/`2`, `Vacation`, `Orientation Week`, or `Y2ST1W3` in a special term. The 8am message starts with the current week, the assistant always knows it, and its `academic_week` tool answers "what week is 1 March?" or "how long until finals?". Set `NUS_MATRICULATION_YEAR` for the `Y2` part. The rule was checked against the official NUS calendars for AY2026/27 to AY2028/29.

The week comes from NUSMods' own academic-calendar rule (the year starts on the first Monday of August), not from live data, and public holidays are not known to the bot.

### Topics

Telegram can split a bot's private chat into topics. In [@BotFather](https://t.me/BotFather), tap **Open**, choose your bot and turn on **Threaded mode**, then send `/topics`. The bot creates **Planner**, **Study**, **Canvas files** and **Expenditure**.

- The bot replies in whichever topic you write in, and every command works in every topic.
- Messages the bot sends by itself go to their topic: reminders, the morning message, the weekly digest and the nightly check-in to Planner; the expenditure prompt and reports to Expenditure.
- The assistant remembers each topic's conversation separately.
- Without topics, or if you delete one, messages go to the main chat as before. `/topics` recreates anything missing.

### Expenditure

Reply to the 11:30pm `expenditure:` prompt with amounts separated by spaces, commas or new lines (`10.95 11 3`). If nothing is logged, the prompt repeats at 1am and S$0.00 is recorded at 7am. A message made only of amounts at any other time is added to today's total, except within 10 minutes of the assistant asking you a question: then a bare number such as `1600` is your answer (a reminder time, a choice) and goes to the assistant. Each entry has **Add amount** / **Remove amount** buttons for 365 days. Weekly reports follow Sunday's entry and monthly reports follow the last day of the month. Only each day's total is stored, not individual purchases.

### AI assistant

Any message that isn't a command, a number-only message or a calendar line goes to the assistant. It uses the same code and validation as the slash commands, so it can't create anything a command would reject. It:

- runs bot actions from plain language: tasks, to-dos, reminders, expenditure, calendar events;
- answers study questions (maths, proofs, algorithms, code) with LaTeX (`$...$`, `$$...$$`) that Telegram renders as typeset maths;
- reads photos and images sent as files (JPG/PNG/WebP/GIF, up to 20 MB): a note meant for the bot is carried out, a problem is solved, and anything else is summarised without creating anything unless your caption asks;
- reads files: reply to any file or photo with a question, or send a PDF, PowerPoint (`.pptx`), Word (`.docx`), text or code file with a caption. PDFs are read as text plus images of up to 6 pages, so formulas, tables and diagrams come through (your AI provider only needs to accept images);
- with Canvas set up, lists modules and deadlines, finds and sends course files (up to 10 at once, as one album; files sent before are re-sent instantly), and reads them, so "solve Q2" works right after it sends a tutorial.

Names keep your spelling. The assistant writes the text of reminders, tasks, to-dos, repeating items and calendar events itself and may tidy ordinary words ("abt" becomes "about"), but it is told to copy names exactly, and before anything is saved, a capitalised word that is one letter off a word you typed (two for longer words, same first letter) gets your spelling back: "ask iggy abt poll" is saved as "Ask Iggy about the poll", never "Igy".

Rich messages (LaTeX, formatting) need a Telegram app from June 2026 or later; otherwise the same reply arrives as plain text.

#### Thinking effort

The assistant chooses how hard the model thinks (`reasoning_effort`): **low** for bot actions and chat, so they stay quick, and **medium** for study questions, photos and files. Study answers have a **Think harder** button that asks again at **high**. `/effort low`, `/effort medium` or `/effort high` uses one level for every message; `/effort auto` goes back to the default.

One message may take up to 270 seconds (Vercel stops the function at 300). Replies are streamed, so a long think isn't mistaken for a hang. If a level runs out of time, the bot answers with the next lower level (high → medium → low) and says so, unless the slow attempt had already changed something (added a to-do, sent a file) that a retry would repeat. After 20 seconds a "Working on it" note appears; it is deleted when the answer arrives.

Models that don't accept `reasoning_effort` still work: after the first rejection the bot stops sending it and uses the model's default.

## Website

The same Vercel project serves a private website at the project's address (for example `https://<project>.vercel.app`). It is a planner and control panel for the bot, working on the same data as Telegram.

- **Sign-in:** Telegram Login, only for `TELEGRAM_OWNER_ID`. Once, set the domain for your bot: in @BotFather send `/setdomain`, pick the bot, and send the website's domain without `https://`. If Telegram's confirmation message doesn't arrive, send `/web` to the bot instead: it replies with a **Get a sign-in link** button that stays, and each press sends a new one-time link (20 minutes; the token is after `#` in the link, so link previews can't use it, and only its hash is stored). Set `WEB_URL` if the site isn't at the Vercel project's production domain. A sign-in lasts 60 days; changing keys needs a sign-in within the last 10 minutes. **Sign out everywhere** ends every session.
- **Setting up:** until the essentials are done, Today starts with a checklist: Telegram connected, an AI provider, and the every-minute job running (read from pg_cron), plus optional Google Calendar, Canvas and the NUSMods timetable, each with a link to where it's fixed. Pages whose feature isn't set up say so instead of failing: Chat without an AI provider, Deadlines without Canvas, and adding events without Google Calendar.
- **Today** (the home page): the NUS week, today's classes with venues, events, reminders and what's due, today's to-dos to tick off, spending for today, this week and this month, and the next six days.
- **Tasks:** tasks (with module and due date; complete or delete), today's to-dos and repeating items, through the same code as `/task`, `/todo` and `/every`.
- **Spending:** a month's daily totals as a chart, weekly totals, and a day-by-day table; any of the last 365 days can be changed.
- **Timetable:** the saved semester's classes as a weekly grid (a list on phones), finals from NUSMods with a button to put them on Google Calendar again, and the NUSMods link.
- **Deadlines:** upcoming Canvas deadlines by week with a **Check submissions** button (asks Canvas about the next two weeks, up to 15), and the past two weeks.
- **Data:** Settings → Data downloads spending, tasks, to-dos, reminders, repeating items or saved chats as CSV (cells that a spreadsheet would run as formulas are made safe).
- **Calendar:** a month grid with each day's spending total, Google Calendar events, reminders, tasks due, Canvas deadlines and classes (only in the weeks they run), and the NUS week. Tap a day to add or remove spending (as the Add/Remove buttons do, so reports stay right), add a timed or all-day event (optionally repeating) to Google Calendar or delete one, add a reminder, move a pending reminder to another time or cancel it (the bot texts at the new time), and see the day's classes, deadlines and tasks.
- **Chat:** the same assistant as on Telegram (same models, backup model, effort levels and tools), with saved chats you can search, rename, pin and delete. Replies appear as they're written, with Markdown and LaTeX maths. Deletions and new Google Calendar events wait for a **Confirm** card, and things it adds get an **Undo** card, like the Telegram buttons. A photo (shrunk to 1600 px) or a file up to 3 MB can be attached; neither is stored, only a note that one was sent. Canvas files it sends go to your Telegram chat. Chats are kept in `web_chats` and `web_chat_messages`; the last 20 messages of a chat are sent with each new one.
- **Settings:** the Telegram connection (whether Telegram reaches this site, its last delivery error, and **Connect**), the AI provider's address, its API key and the main and backup models (picked from the provider's model list, with a Test button), the Google service-account key (upload the JSON file) and calendar, the Canvas address and token, the matriculation year, and the NUSMods timetable link. A value saved here wins over the Vercel environment variable of the same name; **Use Vercel's** removes it again. The bot reads them at the start of every request, at most every 30 seconds, so a change applies within about half a minute.
- **Keys** are stored AES-256-GCM encrypted in `bot_secrets`, with a key derived from the bot token, and are never shown again (only their last four characters). Changing the bot token makes them unreadable; the bot then uses Vercel's values and the website asks for them again.
- **Google Calendar:** shows the calendar in use, the service account to share it with, and checks access.
- **Activity:** `settings_audit` records what changed and when, never the values.

- **Look:** light, dark or system theme (Settings → Appearance, or the top bar on a phone). The design rules every page follows are in [`web/DESIGN.md`](web/DESIGN.md).

The site is built from `web/` (React, Vite, Tailwind) into `web/dist` by `pnpm --filter nushelper-web build`; its API is one function, `api/web.ts`. For local work run `vercel dev` and, in `web/`, `pnpm dev`.

## Apple Pay

Apple Pay taps can be counted as spending the moment they happen, without the bot seeing any card or bank details:

1. On the website, **Settings → Apple Pay → Create key** (needs a recent sign-in). The key is shown once; only its SHA-256 hash is stored.
2. On the iPhone, a Shortcuts **Transaction** automation (iOS 17+) runs **Get Contents of URL**: `POST /api/applepay` with `Authorization: Bearer <key>` and a JSON body `{ "amount": …, "merchant": …, "card": … }` from the trigger. Settings shows the steps.

Each payment is added to that Singapore day's total at once (as an expenditure adjustment, so reports and the website include it), and the Expenditure topic gets a message with **Undo**:

- **Other currencies:** the bot never guesses a rate. It asks for the S$ amount, and a plain amount sent within 30 minutes (or after **Enter S$ amount**) is used; **Skip** leaves it out.
- **Repeats and limits:** the same amount, merchant and card within 2 minutes counts once, and at most 100 payments a day are accepted.
- **Nightly check-in:** the 11:30pm message then shows the day's Apple Pay total and asks only for anything else (cash, online), with **That's all**. A day with no reply keeps its Apple Pay total (status `auto`) instead of S$0.
- **What isn't seen:** only taps at a terminal trigger the automation. In-app and online Apple Pay, physical cards and some transit taps don't.

## Birthdays

**Tasks → Birthdays** on the website adds birthdays to Google Calendar, several at a time. Paste one per line, a name and a date, day first: `Alice Tan 14/03`, `Bob 2 Dec 2004`, `2005-01-09 Ethan`. **Check** shows what was read and which lines can't be used, then **Add** creates them.

- Each is a yearly all-day event ("🎂 Alice Tan's birthday"), marked free so it doesn't block your time. 29 Feb falls on 28 Feb in other years.
- **Reminder:** the bot sends "🎂 Tomorrow (Mon 7 Dec) is Alice Tan's birthday, turning 22." to the Planner topic at **23:55 the night before**, with the usual snooze buttons. The every-minute job looks up tomorrow's birthdays (every 15 minutes, and each minute from 23:45) and makes one ordinary reminder per birthday. Google's own popup is off, so you aren't reminded twice.
- The same name and date always give the same event id, so pasting a list again doesn't make duplicates. Removing one on the website deletes the event; adding it again restores it.
- Birthdays are kept only in Google Calendar, tagged in a private extended property. With a year, the list shows the age they turn next.

## Bank emails (DBS PayLah! and digibank)

DBS alert emails about money leaving your account become questions on Telegram, so PayLah! and PayNow spending isn't missed. The bot never gets Gmail access: a Google Apps Script in your own account sends it only these emails.

1. On the website, **Settings → Bank emails → Create key** (needs a recent sign-in). Only the key's SHA-256 hash is stored.
2. Settings shows a script to paste into a new project at script.google.com, with the key as the script property `NUSHELPER_KEY`. Running `setup` once notes the emails already there and starts a check every minute.
3. The script searches `from:(paylah.alert@dbs.com OR ibanking.alert@dbs.com) newer_than:2d` and POSTs each new email to `/api/bank-email` with `Authorization: Bearer <key>`: the id, sender, subject, date, plain text and Gmail's `Authentication-Results` header.

What the bot does with each email:

- **Checks DBS sent it:** Gmail's DKIM or DMARC result must pass for `dbs.com` or `dbs.com.sg`. Otherwise it's ignored and you're warned on Telegram.
- **Reads it:** PayLah! Scan & Pay, PayLah! PayNow and digibank PayNow alerts are read by a parser. Money received is ignored. Anything else goes to the AI, which treats the email as data and returns only checked JSON; such messages say "Read by AI". An email it can't read gets a Telegram note.
- **Asks first:** the Expenditure topic gets the payment with **Count it**, **Skip** and **Edit amount**. Nothing is counted until you answer. Foreign currency asks for the S$ amount. The Spending page lists waiting payments with the same choices, and the 11:30pm check-in mentions any still waiting.
- **Once only:** each Gmail message, and each DBS transaction reference, is handled once.

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

Create a project. In **Project Settings → Database → Connection string**, copy the **Transaction pooler** URI; this is `DATABASE_URL`.

### 3. Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsniffmypony%2FNUSHelper&project-name=nushelper&repository-name=nushelper&env=TELEGRAM_BOT_TOKEN,TELEGRAM_OWNER_ID,DATABASE_URL,CRON_SECRET,REMINDER_DISPATCH_SECRET&envDescription=The%20bot%20token%20and%20your%20Telegram%20ID%2C%20the%20Supabase%20connection%20string%2C%20and%20two%20random%20secrets.&envLink=https%3A%2F%2Fgithub.com%2Fsniffmypony%2FNUSHelper%23environment-variables)

The button copies this repository to your GitHub and asks for the five required values: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `DATABASE_URL`, and two different random strings for `CRON_SECRET` and `REMINDER_DISPATCH_SECRET` (for example from `openssl rand -hex 32`). Or fork the repository, import it in Vercel and add the same variables under **Settings → Environment Variables** (Production).

`vercel.json` sets the region to `sin1` (Singapore) and a 300-second limit for the webhook, which needs Fluid compute (the default for new projects).

### 4. Database and the every-minute job

On your computer, with Node 24 (see `.nvmrc`) and pnpm:

```sh
git clone https://github.com/<you>/nushelper && cd nushelper
pnpm install
# .env (never committed): DATABASE_URL=… and REMINDER_DISPATCH_SECRET=… (the same values as in Vercel)
pnpm setup:db https://<your-project>.vercel.app
```

`pnpm setup:db` creates every table (all with Row Level Security, so Supabase's public API keys can't reach your data) and sets up the job that calls the bot every minute for reminders, the nightly expenditure check-in and deadline checks: `pg_cron` and `pg_net`, with the address and secret kept in Supabase Vault. It is safe to run again; do so after pulling updates to apply new migrations. CI runs it twice on an empty database for every change.

Without a computer, the same can be done by hand in the Supabase **SQL Editor**: run every file in `supabase/migrations` in filename order, then `supabase/reminder-cron.sql.example` with its two placeholders filled in.

### 5. Sign in and connect Telegram

1. In @BotFather send `/setdomain`, pick your bot, and send the website's domain without `https://` (for example `your-project.vercel.app`).
2. Open the website and sign in with Telegram.
3. In **Settings → Telegram**, press **Connect**. Telegram then sends your messages to the bot, with a secret only the bot knows. Send `/help` to your bot to check.

Press **Reconnect** if the site's address or the bot token ever changes. (`pnpm setup:webhook https://<your-project>.vercel.app/api/webhook` does the same from your computer.)

### 6. Optional: Google Calendar

1. In a Google Cloud project, enable the **Google Calendar API** and create a **service account**.
2. Create a JSON key for it and base64-encode the file. In PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`; on macOS/Linux: `base64 -w0 key.json`. Set the result as `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`.
3. In Google Calendar, share your calendar with the service account's email using **Make changes to events**.
4. Set `GOOGLE_CALENDAR_ID` to that calendar's ID (your Gmail address for your main calendar).

Advanced: instead of a JSON key, the bot can authenticate without stored keys via Vercel OIDC and Google Workload Identity Federation (`GCP_*` variables in `.env.example`).

#### The assistant's Google access

From 1 February 2027, Google's terms require AI tools to reach Google Calendar through its **Calendar MCP server**, signed in as you (a service account can't be used there with a personal Gmail account). The assistant's own calendar actions will use it; the rest of the bot keeps using the service account above. Once, in the same Google Cloud project:

1. Enable **Calendar MCP** (`calendarmcp.googleapis.com`).
2. In **Google Auth Platform**: Audience **External**, add yourself as a test user, fill in **Branding** (home page `https://<your-site>`, privacy policy `https://<your-site>/privacy`, authorised domain `<your-site>`, no logo, so no verification is needed), then **Publish app** so the sign-in doesn't expire after 7 days.
3. **Clients → Create client**: **Web application**, redirect URI `https://<your-site>/api/web/google/callback`, and tick **Use this client for an AI-powered agent**.
4. On the website, **Settings → Assistant's Google access**: paste the client ID and secret, press **Connect**, and allow Calendar access (Google warns the app isn't verified: choose **Advanced → Go to NUSHelper**). **Check** lists the next week's events through the MCP server.

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
| `LLM_FALLBACK_MODEL`                  | Optional  | Backup model on the same API, asked once if the main one fails.     |
| `GOOGLE_CALENDAR_ID`                  | Optional  | The one calendar the bot may use. Leave empty to turn Calendar off. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`  | Optional  | Base64 of the service-account JSON key.                             |
| `CANVAS_API_TOKEN`, `CANVAS_BASE_URL` | Optional  | Canvas access; leave empty to turn Canvas off.                      |
| `NUS_MATRICULATION_YEAR`              | Optional  | Year your Year 1 started (e.g. `2025`); adds `Y2` to week labels.   |

`SOCLAAS_API_KEY`, `SOCLAAS_BASE_URL`, `SOCLAAS_MODEL` and `SOCLAAS_FALLBACK_MODEL` are accepted in place of the `LLM_*` names.

When the AI service fails for the main model (HTTP 5xx or 429, or no connection) before the assistant has done anything, the same message is asked once of `LLM_FALLBACK_MODEL`, and the reply starts with a note that the backup model answered. It uses the same API and key, so it helps when one model's servers are down, not when the whole service is.

## Scheduled jobs

Vercel cron runs in UTC; Singapore is UTC+8.

| Job                 | UTC schedule            | Singapore time | Purpose                                                                                                                               |
| ------------------- | ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `weekly-digest`     | `0 0 * * 1`             | Monday 8am     | Calendar events, tasks and Canvas deadlines for the week.                                                                             |
| `canvas-deadlines`  | `30 23 * * *`           | Daily 7:30am   | Copies upcoming Canvas deadlines, puts them on Google Calendar, reports new/moved/removed ones.                                       |
| `daily-morning`     | `0 0 * * *`             | Daily 8am      | Repeating to-dos, task rollover, classes, Canvas deadlines due in 48 hours, 3-day calendar view.                                      |
| `checkin-and-clear` | `0 15 * * *`            | Daily 11pm     | Clear the to-do list and send it with Move to tomorrow buttons.                                                                       |
| `reminder-dispatch` | every minute (Supabase) | —              | Reminders, birthday reminders at 23:55, the 11:30pm / 1am / 7am expenditure steps, and the check an hour before each Canvas deadline. |

## Security and privacy

- **Webhook secret:** every webhook request must carry the secret Telegram was given at registration, so forged updates are rejected.
- **Single owner:** only `TELEGRAM_OWNER_ID`, in a private chat, can use the bot; everyone else is ignored silently.
- **One calendar:** the bot only ever uses `GOOGLE_CALENDAR_ID`; messages can't choose another calendar. The only Google scope is `calendar.events`.
- **Your AI provider sees what you send the assistant**, including photos. Canvas file names and deadlines it looks up are sent to it too.
- **NUSMods sees the module codes** in a timetable link when you save it; the lookup uses its public API and sends nothing else.
- **Secrets** live only in Vercel environment variables and are never logged.
- **Bank emails:** only DBS alert emails leave Gmail, sent by your own Apps Script. Your AI provider sees an email only when its format isn't recognised.

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

- **Bot doesn't reply:** open **Settings → Telegram** on the website: it shows whether Telegram reaches this site and its last delivery error, and **Reconnect** fixes a wrong address. Also check Vercel's logs for `Webhook request rejected`.
- **Calendar `403` / `404`:** the calendar isn't shared with the service account, or `GOOGLE_CALENDAR_ID` is wrong.
- **"The AI service returned an error":** check `LLM_*` values and that the model supports tool calling.
- **"The AI took too long to answer":** even low effort ran out of time; ask one part at a time. Vercel's logs show `Assistant timing` lines with the effort used for each answer.
- **Formulas show as `$x^2$`:** update your Telegram app; rich messages need a June 2026 or later version.

## Licence

[MIT](LICENSE). Not affiliated with NUS, Instructure (Canvas) or Telegram.
