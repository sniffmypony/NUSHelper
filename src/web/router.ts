import {
  APPLE_PAY_KEY_SETTING,
  BANK_EMAIL_KEY_SETTING,
  hashApplePayKey,
  newApplePayKey,
} from "../apple-pay/payments.js";
import { encryptSecret, lastFour } from "../settings/crypto.js";
import {
  SESSION_VERSION_KEY,
  SETTINGS,
  settingDefinition,
} from "../settings/definitions.js";
import type { SettingsStore } from "../settings/store.js";
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  isFresh,
  readCookie,
  sessionCookie,
  signSession,
  verifySession,
  type Session,
} from "./session.js";
import { verifyTelegramLogin } from "./telegram-login.js";
import type { CalendarActions } from "./calendar-actions.js";
import { calendarRoute } from "./calendar-routes.js";
import type { ChatEvent } from "./chat.js";
import { chatRoute, type ChatDependencies } from "./chat-routes.js";
import type { PlannerActions } from "./planner-actions.js";
import { plannerRoute } from "./planner-routes.js";
import type { WebhookStatus } from "../telegram-webhook.js";
import { setupChecklist, type Features } from "./setup.js";
import type { GoogleAccess } from "./google-access.js";
import { isEffortSetting, type EffortSetting } from "../assistant/effort.js";

// The website's API (/api/web/...). Everything except the sign-in needs the
// owner's session cookie; changes also need the X-NUSHelper header, which a
// page on another site can't send to us (on top of SameSite=Strict cookies).

export interface WebRequest {
  method: string;
  route: string; // e.g. "settings/LLM_MODEL"
  cookie?: string;
  csrfHeader?: string;
  body?: unknown;
  search?: string; // ?q= on a GET
  // The rest of the query string (Google's redirect back sends code and
  // state).
  query?: Record<string, string>;
}

export interface WebResponse {
  status: number;
  body: unknown;
  setCookie?: string;
  // A chat reply: events are sent as they happen (newline-separated JSON).
  stream?: (emit: (event: ChatEvent) => void) => Promise<void>;
  // A file to save (CSV export).
  download?: { filename: string; contentType: string; body: string };
  // Send the browser here (after Google's sign-in).
  redirect?: string;
}

export interface WebDependencies {
  botToken(): string;
  ownerId(): string;
  nowSeconds(): number;
  store: SettingsStore;
  env(name: string): string | undefined; // Vercel's value, ignoring the website
  botUsername(): Promise<string>;
  // Where Telegram sends the bot's updates, and pointing it at this site.
  telegramStatus(): Promise<WebhookStatus>;
  connectTelegram(): Promise<WebhookStatus>;
  // Which optional features are set up, and the setup checklist's checks.
  features(): Features;
  dispatchLastRun(): Promise<Date | null | undefined>;
  hasTimetable(): Promise<boolean>;
  assistantGoogle(): boolean;
  // The assistant's own Google sign-in (Calendar MCP).
  google: GoogleAccess;
  listModels(): Promise<string[]>;
  testModel(model: string): Promise<{ ms: number }>;
  // The assistant's thinking effort: the same setting as /effort in the
  // owner's Telegram chat, which the website's Chat also uses.
  effort: {
    get(): Promise<EffortSetting>;
    set(effort: EffortSetting): Promise<void>;
  };
  calendarInfo(): { calendarId: string; serviceAccountEmail: string | null };
  // Checks the bot can read a calendar: the current one, or `id`.
  checkCalendar(id?: string): Promise<void>;
  describeTimetable(): Promise<string>;
  importTimetable(link: string): Promise<string>;
  consumeLoginToken(token: string): Promise<boolean>;
  calendar: CalendarActions;
  chat: ChatDependencies;
  planner: PlannerActions;
  settingsChanged(): Promise<void>;
}

export const CSRF_HEADER = "x-nushelper";

const json = (status: number, body: unknown, setCookie?: string) => ({
  status,
  body,
  ...(setCookie ? { setCookie } : {}),
});
const fail = (status: number, error: string) => json(status, { error });

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// A short reason for the page, never the raw error (it may echo a key).
function reason(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `HTTP ${status}`;
  return errorType(error) === "TimeoutError" ? "timed out" : "failed";
}

async function sessionVersion(store: SettingsStore): Promise<number> {
  const stored = (await store.values()).get(SESSION_VERSION_KEY)?.value;
  const version = Number(stored ?? 0);
  return Number.isSafeInteger(version) ? version : 0;
}

function text(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === "string" ? value.trim() : undefined;
}

export async function handleWebRequest(
  request: WebRequest,
  deps: WebDependencies,
): Promise<WebResponse> {
  const { method, route } = request;
  const now = deps.nowSeconds();
  const mutating = method !== "GET";
  if (mutating && request.csrfHeader !== "1") {
    return fail(403, "Missing request header.");
  }

  // Public: what the sign-in page needs.
  if (method === "GET" && route === "config") {
    try {
      return json(200, { botUsername: await deps.botUsername() });
    } catch (error) {
      console.error(`Website config failed (${errorType(error)})`);
      return fail(
        502,
        "Couldn't load your bot from Telegram. Check TELEGRAM_BOT_TOKEN in Vercel.",
      );
    }
  }

  // Google's redirect back after the owner signs in. No session cookie
  // arrives here (it's SameSite=Strict); the signed state and this
  // browser's own cookie are checked instead.
  if (method === "GET" && route === "google/callback") {
    const done = await deps.google.finish(
      request.query ?? {},
      request.cookie,
      now,
    );
    return {
      status: 302,
      body: null,
      redirect: done.redirect,
      setCookie: done.cookie,
    };
  }

  if (method === "POST" && route === "auth/telegram") {
    const data = request.body;
    if (!data || typeof data !== "object") return fail(400, "Bad sign-in.");
    const check = verifyTelegramLogin(
      data as Record<string, unknown>,
      deps.botToken(),
      now,
    );
    if (!check.ok) {
      return fail(
        401,
        check.reason === "expired"
          ? "That sign-in is too old. Try again."
          : "Telegram couldn't confirm that sign-in.",
      );
    }
    if (check.id !== deps.ownerId()) {
      return fail(403, "This website is private to the bot's owner.");
    }
    const session: Session = {
      uid: check.id,
      iat: now,
      authAt: check.authDate,
      v: await sessionVersion(deps.store),
    };
    return json(
      200,
      { ok: true },
      sessionCookie(signSession(session, deps.botToken()), SESSION_SECONDS),
    );
  }

  // A one-time link from the bot's /web command. Counts as a fresh sign-in.
  if (method === "POST" && route === "auth/link") {
    const token = text(request.body, "token");
    if (!token || !(await deps.consumeLoginToken(token))) {
      return fail(
        401,
        "That sign-in link has expired or was already used. Send /web to the bot for a new one.",
      );
    }
    const session: Session = {
      uid: deps.ownerId(),
      iat: now,
      authAt: now,
      v: await sessionVersion(deps.store),
    };
    return json(
      200,
      { ok: true },
      sessionCookie(signSession(session, deps.botToken()), SESSION_SECONDS),
    );
  }

  if (method === "POST" && route === "auth/logout") {
    return json(200, { ok: true }, sessionCookie("", 0));
  }

  const session = verifySession(
    readCookie(request.cookie, SESSION_COOKIE),
    deps.botToken(),
    now,
    await sessionVersion(deps.store),
  );
  if (method === "GET" && route === "me") {
    const authenticated = Boolean(session && session.uid === deps.ownerId());
    return json(200, {
      authenticated,
      fresh: Boolean(session && isFresh(session, now)),
      expiresAt: session ? (session.iat + SESSION_SECONDS) * 1000 : null,
      // Only for the owner: which features are set up.
      ...(authenticated ? { features: deps.features() } : {}),
    });
  }
  if (!session || session.uid !== deps.ownerId()) {
    return fail(401, "Please sign in.");
  }
  const needFresh = () =>
    isFresh(session, now)
      ? null
      : fail(401, "Sign in again to change keys (for your safety).");

  try {
    if (method === "POST" && route === "auth/logout-all") {
      const next = (await sessionVersion(deps.store)) + 1;
      await deps.store.setValue(SESSION_VERSION_KEY, String(next));
      await deps.store.addAudit("session", "signed out everywhere");
      return json(200, { ok: true }, sessionCookie("", 0));
    }

    if (method === "GET" && route === "settings") {
      // Sequential, as in refreshSettings: no pipelined queries on the
      // single pooled connection.
      const values = await deps.store.values();
      const secrets = await deps.store.secrets();
      const fromVercel = (names: string[]) =>
        names.map((name) => deps.env(name)).find(Boolean);
      return json(200, {
        settings: SETTINGS.filter((s) => !s.secret).map((s) => {
          const saved = values.get(s.key);
          const vercel = fromVercel(s.env) ?? null;
          return {
            key: s.key,
            label: s.label,
            help: s.help,
            value: saved?.value ?? vercel,
            source: saved ? "website" : vercel ? "vercel" : "unset",
            vercelValue: vercel,
            updatedAt: saved?.updatedAt ?? null,
          };
        }),
        secrets: SETTINGS.filter((s) => s.secret).map((s) => {
          const saved = secrets.get(s.key);
          return {
            key: s.key,
            label: s.label,
            help: s.help,
            source: saved ? "website" : fromVercel(s.env) ? "vercel" : "unset",
            lastFour: saved?.lastFour ?? null,
            updatedAt: saved?.updatedAt ?? null,
          };
        }),
        calendar: deps.calendarInfo(),
      });
    }

    const settingMatch = /^(settings|secrets)\/([A-Z_]+)$/.exec(route);
    if (settingMatch) {
      const [, kind, key] = settingMatch;
      const definition = settingDefinition(key);
      if (!definition || definition.secret !== (kind === "secrets")) {
        return fail(404, "Unknown setting.");
      }
      if (kind === "secrets") {
        const stale = needFresh();
        if (stale) return stale;
      }
      if (method === "DELETE") {
        if (kind === "secrets") await deps.store.clearSecret(key);
        else await deps.store.clearValue(key);
        await deps.store.addAudit(key, "reset to Vercel's value");
        await deps.settingsChanged();
        return json(200, { ok: true });
      }
      if (method === "PUT") {
        const value = text(request.body, "value");
        if (!value) return fail(400, "Enter a value.");
        const problem = definition.validate(value);
        if (problem) return fail(400, problem);
        if (key === "GOOGLE_CALENDAR_ID") {
          // Switch only to a calendar the bot can actually use.
          try {
            await deps.checkCalendar(value);
          } catch (error) {
            return fail(
              400,
              `The bot can't read that calendar (${reason(error)}). Share it with the bot's Google account first.`,
            );
          }
        }
        if (kind === "secrets") {
          await deps.store.setSecret(
            key,
            encryptSecret(value, deps.botToken()),
            lastFour(value),
          );
          await deps.store.addAudit(key, "replaced");
        } else {
          await deps.store.setValue(key, value);
          await deps.store.addAudit(key, "changed");
        }
        await deps.settingsChanged();
        return json(200, { ok: true });
      }
    }

    if (method === "GET" && route === "ai/models") {
      return json(200, { models: await deps.listModels() });
    }

    if (method === "GET" && route === "ai/effort") {
      return json(200, { effort: await deps.effort.get() });
    }

    if (method === "POST" && route === "ai/effort") {
      const effort = text(request.body, "effort")?.toLowerCase() ?? "";
      if (!isEffortSetting(effort)) {
        return fail(400, "Choose auto, low, medium or high.");
      }
      await deps.effort.set(effort);
      return json(200, { effort });
    }

    if (method === "POST" && route === "ai/test") {
      const model = text(request.body, "model");
      const problem = model
        ? settingDefinition("LLM_MODEL")!.validate(model)
        : "Pick a model.";
      if (problem) return fail(400, problem);
      try {
        return json(200, { ok: true, ...(await deps.testModel(model!)) });
      } catch (error) {
        return json(200, { ok: false, error: reason(error) });
      }
    }

    if (route.startsWith("google")) {
      if (method === "GET" && route === "google") {
        return json(200, deps.google.status());
      }
      if (method === "POST" && route === "google/connect") {
        const stale = needFresh();
        if (stale) return stale;
        try {
          const { url, cookie } = deps.google.start(session.uid, now);
          return json(200, { url }, cookie);
        } catch (error) {
          return fail(400, error instanceof Error ? error.message : "failed");
        }
      }
      if (method === "POST" && route === "google/disconnect") {
        const stale = needFresh();
        if (stale) return stale;
        await deps.google.disconnect();
        return json(200, { ok: true });
      }
      if (method === "POST" && route === "google/check") {
        try {
          return json(200, { ok: true, ...(await deps.google.check()) });
        } catch (error) {
          const message =
            error instanceof Error && error.message.length < 300
              ? error.message
              : reason(error);
          return json(200, { ok: false, error: message });
        }
      }
    }

    if (method === "GET" && route === "setup") {
      return json(200, {
        items: await setupChecklist(deps, new Date(now * 1000)),
      });
    }

    if (route === "telegram" || route === "telegram/connect") {
      const connect = method === "POST" && route === "telegram/connect";
      if (connect || (method === "GET" && route === "telegram")) {
        try {
          const status = connect
            ? await deps.connectTelegram()
            : await deps.telegramStatus();
          if (connect) await deps.store.addAudit("telegram", "connected");
          return json(200, { ok: true, ...status });
        } catch (error) {
          // Telegram's own description is safe to show (it never has the
          // token); anything else is summarised.
          const message =
            error instanceof Error && error.message.length < 200
              ? error.message
              : reason(error);
          return json(200, { ok: false, error: message });
        }
      }
    }

    if (method === "POST" && route === "calendar/check") {
      try {
        await deps.checkCalendar();
        return json(200, { ok: true });
      } catch (error) {
        return json(200, { ok: false, error: reason(error) });
      }
    }

    if (method === "GET" && route === "timetable") {
      return json(200, { text: await deps.describeTimetable() });
    }

    if (method === "POST" && route === "timetable") {
      const link = text(request.body, "link");
      if (!link) return fail(400, "Paste your NUSMods share link.");
      const result = await deps.importTimetable(link);
      if (result.startsWith("Saved")) {
        await deps.store.addAudit("timetable", "NUSMods link saved");
      }
      return json(200, { text: result });
    }

    const calendar = await calendarRoute(
      method,
      route,
      request.body,
      deps.calendar,
    );
    if (calendar) return json(calendar.status, calendar.body);

    // The Apple Pay shortcut's key: made here, shown once, stored as a hash.
    // Like the other keys, it needs a recent sign-in.
    if (
      (route === "applepay/key" || route === "bankemail/key") &&
      (method === "POST" || method === "DELETE")
    ) {
      const stale = needFresh();
      if (stale) return stale;
      // Apple Pay (iPhone shortcut) and bank emails (Apps Script) each have
      // their own key.
      const [setting, audit] =
        route === "applepay/key"
          ? [APPLE_PAY_KEY_SETTING, "applepay"]
          : [BANK_EMAIL_KEY_SETTING, "bankemail"];
      if (method === "POST") {
        const key = newApplePayKey();
        await deps.store.setValue(setting, hashApplePayKey(key));
        await deps.store.addAudit(audit, "made a new key");
        await deps.settingsChanged();
        return json(200, { key });
      }
      await deps.store.clearValue(setting);
      await deps.store.addAudit(audit, "turned off");
      await deps.settingsChanged();
      return json(200, { ok: true });
    }

    const planner = await plannerRoute(
      method,
      route,
      request.body,
      deps.planner,
    );
    if (planner) {
      return "download" in planner
        ? { status: 200, body: null, download: planner.download }
        : json(planner.status, planner.body);
    }

    const chat = await chatRoute(
      method,
      route,
      request.body,
      deps.chat,
      request.search,
    );
    if (chat) {
      return "stream" in chat
        ? { status: 200, body: null, stream: chat.stream }
        : json(chat.status, chat.body);
    }

    if (method === "GET" && route === "audit") {
      return json(200, { entries: await deps.store.audit(50) });
    }
  } catch (error) {
    console.error(
      `Website request ${method} ${route} failed (${errorType(error)})`,
    );
    return fail(500, "Something went wrong. Please try again.");
  }

  return fail(404, "Not found.");
}
