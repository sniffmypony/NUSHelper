import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import {
  addBirthdays,
  birthdayEvent,
  birthdayEventId,
  birthdayView,
  listBirthdays,
  readBirthdayEvent,
  readBirthdayLines,
  REMINDER_MINUTES,
} from "../src/birthdays.js";
import type { BirthdayCalendar } from "../src/calendar/google.js";
import type { PlannerActions } from "../src/web/planner-actions.js";
import { plannerRoute } from "../src/web/planner-routes.js";

const TODAY = DateTime.fromISO("2026-11-27T10:00:00", {
  zone: "Asia/Singapore",
});

describe("pasting birthdays", () => {
  it("reads one per line in the usual ways of writing a date", () => {
    const { birthdays, rejected } = readBirthdayLines(
      [
        "Alice Tan 14/03",
        "15-04-2004 Bob",
        "Charlie, 3rd June",
        "Dana: Dec 25, 2003",
        "2005-01-09 Ethan Lim",
        "Fiona 7.8.05",
        "  ",
        "Gina's birthday 1 Feb",
      ].join("\n"),
      TODAY,
    );
    expect(rejected).toEqual([]);
    expect(birthdays).toEqual([
      { name: "Alice Tan", month: 3, day: 14, year: null },
      { name: "Bob", month: 4, day: 15, year: 2004 },
      { name: "Charlie", month: 6, day: 3, year: null },
      { name: "Dana", month: 12, day: 25, year: 2003 },
      { name: "Ethan Lim", month: 1, day: 9, year: 2005 },
      { name: "Fiona", month: 8, day: 7, year: 2005 },
      { name: "Gina", month: 2, day: 1, year: null },
    ]);
  });

  it("says which lines it couldn't use, and why", () => {
    const { birthdays, rejected } = readBirthdayLines(
      [
        "Alice 14/03",
        "Bob sometime in March",
        "Charlie 31/04",
        "14/03",
        "Dana 29/02/2005",
        "Ethan 1/1/2030",
        "alice 14 Mar",
      ].join("\n"),
      TODAY,
    );
    expect(birthdays).toHaveLength(1);
    expect(rejected.map((r) => [r.line, r.reason])).toEqual([
      [2, "No date found. Write it like 14/03 or 14 Mar."],
      [3, "That date doesn't exist (dates are day first)."],
      [4, "Add the person's name."],
      [5, "That date doesn't exist (dates are day first)."],
      [6, "The year looks wrong."],
    ]);
  });

  it("allows 29 Feb without a year", () => {
    expect(readBirthdayLines("Leap 29 Feb", TODAY).birthdays).toEqual([
      { name: "Leap", month: 2, day: 29, year: null },
    ]);
  });
});

describe("the Google Calendar event", () => {
  const alice = { name: "Alice Tan", month: 3, day: 14, year: 2004 };

  it("is a yearly all-day event, reminded at 9am the day before", () => {
    expect(birthdayEvent(alice, TODAY)).toMatchObject({
      summary: "🎂 Alice Tan's birthday",
      description: "Born 2004. Added by NUSHelper.",
      start: { date: "2026-03-14" },
      end: { date: "2026-03-15" },
      recurrence: ["RRULE:FREQ=YEARLY"],
      transparency: "transparent",
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 900 }],
      },
    });
    expect(REMINDER_MINUTES).toBe(15 * 60);
  });

  it("puts 29 Feb on the last day of February", () => {
    const leap = birthdayEvent(
      { name: "Leap", month: 2, day: 29, year: null },
      TODAY,
    );
    expect(leap.start).toEqual({ date: "2026-02-28" });
    expect(leap.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1",
    ]);
  });

  it("has a stable id, so the same person isn't added twice", () => {
    const id = birthdayEventId(alice);
    expect(id).toMatch(/^bday[0-9a-f]{28}$/);
    expect(birthdayEventId({ ...alice, name: "alice  tan", year: null })).toBe(
      id,
    );
    expect(birthdayEventId({ ...alice, day: 15 })).not.toBe(id);
  });

  it("reads back only its own events", () => {
    const event = { ...birthdayEvent(alice, TODAY), id: "bday1" };
    expect(readBirthdayEvent(event)).toEqual({ id: "bday1", ...alice });
    expect(readBirthdayEvent({ id: "x", summary: "Lecture" })).toBeNull();
    expect(readBirthdayEvent({ ...event, status: "cancelled" })).toBeNull();
  });

  it("counts down to the next one, and the age they turn", () => {
    expect(birthdayView({ id: "a", ...alice }, TODAY)).toEqual({
      id: "a",
      name: "Alice Tan",
      date: "14 Mar",
      year: 2004,
      next: "2027-03-14",
      daysUntil: 107,
      turns: 23,
    });
    const today = birthdayView(
      { id: "b", name: "Bob", month: 11, day: 27, year: null },
      TODAY,
    );
    expect(today).toMatchObject({ daysUntil: 0, turns: null });
  });
});

function fakeCalendar(existing: string[] = [], failOn?: string) {
  const events = new Map<string, unknown>();
  const calendar = {
    listBirthdayEvents: vi.fn(async () =>
      [...events.entries()].map(([id, event]) => ({
        ...(event as object),
        id,
      })),
    ),
    addBirthdayEvent: vi.fn(async (id: string, event: unknown) => {
      if (failOn && JSON.stringify(event).includes(failOn)) {
        throw new Error("503");
      }
      if (existing.includes(id) || events.has(id)) return "exists" as const;
      events.set(id, event);
      return "created" as const;
    }),
    delete: vi.fn(async () => "deleted" as const),
  } satisfies BirthdayCalendar;
  return { calendar, events };
}

describe("adding birthdays to Google Calendar", () => {
  it("adds each one once and lists them soonest first", async () => {
    const { calendar } = fakeCalendar();
    const result = await addBirthdays(
      calendar,
      "Alice 14/03/2004\nBob 2 Dec\nnot a birthday",
      TODAY,
    );
    expect(result).toMatchObject({
      ok: true,
      added: 2,
      existing: 0,
      message: "Added 2 birthdays to Google Calendar. Skipped 1 line.",
    });
    const again = await addBirthdays(calendar, "Bob 2/12", TODAY);
    expect(again.message).toBe(
      "Added 0 birthdays to Google Calendar. 1 was already there.",
    );
    expect(
      (await listBirthdays(calendar, TODAY)).map((b) => [b.name, b.daysUntil]),
    ).toEqual([
      ["Bob", 5],
      ["Alice", 107],
    ]);
  });

  it("stops at a Google error and says how far it got", async () => {
    const { calendar } = fakeCalendar([], "Bob");
    const result = await addBirthdays(
      calendar,
      "Alice 14/03\nBob 2/12\nCara 3/12",
      TODAY,
      () => "Google Calendar is temporarily unavailable.",
    );
    expect(result).toMatchObject({
      ok: true,
      added: 1,
      message:
        "Added 1 birthday, then stopped: Google Calendar is temporarily unavailable.",
    });
    expect(calendar.addBirthdayEvent).toHaveBeenCalledTimes(2);
  });

  it("refuses a paste with no usable line", async () => {
    const { calendar } = fakeCalendar();
    const result = await addBirthdays(calendar, "hello", TODAY);
    expect(result.ok).toBe(false);
    expect(calendar.addBirthdayEvent).not.toHaveBeenCalled();
  });
});

describe("birthday routes", () => {
  const actions = () =>
    ({
      birthdays: vi.fn(async () => ({ configured: true, birthdays: [] })),
      checkBirthdays: vi.fn(async () => ({ birthdays: [], rejected: [] })),
      addBirthdays: vi.fn(async () => ({
        ok: true,
        message: "Added 1 birthday to Google Calendar.",
        added: 1,
        existing: 0,
        rejected: [],
      })),
      deleteBirthday: vi.fn(async () => ({ ok: true, message: "Removed" })),
    }) as unknown as PlannerActions & Record<string, ReturnType<typeof vi.fn>>;

  it("checks the paste before adding it", async () => {
    const a = actions();
    expect(
      (await plannerRoute("POST", "birthdays", { text: "" }, a))?.status,
    ).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => `P${i} 1/1`).join(
      "\n",
    );
    expect(
      (await plannerRoute("POST", "birthdays", { text: tooMany }, a))?.status,
    ).toBe(400);
    await plannerRoute("POST", "birthdays/check", { text: "Al 1/1" }, a);
    expect(a.checkBirthdays).toHaveBeenCalledWith("Al 1/1");
    expect(a.addBirthdays).not.toHaveBeenCalled();
    expect(
      (await plannerRoute("POST", "birthdays", { text: "Al 1/1" }, a))?.status,
    ).toBe(200);
  });

  it("removes only birthday events", async () => {
    const a = actions();
    const id = `bday${"a".repeat(28)}`;
    expect(
      (await plannerRoute("DELETE", `birthdays/${id}`, undefined, a))?.status,
    ).toBe(200);
    expect(a.deleteBirthday).toHaveBeenCalledWith(id);
    expect(
      (await plannerRoute("DELETE", "birthdays/lecture123", undefined, a))
        ?.status,
    ).toBe(400);
  });
});
