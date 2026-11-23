import OpenAI from "openai";
import { FIXED_CALENDAR_ID, isCalendarConfigured } from "../calendar/config.js";
import { getCalendarGateway } from "../calendar/google.js";
import {
  llmConfig,
  optionalEnv,
  telegramBotToken,
  telegramOwnerId,
} from "../env.js";
import { describeTimetable, importTimetable } from "../nus/timetable.js";
import { forgetLoadedSettings, refreshSettings } from "../settings/runtime.js";
import { settingsStore } from "../settings/store.js";
import type { WebDependencies } from "./router.js";

let botUsername: Promise<string> | undefined;

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
      calendarId: FIXED_CALENDAR_ID,
      serviceAccountEmail: optionalEnv("GCP_SERVICE_ACCOUNT_EMAIL") ?? null,
    };
  },

  async checkCalendar() {
    if (!isCalendarConfigured()) throw new Error("Calendar is not set up");
    await (await getCalendarGateway()).checkReadable();
  },

  describeTimetable: () => describeTimetable(),
  importTimetable: (link) => importTimetable(link),

  async settingsChanged() {
    forgetLoadedSettings();
    await refreshSettings();
  },
};
