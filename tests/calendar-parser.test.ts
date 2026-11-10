import { describe, expect, it } from "vitest";
import { FIXED_CALENDAR_ID, FIXED_TIME_ZONE } from "../src/calendar/config.js";
import { parseCalendarEventMessage } from "../src/calendar/parser.js";

const future = new Date("2026-01-01T00:00:00Z");

function event(input: string) {
  const result = parseCalendarEventMessage(input, future);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected parse success");
  return result.event;
}

describe("calendar event parser", () => {
  it("parses deterministic shorthand 12-6", () => {
    const parsed = event("12-6, homework, 22-08-2026");
    expect(parsed).toMatchObject({
      title: "homework",
      timeZone: FIXED_TIME_ZONE,
      startDateTime: "2026-08-22T12:00:00+08:00",
      endDateTime: "2026-08-22T18:00:00+08:00",
    });
  });

  it("parses a 24-hour range", () => {
    const parsed = event("12:30-14:00, Physics revision, 01-09-2026");
    expect(parsed.startDateTime).toBe("2026-09-01T12:30:00+08:00");
    expect(parsed.endDateTime).toBe("2026-09-01T14:00:00+08:00");
  });

  it("parses AM/PM", () => {
    const parsed = event("3pm-5:30pm, Math homework, 01-09-2026");
    expect(parsed.startDateTime).toBe("2026-09-01T15:00:00+08:00");
    expect(parsed.endDateTime).toBe("2026-09-01T17:30:00+08:00");
  });

  it("parses compact AM/PM times", () => {
    const parsed = event("1130am-1pm, tutor, 05-09-2026");
    expect(parsed.startDateTime).toBe("2026-09-05T11:30:00+08:00");
    expect(parsed.endDateTime).toBe("2026-09-05T13:00:00+08:00");
  });

  it("parses compact 24-hour times", () => {
    const parsed = event("1130-1330, tutor, 05-09-2026");
    expect(parsed.startDateTime).toBe("2026-09-05T11:30:00+08:00");
    expect(parsed.endDateTime).toBe("2026-09-05T13:30:00+08:00");
  });

  it("preserves a quoted title containing a comma", () => {
    expect(event('12-6, "Math homework, chapter 4", 22-08-2026').title).toBe(
      "Math homework, chapter 4",
    );
  });

  it("parses a Unicode en dash", () => {
    expect(event("09:00–11:00, Chemistry, 02-09-2026").endDateTime).toBe(
      "2026-09-02T11:00:00+08:00",
    );
  });

  it("parses the word to", () => {
    expect(event("09:00 to 11:00, Chemistry, 02-09-2026").startDateTime).toBe(
      "2026-09-02T09:00:00+08:00",
    );
  });

  it.each([
    "12-6, homework, 22/08/2026",
    "12-6, homework, 2026-08-22",
    "12-6, homework, 22-8-2026",
    "12-6, homework, 2-08-2026",
  ])("rejects unsupported date format: %s", (input) => {
    expect(parseCalendarEventMessage(input, future)).toEqual({
      ok: false,
      error: "date",
    });
  });

  it("rejects an impossible date", () => {
    expect(
      parseCalendarEventMessage("12-6, homework, 31-02-2026", future),
    ).toEqual({ ok: false, error: "date" });
  });

  it("accepts a valid leap day", () => {
    expect(event("12-6, homework, 29-02-2028").startDateTime).toContain(
      "2028-02-29",
    );
  });

  it("rejects a non-leap day", () => {
    expect(
      parseCalendarEventMessage("12-6, homework, 29-02-2025", future),
    ).toEqual({ ok: false, error: "date" });
  });

  it.each([
    "25:00-26:00, Invalid, 22-08-2026",
    "2400-2500, Invalid compact hour, 22-08-2026",
    "1260am-1pm, Invalid compact minute, 22-08-2026",
    "12:00-10:00, Backwards, 22-08-2026",
    "3pm-17:00, Mixed, 22-08-2026",
  ])("rejects an invalid or ambiguous time: %s", (input) => {
    expect(parseCalendarEventMessage(input, future)).toEqual({
      ok: false,
      error: "event",
    });
  });

  it("allows an explicit AM/PM range to cross midnight", () => {
    const parsed = event("11pm-1am, Overnight study, 22-08-2026");
    expect(parsed.endDateTime).toBe("2026-08-23T01:00:00+08:00");
  });

  it("shows a past-event warning flag without rejecting the event", () => {
    const result = parseCalendarEventMessage(
      "12-6, Past, 22-08-2026",
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(result.ok && result.event.isPast).toBe(true);
  });

  it("always returns the fixed calendar and timezone", () => {
    const parsed = event("12-6, title with another@gmail.com, 22-08-2026");
    expect(parsed.calendarId).toBe(FIXED_CALENDAR_ID);
    expect(parsed.timeZone).toBe(FIXED_TIME_ZONE);
  });
});
