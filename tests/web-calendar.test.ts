import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));

import {
  calendarRange,
  rangeProblem,
  type CalendarSources,
} from "../src/web/calendar.js";
import type { CalendarActions } from "../src/web/calendar-actions.js";
import { calendarRoute } from "../src/web/calendar-routes.js";

function sources(overrides: Partial<CalendarSources> = {}): CalendarSources {
  return {
    spending: async () => [
      { spendDate: "2026-11-23", totalCents: 790, status: "logged" },
    ],
    reminders: async () => [
      {
        id: 41,
        description: "Ask Iggy about the poll",
        scheduledAt: new Date("2026-11-23T12:11:00Z"), // 20:11 SGT
        status: "sent",
      },
    ],
    tasks: async () => [
      {
        id: 3,
        description: "ER diagram",
        module: "CS2102",
        dueDate: "2026-11-24",
      },
    ],
    deadlines: async () => [
      {
        moduleCode: "CS2102",
        name: "Project Part 2",
        dueAt: new Date("2026-11-24T15:59:00Z"), // 23:59 SGT
        htmlUrl: "https://canvas/1",
      },
    ],
    lessons: async () => [
      {
        acadYear: "2026-2027",
        semester: 1,
        moduleCode: "HSI1000",
        lessonType: "Workshop",
        day: 2,
        startTime: "0900",
        endTime: "1200",
        venue: "S16-0208",
        weeks: [3, 7, 11],
      },
    ],
    events: async () => [
      {
        id: "a1",
        title: "Final: CS2102",
        htmlLink: null,
        allDay: false,
        startDateTime: "2026-11-28T13:00:00+08:00",
        endDateTime: "2026-11-28T15:00:00+08:00",
      },
      {
        id: "b2",
        title: "Trip",
        htmlLink: null,
        allDay: true,
        startDate: "2026-11-27",
        endDate: "2026-11-29",
      },
    ],
    ...overrides,
  };
}

describe("calendar range", () => {
  it("puts each item on its Singapore day", async () => {
    const range = await calendarRange(
      "2026-11-23",
      "2026-11-29",
      sources(),
      new Date("2026-11-23T00:00:00Z"),
    );
    const day = (date: string) => range.days[date];
    expect(Object.keys(range.days)).toHaveLength(7);
    expect(day("2026-11-23")).toMatchObject({
      week: expect.stringContaining("Exam Week 1"),
      spending: { cents: 790, status: "logged" },
      reminders: [
        { id: 41, time: "20:11", description: "Ask Iggy about the poll" },
      ],
    });
    expect(day("2026-11-24").tasks).toEqual([
      { id: 3, description: "ER diagram", module: "CS2102" },
    ]);
    expect(day("2026-11-24").deadlines).toEqual([
      {
        moduleCode: "CS2102",
        name: "Project Part 2",
        time: "23:59",
        url: "https://canvas/1",
      },
    ]);
    // Multi-day all-day events appear on each day, before timed ones.
    expect(day("2026-11-27").events.map((e) => e.title)).toEqual(["Trip"]);
    expect(day("2026-11-28").events).toEqual([
      expect.objectContaining({ title: "Trip", allDay: true }),
      expect.objectContaining({
        title: "Final: CS2102",
        start: "13:00",
        end: "15:00",
      }),
    ]);
    expect(day("2026-11-29").events).toEqual([]);
    // Exam weeks have no classes.
    expect(day("2026-11-24").classes).toEqual([]);
  });

  it("leaves out reminders whose time has passed, but keeps past events", async () => {
    const range = await calendarRange(
      "2026-11-23",
      "2026-11-29",
      sources({
        reminders: async () => [
          {
            id: 1,
            description: "Already sent",
            scheduledAt: new Date("2026-11-23T12:11:00Z"),
            status: "sent",
          },
          {
            id: 2,
            description: "Due this minute",
            scheduledAt: new Date("2026-11-23T13:00:00Z"),
            status: "pending",
          },
          {
            id: 3,
            description: "Later tonight",
            scheduledAt: new Date("2026-11-23T14:30:00Z"),
            status: "pending",
          },
        ],
      }),
      new Date("2026-11-23T13:00:00Z"), // 21:00 in Singapore
    );
    expect(
      range.days["2026-11-23"].reminders.map((r) => r.description),
    ).toEqual(["Later tonight"]);
    const past = await calendarRange(
      "2026-11-28",
      "2026-11-28",
      sources(),
      new Date("2026-12-01T00:00:00Z"),
    );
    expect(past.days["2026-11-28"].events.length).toBeGreaterThan(0);
  });

  it("shows classes only in the weeks they run", async () => {
    const range = await calendarRange("2026-08-25", "2026-09-01", sources());
    expect(range.days["2026-08-25"].classes).toEqual([
      {
        moduleCode: "HSI1000",
        lessonType: "Workshop",
        start: "09:00",
        end: "12:00",
        venue: "S16-0208",
      },
    ]);
    expect(range.days["2026-09-01"].classes).toEqual([]); // week 4
  });

  it("reads one source at a time", async () => {
    let inFlight = 0;
    let most = 0;
    const slow =
      <T>(value: T) =>
      async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 3));
        inFlight -= 1;
        return value;
      };
    await calendarRange("2026-11-23", "2026-11-29", {
      spending: slow([]),
      reminders: slow([]),
      tasks: slow([]),
      deadlines: slow([]),
      lessons: slow([]),
      events: slow([]),
    });
    expect(most).toBe(1);
  });

  it("still shows the rest when Google Calendar fails or isn't set up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = await calendarRange(
      "2026-11-23",
      "2026-11-23",
      sources({
        events: async () => {
          throw new Error("401");
        },
      }),
    );
    expect(failing.eventsError).toBe("Couldn't read Google Calendar just now.");
    expect(failing.days["2026-11-23"].spending).not.toBeNull();
    const off = await calendarRange(
      "2026-11-23",
      "2026-11-23",
      sources({ events: null }),
    );
    expect(off.eventsError).toBeNull();
  });

  it("limits ranges to six weeks", () => {
    expect(rangeProblem("2026-11-01", "2026-12-12")).toBeNull();
    expect(rangeProblem("2026-11-01", "2026-12-13")).toBe(
      "At most 42 days at a time.",
    );
    expect(rangeProblem("2026-11-02", "2026-11-01")).not.toBeNull();
    expect(rangeProblem("2026-02-30", "2026-03-01")).not.toBeNull();
  });
});

describe("calendar routes", () => {
  function actions() {
    const ok = { ok: true, message: "done" };
    return {
      range: vi.fn(async () => ({
        start: "",
        end: "",
        days: {},
        eventsError: null,
      })),
      changeSpending: vi.fn(async () => ok),
      addReminder: vi.fn(async () => ok),
      moveReminder: vi.fn(async () => ok),
      cancelReminder: vi.fn(async () => ({
        ok: false,
        message: "already sent",
      })),
      addEvent: vi.fn(async () => ok),
      deleteEvent: vi.fn(async () => ok),
    } satisfies CalendarActions;
  }

  it("adds and removes spending in cents", async () => {
    const a = actions();
    expect(
      (
        await calendarRoute(
          "POST",
          "spending",
          { date: "2026-11-23", amount: "5 2.40", mode: "add" },
          a,
        )
      )?.status,
    ).toBe(200);
    expect(a.changeSpending).toHaveBeenCalledWith("2026-11-23", 740, "add");
    expect(
      (
        await calendarRoute(
          "POST",
          "spending",
          { date: "2026-11-23", amount: "abc", mode: "add" },
          a,
        )
      )?.status,
    ).toBe(400);
  });

  it("adds, moves and cancels reminders", async () => {
    const a = actions();
    await calendarRoute(
      "POST",
      "reminders",
      { date: "2026-11-25", time: "09:30", description: "Pay rent" },
      a,
    );
    expect(a.addReminder).toHaveBeenCalledWith(
      "2026-11-25",
      "09:30",
      "Pay rent",
    );
    await calendarRoute(
      "PATCH",
      "reminders/41",
      { date: "2026-11-26", time: "21:00" },
      a,
    );
    expect(a.moveReminder).toHaveBeenCalledWith(41, "2026-11-26", "21:00");
    const cancelled = await calendarRoute(
      "DELETE",
      "reminders/41",
      undefined,
      a,
    );
    expect(cancelled).toEqual({ status: 422, body: { error: "already sent" } });
    expect(
      (
        await calendarRoute(
          "POST",
          "reminders",
          { date: "2026-11-25", time: "9:30", description: "x" },
          a,
        )
      )?.status,
    ).toBe(400);
  });

  it("builds the same calendar line the bot accepts", async () => {
    const a = actions();
    await calendarRoute(
      "POST",
      "events",
      {
        date: "2026-11-27",
        title: "Planning, phase 2",
        start: "14:00",
        end: "16:30",
      },
      a,
    );
    expect(a.addEvent).toHaveBeenCalledWith(
      '14:00-16:30, "Planning, phase 2", 27-11-2026',
    );
    await calendarRoute(
      "POST",
      "events",
      {
        date: "2027-08-19",
        title: "Mum's birthday",
        allDay: true,
        repeat: "yearly",
      },
      a,
    );
    expect(a.addEvent).toHaveBeenLastCalledWith(
      "all day, Mum's birthday, 19-08-2027, yearly",
    );
    expect(
      (
        await calendarRoute(
          "POST",
          "events",
          { date: "2027-08-19", title: "x", allDay: true, repeat: "hourly" },
          a,
        )
      )?.status,
    ).toBe(400);
    await calendarRoute("DELETE", "events/abc123def", undefined, a);
    expect(a.deleteEvent).toHaveBeenCalledWith("abc123def");
  });

  it("checks the range and ignores other routes", async () => {
    const a = actions();
    expect(
      (
        await calendarRoute(
          "GET",
          "calendar/2026-11-01/2026-12-31",
          undefined,
          a,
        )
      )?.status,
    ).toBe(400);
    expect(
      (
        await calendarRoute(
          "GET",
          "calendar/2026-11-01/2026-11-30",
          undefined,
          a,
        )
      )?.status,
    ).toBe(200);
    expect(await calendarRoute("GET", "settings", undefined, a)).toBeNull();
  });
});
