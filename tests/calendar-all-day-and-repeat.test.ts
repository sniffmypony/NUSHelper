import { describe, expect, it, vi } from "vitest";
import type { calendar_v3 } from "@googleapis/calendar";
import { GoogleCalendarGateway } from "../src/calendar/google.js";
import {
  describeRepeat,
  formatCalendarEvent,
  looksLikeCalendarMessage,
  parseCalendarEventMessage,
  recurrenceRule,
  storedCalendarEvent,
  type ParsedCalendarEvent,
} from "../src/calendar/parser.js";
import { FIXED_TIME_ZONE } from "../src/calendar/config.js";

const NOW = new Date("2026-11-20T04:00:00Z"); // Fri 20 Nov 2026, noon in Singapore

function parse(line: string): ParsedCalendarEvent {
  const result = parseCalendarEventMessage(line, NOW);
  if (!result.ok) throw new Error(`could not parse: ${result.error}`);
  return result.event;
}

describe("all-day and repeating calendar lines", () => {
  it("reads an all-day yearly event", () => {
    expect(parse("all day, Mum's birthday, 19-08-2027, yearly")).toMatchObject({
      title: "Mum's birthday",
      startDateTime: "2027-08-19",
      endDateTime: "2027-08-20",
      allDay: true,
      repeat: "yearly",
      isPast: false,
    });
  });

  it("accepts all-day spellings and repeat words", () => {
    expect(parse("All-day, Holiday, 25-12-2026").allDay).toBe(true);
    expect(parse("allday, Holiday, 25-12-2026").repeat).toBeNull();
    expect(parse("all day, Rent, 01-12-2026, every month").repeat).toBe(
      "monthly",
    );
    expect(parse("all day, Anniversary, 06-11-2027, annually").repeat).toBe(
      "yearly",
    );
    expect(parse("5pm-6pm, cs2102 proj, 27-11-2026, weekly")).toMatchObject({
      allDay: false,
      repeat: "weekly",
      startDateTime: "2026-11-27T17:00:00+08:00",
    });
    expect(parse("0900-0930, Standup, 23-11-2026, weekdays").repeat).toBe(
      "weekdays",
    );
  });

  it("rejects an unknown repeat, and keeps three-part lines working", () => {
    expect(
      parseCalendarEventMessage("all day, Thing, 19-08-2027, fortnightly", NOW),
    ).toEqual({ ok: false, error: "repeat" });
    expect(parse("12:00-18:00, Homework, 22-12-2026")).toMatchObject({
      allDay: false,
      repeat: null,
    });
  });

  it("only treats calendar-shaped text as a calendar line", () => {
    expect(
      looksLikeCalendarMessage("all day, Mum's birthday, 19-08-2027"),
    ).toBe(true);
    expect(
      looksLikeCalendarMessage("all day, Mum's birthday, 19-08-2027, yearly"),
    ).toBe(true);
    expect(looksLikeCalendarMessage("all done, thanks, see you")).toBe(false);
    expect(looksLikeCalendarMessage("is it, a, b, c, d")).toBe(false);
  });

  it("marks an all-day event past only after its day", () => {
    expect(parse("all day, Today, 20-11-2026").isPast).toBe(false);
    expect(parse("all day, Yesterday, 19-11-2026").isPast).toBe(true);
  });
});

describe("showing all-day and repeating events", () => {
  it("formats all-day dates and repeats", () => {
    const birthday = parse("all day, Mum's birthday, 19-08-2027, yearly");
    expect(formatCalendarEvent(birthday)).toEqual({
      date: "Thursday, 19 August 2027",
      time: "All day",
    });
    expect(describeRepeat("yearly", birthday.startDateTime)).toBe(
      "Every year on 19 August",
    );
    const meeting = parse("5pm-6pm, cs2102 proj, 06-11-2026, weekly");
    expect(describeRepeat("weekly", meeting.startDateTime)).toBe(
      "Every week on Friday",
    );
    expect(describeRepeat("monthly", meeting.startDateTime)).toBe(
      "Every month on day 6",
    );
  });

  it("reads all-day and repeat back from stored rows", () => {
    expect(
      storedCalendarEvent(
        {
          title: "Mum's birthday",
          startDateTime: "2027-08-19",
          endDateTime: "2027-08-20",
          repeat: "yearly",
        },
        NOW,
      ),
    ).toMatchObject({ allDay: true, repeat: "yearly", isPast: false });
    expect(
      storedCalendarEvent({
        title: "Homework",
        startDateTime: "2026-08-22T12:00:00+08:00",
        endDateTime: "2026-08-22T18:00:00+08:00",
        repeat: null,
      }),
    ).toMatchObject({ allDay: false, repeat: null });
  });

  it("maps repeats to Google's recurrence rules", () => {
    expect(recurrenceRule("daily")).toBe("RRULE:FREQ=DAILY");
    expect(recurrenceRule("weekdays")).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(recurrenceRule("weekly")).toBe("RRULE:FREQ=WEEKLY");
    expect(recurrenceRule("monthly")).toBe("RRULE:FREQ=MONTHLY");
    expect(recurrenceRule("yearly")).toBe("RRULE:FREQ=YEARLY");
  });
});

describe("Google Calendar requests", () => {
  function gateway() {
    const data = { id: "event1", htmlLink: "https://calendar.google.com/x" };
    const events = {
      insert: vi.fn().mockResolvedValue({ data }),
      patch: vi.fn().mockResolvedValue({ data }),
    };
    const client = { events } as unknown as calendar_v3.Calendar;
    return { gateway: new GoogleCalendarGateway(client), events };
  }

  it("creates an all-day yearly event with dates and an RRULE", async () => {
    const subject = gateway();
    await subject.gateway.create(
      "event1",
      parse("all day, Mum's birthday, 19-08-2027, yearly"),
      "op",
      "123",
      4,
    );
    const body = subject.events.insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ date: "2027-08-19" });
    expect(body.end).toEqual({ date: "2027-08-20" });
    expect(body.recurrence).toEqual(["RRULE:FREQ=YEARLY"]);
  });

  it("creates a one-off timed event without a recurrence", async () => {
    const subject = gateway();
    await subject.gateway.create(
      "event1",
      parse("12:00-18:00, Homework, 22-12-2026"),
      "op",
      "123",
      4,
    );
    const body = subject.events.insert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({
      dateTime: "2026-12-22T12:00:00+08:00",
      timeZone: FIXED_TIME_ZONE,
    });
    expect(body).not.toHaveProperty("recurrence");
  });

  it("an edit can switch to timed and stop repeating", async () => {
    const subject = gateway();
    await subject.gateway.update(
      "event1",
      parse("19:00-21:00, Mum's birthday dinner, 19-08-2027"),
    );
    const body = subject.events.patch.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({
      date: null,
      dateTime: "2027-08-19T19:00:00+08:00",
      timeZone: FIXED_TIME_ZONE,
    });
    expect(body.recurrence).toEqual([]);

    await subject.gateway.update(
      "event1",
      parse("all day, Mum's birthday, 19-08-2027, yearly"),
    );
    const allDay = subject.events.patch.mock.calls[1][0].requestBody;
    expect(allDay.start).toEqual({
      date: "2027-08-19",
      dateTime: null,
      timeZone: null,
    });
    expect(allDay.recurrence).toEqual(["RRULE:FREQ=YEARLY"]);
  });
});
