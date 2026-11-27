import { afterEach, describe, expect, it, vi } from "vitest";

// The Google client itself isn't needed: count how often it is made.
const made = vi.hoisted(() => ({ count: 0, fail: false }));
vi.mock("../src/calendar/auth.js", () => ({
  createCalendarAuthClient: vi.fn(async () => {
    made.count += 1;
    if (made.fail) throw new Error("bad key");
    return {};
  }),
}));

import { getCalendarGateway } from "../src/calendar/google.js";
import { replaceSettingOverrides } from "../src/setting-overrides.js";

const settings = (key: string) =>
  replaceSettingOverrides(
    new Map([
      ["GOOGLE_CALENDAR_ID", "me@example.com"],
      ["GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", key],
    ]),
  );

afterEach(() => replaceSettingOverrides(new Map()));

describe("the Google Calendar connection", () => {
  it("is reused, rebuilt when the key changes, and retried after a failure", async () => {
    settings("key-one");
    const first = await getCalendarGateway();
    expect(await getCalendarGateway()).toBe(first);
    expect(made.count).toBe(1);

    // A key saved on the website replaces Vercel's.
    settings("key-two");
    expect(await getCalendarGateway()).not.toBe(first);
    expect(made.count).toBe(2);

    // A failed attempt isn't kept.
    settings("key-three");
    made.fail = true;
    await expect(getCalendarGateway()).rejects.toThrow("bad key");
    made.fail = false;
    await expect(getCalendarGateway()).resolves.toBeDefined();
    expect(made.count).toBe(4);
  });
});
