import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarErrorMessage } from "../src/calendar/google.js";
import { isPrivateOwner } from "../src/security.js";

const savedCalendarId = process.env.GOOGLE_CALENDAR_ID;
const savedTimeZone = process.env.DEFAULT_TIMEZONE;

afterEach(() => {
  process.env.GOOGLE_CALENDAR_ID = savedCalendarId;
  process.env.DEFAULT_TIMEZONE = savedTimeZone;
});

// The calendar ID is read when the module loads, as on a cold start.
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("../src/calendar/config.js");
}

describe("calendar configuration and authorization", () => {
  it("uses only the calendar configured at startup", async () => {
    const config = await loadConfig({
      GOOGLE_CALENDAR_ID: "me@example.com",
      DEFAULT_TIMEZONE: "Asia/Singapore",
    });
    expect(config.getCalendarConfig().calendarId).toBe("me@example.com");

    process.env.GOOGLE_CALENDAR_ID = "attacker@example.com";
    expect(() => config.getCalendarConfig()).toThrow(
      "GOOGLE_CALENDAR_ID changed after startup",
    );
  });

  it("rejects a timezone other than Singapore", async () => {
    const config = await loadConfig({
      GOOGLE_CALENDAR_ID: "me@example.com",
      DEFAULT_TIMEZONE: "UTC",
    });
    expect(() => config.getCalendarConfig()).toThrow(
      "DEFAULT_TIMEZONE must be exactly Asia/Singapore",
    );
  });

  it("treats Google Calendar as optional", async () => {
    const off = await loadConfig({ GOOGLE_CALENDAR_ID: undefined });
    expect(off.isCalendarConfigured()).toBe(false);
    expect(off.FIXED_CALENDAR_ID).toBe("");

    const on = await loadConfig({ GOOGLE_CALENDAR_ID: "me@example.com" });
    expect(on.isCalendarConfigured()).toBe(true);
  });

  it("accepts only the numeric owner in a private Telegram chat", () => {
    expect(isPrivateOwner(123, "private", 123)).toBe(true);
    expect(isPrivateOwner(999, "private", 123)).toBe(false);
  });

  it("rejects the owner in a non-private Telegram chat", () => {
    expect(isPrivateOwner(123, "group", 123)).toBe(false);
    expect(isPrivateOwner(123, "supergroup", 123)).toBe(false);
  });

  it("does not echo credentials or internal error messages to the user", () => {
    const secret = "PRIVATE-KEY-MARKER";
    expect(calendarErrorMessage(new Error(secret))).not.toContain(secret);
  });
});
