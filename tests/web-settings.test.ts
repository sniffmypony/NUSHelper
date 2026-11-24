import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));

import { optionalEnv } from "../src/env.js";
import { replaceSettingOverrides } from "../src/setting-overrides.js";
import { decryptSecret, encryptSecret } from "../src/settings/crypto.js";
import { refreshSettings } from "../src/settings/runtime.js";
import type {
  AuditEntry,
  SettingsStore,
  StoredSecret,
  StoredValue,
} from "../src/settings/store.js";
import {
  SESSION_SECONDS,
  signSession,
  verifySession,
} from "../src/web/session.js";
import { verifyTelegramLogin } from "../src/web/telegram-login.js";
import {
  handleWebRequest,
  type WebDependencies,
  type WebRequest,
} from "../src/web/router.js";

const TOKEN = "123456:test-bot-token";
const OWNER = "424242";
const NOW = 1_795_400_000; // seconds

function signLogin(fields: Record<string, string | number>, token = TOKEN) {
  const check = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  return {
    ...fields,
    hash: createHmac("sha256", secret).update(check).digest("hex"),
  };
}

class MemoryStore implements SettingsStore {
  valueRows = new Map<string, StoredValue>();
  secretRows = new Map<string, StoredSecret>();
  log: AuditEntry[] = [];
  async values() {
    return new Map(this.valueRows);
  }
  async secrets() {
    return new Map(this.secretRows);
  }
  async setValue(key: string, value: string) {
    this.valueRows.set(key, { value, updatedAt: new Date() });
  }
  async clearValue(key: string) {
    this.valueRows.delete(key);
  }
  async setSecret(key: string, ciphertext: string, lastFour: string) {
    this.secretRows.set(key, { ciphertext, lastFour, updatedAt: new Date() });
  }
  async clearSecret(key: string) {
    this.secretRows.delete(key);
  }
  async addAudit(key: string, action: string) {
    this.log.unshift({ key, action, createdAt: new Date() });
  }
  async audit(limit: number) {
    return this.log.slice(0, limit);
  }
}

function setup(now = NOW) {
  const store = new MemoryStore();
  const deps: WebDependencies = {
    botToken: () => TOKEN,
    ownerId: () => OWNER,
    nowSeconds: () => now,
    store,
    env: (name) =>
      ({ SOCLAAS_MODEL: "x-test-4", SOCLAAS_API_KEY: "vercel-key-1234" })[name],
    botUsername: async () => "hr_helper_bot",
    listModels: async () => ["qwen3.6:35b", "x-test-4"],
    testModel: vi.fn(async () => ({ ms: 420 })),
    calendarInfo: () => ({
      calendarId: "me@example.com",
      serviceAccountEmail: "bot@project.iam.gserviceaccount.com",
    }),
    checkCalendar: vi.fn(async () => {}),
    describeTimetable: async () => "No timetable is saved.",
    importTimetable: vi.fn(async () => "Saved your Semester 1 timetable"),
    consumeLoginToken: vi.fn(
      async (token: string) => token === "good-token-abcdefghijklmnop",
    ),
    settingsChanged: vi.fn(async () => {}),
    calendar: {} as WebDependencies["calendar"],
    chat: {} as WebDependencies["chat"],
  };
  const cookieFor = (authAt = now, iat = now, v = 0) =>
    `nh_session=${signSession({ uid: OWNER, iat, authAt, v }, TOKEN)}`;
  const call = (request: Partial<WebRequest>) =>
    handleWebRequest(
      {
        method: "GET",
        route: "",
        csrfHeader:
          request.method && request.method !== "GET" ? "1" : undefined,
        ...request,
      },
      deps,
    );
  return { store, deps, cookieFor, call };
}

describe("Telegram sign-in check", () => {
  const fields = { id: Number(OWNER), first_name: "HR", auth_date: NOW - 30 };

  it("accepts data Telegram signed, and rejects anything changed", () => {
    expect(verifyTelegramLogin(signLogin(fields), TOKEN, NOW)).toEqual({
      ok: true,
      id: OWNER,
      authDate: NOW - 30,
    });
    expect(
      verifyTelegramLogin({ ...signLogin(fields), id: 1 }, TOKEN, NOW),
    ).toEqual({ ok: false, reason: "bad-signature" });
    expect(
      verifyTelegramLogin(signLogin(fields, "other:token"), TOKEN, NOW),
    ).toEqual({ ok: false, reason: "bad-signature" });
    expect(verifyTelegramLogin({ id: 1 }, TOKEN, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses an old sign-in, so it can't be replayed", () => {
    expect(
      verifyTelegramLogin(
        signLogin({ ...fields, auth_date: NOW - 11 * 60 }),
        TOKEN,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });
});

describe("sessions", () => {
  const session = { uid: OWNER, iat: NOW, authAt: NOW, v: 0 };

  it("last 60 days and can't be forged", () => {
    const token = signSession(session, TOKEN);
    expect(verifySession(token, TOKEN, NOW + SESSION_SECONDS, 0)).toEqual(
      session,
    );
    expect(
      verifySession(token, TOKEN, NOW + SESSION_SECONDS + 1, 0),
    ).toBeNull();
    expect(verifySession(token, "other:token", NOW, 0)).toBeNull();
    const [payload] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...session, uid: "1" }),
    ).toString("base64url");
    expect(
      verifySession(token.replace(payload, forged), TOKEN, NOW, 0),
    ).toBeNull();
  });

  it("stop working after Sign out everywhere", () => {
    expect(
      verifySession(signSession(session, TOKEN), TOKEN, NOW, 1),
    ).toBeNull();
  });
});

describe("encrypted keys", () => {
  it("round-trip, and can't be read with another bot token", () => {
    const stored = encryptSecret("sk-live-abcdef", TOKEN);
    expect(stored).not.toContain("sk-live");
    expect(decryptSecret(stored, TOKEN)).toBe("sk-live-abcdef");
    expect(decryptSecret(stored, "other:token")).toBeNull();
    expect(decryptSecret("garbage", TOKEN)).toBeNull();
  });
});

describe("website settings override Vercel's", () => {
  afterEach(() => {
    replaceSettingOverrides(new Map());
    vi.unstubAllEnvs();
  });

  it("are read first, for every alias, and fall back to Vercel", async () => {
    vi.stubEnv("SOCLAAS_MODEL", "x-test-4");
    vi.stubEnv("BOT_TOKEN", TOKEN);
    expect(optionalEnv("LLM_MODEL", "SOCLAAS_MODEL")).toBe("x-test-4");

    const store = new MemoryStore();
    await store.setValue("LLM_MODEL", "qwen3.6:35b");
    await store.setSecret(
      "LLM_API_KEY",
      encryptSecret("website-key-9999", TOKEN),
      "9999",
    );
    await refreshSettings(store, Date.now() + 10 * 60_000);
    expect(optionalEnv("LLM_MODEL", "SOCLAAS_MODEL")).toBe("qwen3.6:35b");
    expect(optionalEnv("LLM_API_KEY", "SOCLAAS_API_KEY")).toBe(
      "website-key-9999",
    );

    await store.clearValue("LLM_MODEL");
    await refreshSettings(store, Date.now() + 20 * 60_000);
    expect(optionalEnv("LLM_MODEL", "SOCLAAS_MODEL")).toBe("x-test-4");
  });

  it("keep the last values when the database can't be read", async () => {
    replaceSettingOverrides(new Map([["LLM_MODEL", "kept"]]));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new MemoryStore();
    broken.values = async () => {
      throw new Error("db down");
    };
    await refreshSettings(broken, Date.now() + 30 * 60_000);
    expect(optionalEnv("LLM_MODEL")).toBe("kept");
    error.mockRestore();
  });
});

describe("website API", () => {
  it("signs in only the owner, with a 60-day cookie", async () => {
    const { call } = setup();
    const owner = await call({
      method: "POST",
      route: "auth/telegram",
      body: signLogin({ id: Number(OWNER), auth_date: NOW }),
    });
    expect(owner.status).toBe(200);
    expect(owner.setCookie).toMatch(
      /^nh_session=.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=5184000$/,
    );

    const stranger = await call({
      method: "POST",
      route: "auth/telegram",
      body: signLogin({ id: 999, auth_date: NOW }),
    });
    expect(stranger.status).toBe(403);
    expect(stranger.setCookie).toBeUndefined();
  });

  it("needs a session and the request header", async () => {
    const { call, cookieFor } = setup();
    expect((await call({ route: "settings" })).status).toBe(401);
    expect(
      (
        await call({
          method: "PUT",
          route: "settings/LLM_MODEL",
          cookie: cookieFor(),
          csrfHeader: undefined,
          body: { value: "qwen3.6:35b" },
        })
      ).status,
    ).toBe(403);
  });

  it("shows where each setting comes from, never a key", async () => {
    const { call, cookieFor, store } = setup();
    await store.setSecret(
      "CANVAS_API_TOKEN",
      encryptSecret("canvas-secret-7777", TOKEN),
      "7777",
    );
    const response = await call({ route: "settings", cookie: cookieFor() });
    const body = response.body as {
      settings: Array<{ key: string; value: string; source: string }>;
      secrets: Array<{ key: string; source: string; lastFour: string | null }>;
    };
    expect(body.settings.find((s) => s.key === "LLM_MODEL")).toMatchObject({
      value: "x-test-4",
      source: "vercel",
    });
    expect(body.secrets).toEqual([
      expect.objectContaining({
        key: "LLM_API_KEY",
        source: "vercel",
        lastFour: null,
      }),
      expect.objectContaining({
        key: "CANVAS_API_TOKEN",
        source: "website",
        lastFour: "7777",
      }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain("canvas-secret");
    expect(JSON.stringify(response.body)).not.toContain("vercel-key");
  });

  it("validates and saves settings, then reloads them", async () => {
    const { call, cookieFor, store, deps } = setup();
    const save = (value: string) =>
      call({
        method: "PUT",
        route: "settings/LLM_MODEL",
        cookie: cookieFor(),
        body: { value },
      });
    expect((await save("bad model!")).status).toBe(400);
    expect((await save("qwen3.6:35b")).status).toBe(200);
    expect(store.valueRows.get("LLM_MODEL")?.value).toBe("qwen3.6:35b");
    expect(deps.settingsChanged).toHaveBeenCalled();
    expect(store.log[0]).toMatchObject({ key: "LLM_MODEL", action: "changed" });
    expect(
      (
        await call({
          method: "PUT",
          route: "settings/LLM_API_KEY",
          cookie: cookieFor(),
          body: { value: "x" },
        })
      ).status,
    ).toBe(404);
  });

  it("switches calendars only to one the bot can read", async () => {
    const { call, cookieFor, store, deps } = setup();
    const save = (value: string) =>
      call({
        method: "PUT",
        route: "settings/GOOGLE_CALENDAR_ID",
        cookie: cookieFor(),
        body: { value },
      });
    expect((await save("not a calendar")).status).toBe(400);
    expect(deps.checkCalendar).not.toHaveBeenCalled();

    vi.mocked(deps.checkCalendar).mockRejectedValueOnce(
      Object.assign(new Error("nope"), { status: 404 }),
    );
    const refused = await save("other@example.com");
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("HTTP 404");
    expect(store.valueRows.has("GOOGLE_CALENDAR_ID")).toBe(false);

    expect((await save("other@example.com")).status).toBe(200);
    expect(deps.checkCalendar).toHaveBeenLastCalledWith("other@example.com");
    expect(store.valueRows.get("GOOGLE_CALENDAR_ID")?.value).toBe(
      "other@example.com",
    );
  });

  it("needs a fresh sign-in to change keys, and stores them encrypted", async () => {
    const { call, cookieFor, store } = setup();
    const put = (cookie: string) =>
      call({
        method: "PUT",
        route: "secrets/LLM_API_KEY",
        cookie,
        body: { value: "new-soclaas-key-4321" },
      });
    const stale = await put(cookieFor(NOW - 11 * 60, NOW - 11 * 60));
    expect(stale.status).toBe(401);
    expect((await put(cookieFor())).status).toBe(200);
    const saved = store.secretRows.get("LLM_API_KEY")!;
    expect(saved.lastFour).toBe("4321");
    expect(saved.ciphertext).not.toContain("soclaas");
    expect(decryptSecret(saved.ciphertext, TOKEN)).toBe("new-soclaas-key-4321");
  });

  it("signs out every session", async () => {
    const { call, cookieFor } = setup();
    const out = await call({
      method: "POST",
      route: "auth/logout-all",
      cookie: cookieFor(),
    });
    expect(out.status).toBe(200);
    expect(
      (await call({ route: "settings", cookie: cookieFor() })).status,
    ).toBe(401);
    expect(
      (await call({ route: "settings", cookie: cookieFor(NOW, NOW, 1) }))
        .status,
    ).toBe(200);
  });

  it("lists and tests models, checks Calendar and saves a timetable", async () => {
    const { call, cookieFor, store } = setup();
    const cookie = cookieFor();
    expect((await call({ route: "ai/models", cookie })).body).toEqual({
      models: ["qwen3.6:35b", "x-test-4"],
    });
    expect(
      (
        await call({
          method: "POST",
          route: "ai/test",
          cookie,
          body: { model: "qwen3.6:35b" },
        })
      ).body,
    ).toEqual({ ok: true, ms: 420 });
    expect(
      (await call({ method: "POST", route: "calendar/check", cookie })).body,
    ).toEqual({ ok: true });
    expect(
      (
        await call({
          method: "POST",
          route: "timetable",
          cookie,
          body: {
            link: "https://nusmods.com/timetable/sem-1/share?CS2102=LEC:1",
          },
        })
      ).body,
    ).toEqual({ text: "Saved your Semester 1 timetable" });
    expect(store.log[0]).toMatchObject({ key: "timetable" });
  });
});

describe("one query at a time on the single database connection", () => {
  // Supabase's transaction pooler can hang on queries pipelined on one
  // connection, which stalled every request when settings were read in
  // parallel.
  function trackingStore() {
    const store = new MemoryStore();
    let inFlight = 0;
    let most = 0;
    const track =
      <T>(read: () => Promise<T>) =>
      async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return read();
      };
    store.values = track(store.values.bind(store));
    store.secrets = track(store.secrets.bind(store));
    return { store, most: () => most };
  }

  it("when loading settings for the bot", async () => {
    const { store, most } = trackingStore();
    await refreshSettings(store, Date.now() + 60 * 60_000);
    expect(most()).toBe(1);
    replaceSettingOverrides(new Map());
  });

  it("when the website lists settings", async () => {
    const { call, cookieFor, deps } = setup();
    const { store, most } = trackingStore();
    deps.store = store;
    expect(
      (await call({ route: "settings", cookie: cookieFor() })).status,
    ).toBe(200);
    expect(most()).toBe(1);
  });
});
