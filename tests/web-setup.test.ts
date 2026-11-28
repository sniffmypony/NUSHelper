import { afterEach, describe, expect, it } from "vitest";
import { replaceSettingOverrides } from "../src/setting-overrides.js";
import {
  features,
  setupChecklist,
  type SetupDependencies,
} from "../src/web/setup.js";

const NOW = new Date("2026-11-27T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function deps(overrides: Partial<SetupDependencies> = {}): SetupDependencies {
  return {
    telegramStatus: async () => ({
      expectedUrl: "https://site/api/webhook",
      url: "https://site/api/webhook",
      connected: true,
      pendingUpdates: 0,
      lastError: null,
      lastErrorAt: null,
    }),
    features: () => ({ ai: true, calendar: true, canvas: true }),
    dispatchLastRun: async () => minutesAgo(1),
    hasTimetable: async () => true,
    assistantGoogle: () => true,
    ...overrides,
  };
}

const done = async (d: SetupDependencies) =>
  Object.fromEntries(
    (await setupChecklist(d, NOW)).map((item) => [item.key, item.done]),
  );

afterEach(() => replaceSettingOverrides(new Map()));

describe("the setup checklist", () => {
  it("is all done on a set-up copy", async () => {
    expect(Object.values(await done(deps()))).toEqual(Array(7).fill(true));
  });

  it("notices a job that stopped, never ran, or can't be checked", async () => {
    expect(
      (await done(deps({ dispatchLastRun: async () => minutesAgo(30) })))
        .dispatch,
    ).toBe(false);
    expect(
      (await done(deps({ dispatchLastRun: async () => null }))).dispatch,
    ).toBe(false);
    expect(
      (await done(deps({ dispatchLastRun: async () => undefined }))).dispatch,
    ).toBeNull();
  });

  it("says so when Telegram can't be asked", async () => {
    const items = await setupChecklist(
      deps({
        telegramStatus: async () => {
          throw new Error("Unauthorized");
        },
      }),
      NOW,
    );
    expect(items[0]).toMatchObject({ key: "telegram", done: null });
    expect(items[0].detail).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("marks Calendar, Canvas and the timetable optional", async () => {
    const items = await setupChecklist(deps(), NOW);
    expect(
      items.filter((item) => item.optional).map((item) => item.key),
    ).toEqual(["calendar", "assistant-google", "canvas", "timetable"]);
  });
});

describe("which features are set up", () => {
  it("needs every AI value, a calendar with a Google key, and both Canvas values", () => {
    replaceSettingOverrides(new Map([["LLM_API_KEY", "k"]]));
    expect(features()).toEqual({ ai: false, calendar: false, canvas: false });
    replaceSettingOverrides(
      new Map([
        ["LLM_API_KEY", "k"],
        ["LLM_BASE_URL", "https://api.example/v1"],
        ["LLM_MODEL", "m"],
        ["GOOGLE_CALENDAR_ID", "me@example.com"],
        ["CANVAS_API_TOKEN", "t"],
        ["CANVAS_BASE_URL", "https://canvas.example"],
      ]),
    );
    expect(features()).toEqual({ ai: true, calendar: false, canvas: true });
    replaceSettingOverrides(
      new Map([
        ["GOOGLE_CALENDAR_ID", "me@example.com"],
        ["GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", "e30="],
      ]),
    );
    expect(features().calendar).toBe(true);
  });
});
