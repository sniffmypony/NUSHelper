import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/calendar/google.js", () => ({ getCalendarGateway: vi.fn() }));

import { hasBearerSecret, isVercelCron } from "../src/scheduled-jobs.js";

describe("scheduled job secrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the exact bearer secret", () => {
    expect(hasBearerSecret("Bearer s3cret", "s3cret")).toBe(true);
    expect(hasBearerSecret("Bearer s3cret", "  s3cret\n")).toBe(true);
    expect(hasBearerSecret("Bearer s3cre", "s3cret")).toBe(false);
    expect(hasBearerSecret("Bearer s3cretX", "s3cret")).toBe(false);
    expect(hasBearerSecret("s3cret", "s3cret")).toBe(false);
    expect(hasBearerSecret("bearer s3cret", "s3cret")).toBe(false);
    expect(hasBearerSecret(undefined, "s3cret")).toBe(false);
  });

  it("never matches when the secret is not set", () => {
    expect(hasBearerSecret("Bearer ", undefined)).toBe(false);
    expect(hasBearerSecret("Bearer ", "   ")).toBe(false);
    expect(hasBearerSecret("Bearer undefined", undefined)).toBe(false);
  });

  it("checks Vercel's cron requests against CRON_SECRET", () => {
    vi.stubEnv("CRON_SECRET", "from-vercel");
    expect(isVercelCron("Bearer from-vercel")).toBe(true);
    expect(isVercelCron("Bearer other")).toBe(false);
    vi.stubEnv("CRON_SECRET", "");
    expect(isVercelCron("Bearer ")).toBe(false);
  });
});
