import { isCalendarConfigured } from "../calendar/config.js";
import { isCanvasConfigured, optionalEnv } from "../env.js";
import type { WebhookStatus } from "../telegram-webhook.js";

// What a new copy still needs: the website's setup checklist (on Today) and
// the flags pages use to say a feature is off instead of failing.

export interface Features {
  ai: boolean;
  calendar: boolean;
  canvas: boolean;
}

export function features(): Features {
  return {
    ai: Boolean(
      optionalEnv("LLM_API_KEY", "SOCLAAS_API_KEY") &&
      optionalEnv("LLM_BASE_URL", "SOCLAAS_BASE_URL") &&
      optionalEnv("LLM_MODEL", "SOCLAAS_MODEL"),
    ),
    // A calendar, and some way to sign in to Google.
    calendar:
      isCalendarConfigured() &&
      Boolean(
        optionalEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64") ||
        optionalEnv("GOOGLE_APPLICATION_CREDENTIALS") ||
        optionalEnv("GCP_SERVICE_ACCOUNT_EMAIL"),
      ),
    canvas: isCanvasConfigured(),
  };
}

export interface SetupItem {
  key: string;
  label: string;
  // null: couldn't tell.
  done: boolean | null;
  detail: string;
  // Where to fix it on the website, if it can be fixed there.
  href: string | null;
  optional: boolean;
}

export interface SetupDependencies {
  telegramStatus(): Promise<WebhookStatus>;
  features(): Features;
  // When the every-minute job last ran: null if never, undefined if the
  // database can't say (no pg_cron).
  dispatchLastRun(): Promise<Date | null | undefined>;
  hasTimetable(): Promise<boolean>;
  // The assistant's own Google sign-in (needed from February 2027).
  assistantGoogle(): boolean;
}

// The job runs every minute; a few missed runs are fine.
const DISPATCH_STALE_MS = 10 * 60 * 1000;

export async function setupChecklist(
  deps: SetupDependencies,
  now = new Date(),
): Promise<SetupItem[]> {
  const on = deps.features();
  // One after the other: Telegram, then the database (queries in a request
  // run one at a time).
  let telegram: boolean | null;
  try {
    telegram = (await deps.telegramStatus()).connected;
  } catch {
    telegram = null;
  }
  const lastRun = await deps.dispatchLastRun();
  const timetable = await deps.hasTimetable();
  const running =
    lastRun === undefined
      ? null
      : lastRun !== null &&
        now.getTime() - lastRun.getTime() <= DISPATCH_STALE_MS;

  return [
    {
      key: "telegram",
      label: "Connect Telegram",
      done: telegram,
      detail:
        telegram === null
          ? "Couldn't ask Telegram. Check TELEGRAM_BOT_TOKEN in Vercel."
          : "So the bot receives your messages.",
      href: "/settings",
      optional: false,
    },
    {
      key: "ai",
      label: "Add an AI provider",
      done: on.ai,
      detail: "Its address, API key and a model, for the assistant.",
      href: "/settings",
      optional: false,
    },
    {
      key: "dispatch",
      label: "Start the every-minute job",
      done: running,
      detail:
        running === null
          ? "Couldn't check it from here. It's set up by pnpm setup:db with your site's address."
          : lastRun
            ? "It has stopped running. Run pnpm setup:db with your site's address again."
            : "Reminders and the nightly check-in need it. Run pnpm setup:db with your site's address.",
      href: null,
      optional: false,
    },
    {
      key: "calendar",
      label: "Connect Google Calendar",
      done: on.calendar,
      detail: "Events, birthdays and finals on your calendar.",
      href: "/settings",
      optional: true,
    },
    {
      key: "assistant-google",
      label: "Connect Google for the assistant",
      done: deps.assistantGoogle(),
      detail:
        "From February 2027 the assistant can only use your calendar through Google's MCP server, signed in as you.",
      href: "/settings",
      optional: true,
    },
    {
      key: "canvas",
      label: "Connect Canvas",
      done: on.canvas,
      detail: "Deadlines, submission checks and module files.",
      href: "/settings",
      optional: true,
    },
    {
      key: "timetable",
      label: "Save your NUSMods timetable",
      done: timetable,
      detail: "Today's classes and finals.",
      href: "/timetable",
      optional: true,
    },
  ];
}
