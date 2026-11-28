import OpenAI from "openai";
import { calendarId, isCalendarConfigured } from "../calendar/config.js";
import { getCalendarGateway } from "../calendar/google.js";
import {
  llmConfig,
  optionalEnv,
  telegramBotToken,
  telegramOwnerId,
} from "../env.js";
import {
  describeTimetable,
  importTimetable,
  timetableStore,
} from "../nus/timetable.js";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { features } from "./setup.js";
import { googleAccess } from "./google-access.js";
import { forgetLoadedSettings, refreshSettings } from "../settings/runtime.js";
import { consumeLoginToken, loginLinkStore } from "./login-links.js";
import { calendarActions } from "./calendar-actions.js";
import { settingsStore } from "../settings/store.js";
import type { WebDependencies } from "./router.js";
import { performDelete } from "../assistant/buttons.js";
import { assistantErrorMessage } from "../assistant/handlers.js";
import { webAssist } from "./chat-assistant.js";
import { chatStore } from "./chat-store.js";
import { plannerActions } from "./planner-actions.js";
import { websiteUrl } from "./login-links.js";
import {
  registerWebhook,
  webhookStatus,
  webhookUrlFor,
} from "../telegram-webhook.js";
import { webhookSecretFor } from "../webhook-secret.js";

let botUsername: Promise<string> | undefined;

// The account to share the calendar with: from the service-account key if
// there is one, else the keyless (Workload Identity) setup's.
function serviceAccountEmail(): string | null {
  const key = optionalEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  if (key) {
    try {
      const parsed = JSON.parse(Buffer.from(key, "base64").toString("utf8"));
      if (typeof parsed?.client_email === "string") return parsed.client_email;
    } catch {
      // Fall through to the keyless setup's account.
    }
  }
  return optionalEnv("GCP_SERVICE_ACCOUNT_EMAIL") ?? null;
}

function aiClient(): OpenAI {
  const { apiKey, baseURL } = llmConfig();
  return new OpenAI({ apiKey, baseURL, timeout: 30_000, maxRetries: 0 });
}

export const webDependencies: WebDependencies = {
  botToken: telegramBotToken,
  ownerId: telegramOwnerId,
  nowSeconds: () => Math.floor(Date.now() / 1000),
  store: settingsStore,
  env: (name) => process.env[name]?.trim() || undefined,

  features,
  google: googleAccess({
    store: settingsStore,
    botToken: telegramBotToken,
    ownerId: telegramOwnerId,
    siteUrl: () => websiteUrl(),
    async settingsChanged() {
      forgetLoadedSettings();
      await refreshSettings();
    },
  }),
  async dispatchLastRun() {
    // pg_cron's own record of the job set up by pnpm setup:db. Without
    // pg_cron (not Supabase) the query fails and the answer is unknown.
    try {
      const rows = await db.execute(sql`
        select max(d.end_time) as last
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
        where j.jobname = 'dispatch-telegram-reminders'
          and d.status = 'succeeded'
          and d.end_time > now() - interval '1 day'
      `);
      const last = (Array.from(rows)[0] as { last: Date | string | null })
        ?.last;
      return last ? new Date(last) : null;
    } catch {
      return undefined;
    }
  },
  async hasTimetable() {
    return (await timetableStore.all()).length > 0;
  },
  async telegramStatus() {
    const site = websiteUrl();
    return webhookStatus(telegramBotToken(), site ? webhookUrlFor(site) : null);
  },
  async connectTelegram() {
    const site = websiteUrl();
    if (!site) throw new Error("This site's address isn't known; set WEB_URL.");
    const token = telegramBotToken();
    await registerWebhook(token, webhookUrlFor(site), webhookSecretFor(token));
    return webhookStatus(token, webhookUrlFor(site));
  },
  botUsername() {
    botUsername ??= fetch(
      `https://api.telegram.org/bot${telegramBotToken()}/getMe`,
      { signal: AbortSignal.timeout(10_000) },
    )
      .then((response) => response.json())
      .then((data: { ok?: boolean; result?: { username?: string } }) => {
        if (!data.ok || !data.result?.username) {
          throw new Error("getMe failed");
        }
        return data.result.username;
      })
      .catch((error) => {
        botUsername = undefined;
        throw error;
      });
    return botUsername;
  },

  async listModels() {
    const models: string[] = [];
    for await (const model of aiClient().models.list()) models.push(model.id);
    return models.sort((a, b) => a.localeCompare(b));
  },

  async testModel(model) {
    const started = Date.now();
    await aiClient().chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with the word OK." }],
      max_tokens: 5,
    });
    return { ms: Date.now() - started };
  },

  calendarInfo() {
    return {
      calendarId: calendarId(),
      serviceAccountEmail: serviceAccountEmail(),
    };
  },

  async checkCalendar(id) {
    if (!id && !isCalendarConfigured()) {
      throw new Error("Calendar is not set up");
    }
    await (await getCalendarGateway()).checkReadable(id || undefined);
  },

  describeTimetable: () => describeTimetable(),
  importTimetable: (link) => importTimetable(link),
  consumeLoginToken: (token) => consumeLoginToken(loginLinkStore, token),
  calendar: calendarActions,
  planner: plannerActions,
  chat: {
    store: chatStore,
    assist: webAssist,
    errorMessage: assistantErrorMessage,
    cards: {
      performDelete: (kind, id) => performDelete(kind, id, telegramOwnerId()),
      addCalendarEvent: (line) => calendarActions.addEvent(line),
      deleteCalendarEvent: (eventId) => calendarActions.deleteEvent(eventId),
    },
  },

  async settingsChanged() {
    forgetLoadedSettings();
    await refreshSettings();
  },
};
