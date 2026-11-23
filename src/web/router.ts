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

// The website's API (/api/web/...). Everything except the sign-in needs the
// owner's session cookie; changes also need the X-NUSHelper header, which a
// page on another site can't send to us (on top of SameSite=Strict cookies).

export interface WebRequest {
  method: string;
  route: string; // e.g. "settings/LLM_MODEL"
  cookie?: string;
  csrfHeader?: string;
  body?: unknown;
}

export interface WebResponse {
  status: number;
  body: unknown;
  setCookie?: string;
}

export interface WebDependencies {
  botToken(): string;
  ownerId(): string;
  nowSeconds(): number;
  store: SettingsStore;
  env(name: string): string | undefined; // Vercel's value, ignoring the website
  botUsername(): Promise<string>;
  listModels(): Promise<string[]>;
  testModel(model: string): Promise<{ ms: number }>;
  calendarInfo(): { calendarId: string; serviceAccountEmail: string | null };
  checkCalendar(): Promise<void>;
  describeTimetable(): Promise<string>;
  importTimetable(link: string): Promise<string>;
  consumeLoginToken(token: string): Promise<boolean>;
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
      return fail(502, "Couldn't reach Telegram.");
    }
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
    return json(200, {
      authenticated: Boolean(session && session.uid === deps.ownerId()),
      fresh: Boolean(session && isFresh(session, now)),
      expiresAt: session ? (session.iat + SESSION_SECONDS) * 1000 : null,
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
      const [values, secrets] = await Promise.all([
        deps.store.values(),
        deps.store.secrets(),
      ]);
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
