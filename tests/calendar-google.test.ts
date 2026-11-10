import { describe, expect, it, vi } from "vitest";
import type { calendar_v3 } from "googleapis";
import { FIXED_CALENDAR_ID, FIXED_TIME_ZONE } from "../src/calendar/config.js";
import { GoogleCalendarGateway } from "../src/calendar/google.js";
import type { ParsedCalendarEvent } from "../src/calendar/parser.js";

function draft(): ParsedCalendarEvent {
  return {
    title: "Homework",
    startDateTime: "2026-08-22T12:00:00+08:00",
    endDateTime: "2026-08-22T18:00:00+08:00",
    calendarId: FIXED_CALENDAR_ID,
    timeZone: FIXED_TIME_ZONE,
    isPast: false,
  };
}

function gateway() {
  const events = {
    list: vi.fn().mockResolvedValue({ data: { items: [] } }),
    get: vi.fn().mockResolvedValue({
      data: { id: "event1", htmlLink: "https://calendar.google.com/event" },
    }),
    insert: vi.fn().mockResolvedValue({
      data: { id: "event1", htmlLink: "https://calendar.google.com/event" },
    }),
    patch: vi.fn().mockResolvedValue({
      data: { id: "event1", htmlLink: "https://calendar.google.com/event" },
    }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  };
  const client = { events } as unknown as calendar_v3.Calendar;
  return { gateway: new GoogleCalendarGateway(client), events };
}

describe("Google Calendar gateway", () => {
  it("performs the startup read check on only the fixed calendar", async () => {
    const subject = gateway();
    await subject.gateway.checkReadable();
    expect(subject.events.list).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: FIXED_CALENDAR_ID }),
    );
  });

  it("paginates and normalizes timed and all-day range results", async () => {
    const subject = gateway();
    subject.events.list
      .mockResolvedValueOnce({
        data: {
          nextPageToken: "next",
          items: [
            {
              id: "timed",
              summary: "Tutorial",
              start: { dateTime: "2026-10-14T18:00:00+08:00" },
              end: { dateTime: "2026-10-14T19:00:00+08:00" },
            },
            { id: "cancelled", status: "cancelled" },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "all-day",
              summary: "Submission",
              start: { date: "2026-10-15" },
              end: { date: "2026-10-16" },
            },
          ],
        },
      });

    await expect(
      subject.gateway.listRange(
        "2026-10-14T00:00:00+08:00",
        "2026-10-17T00:00:00+08:00",
      ),
    ).resolves.toEqual([
      {
        id: "timed",
        title: "Tutorial",
        htmlLink: null,
        allDay: false,
        startDateTime: "2026-10-14T18:00:00+08:00",
        endDateTime: "2026-10-14T19:00:00+08:00",
      },
      {
        id: "all-day",
        title: "Submission",
        htmlLink: null,
        allDay: true,
        startDate: "2026-10-15",
        endDate: "2026-10-16",
      },
    ]);
    expect(subject.events.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageToken: "next", singleEvents: true }),
    );
  });

  it("creates with the fixed calendar, timezone, no attendees, and no updates", async () => {
    const subject = gateway();
    await subject.gateway.create("event1", draft(), "op", "123", 4);
    expect(subject.events.insert).toHaveBeenCalledWith({
      calendarId: FIXED_CALENDAR_ID,
      sendUpdates: "none",
      requestBody: expect.objectContaining({
        summary: "Homework",
        start: {
          dateTime: "2026-08-22T12:00:00+08:00",
          timeZone: FIXED_TIME_ZONE,
        },
        end: {
          dateTime: "2026-08-22T18:00:00+08:00",
          timeZone: FIXED_TIME_ZONE,
        },
      }),
    });
    expect(
      subject.events.insert.mock.calls[0][0].requestBody.attendees,
    ).toBeUndefined();
  });

  it("rejects an attempted calendar override before calling Google", async () => {
    const subject = gateway();
    const unsafe = {
      ...draft(),
      calendarId: "other@example.com",
    } as unknown as ParsedCalendarEvent;
    await expect(
      subject.gateway.create("event1", unsafe, "op", "123", 4),
    ).rejects.toThrow("fixed calendar");
    expect(subject.events.insert).not.toHaveBeenCalled();
  });

  it("patches the existing event instead of inserting another", async () => {
    const subject = gateway();
    await subject.gateway.update("event1", draft());
    expect(subject.events.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: FIXED_CALENDAR_ID,
        eventId: "event1",
      }),
    );
    expect(subject.events.insert).not.toHaveBeenCalled();
  });

  it("treats a Google 404 deletion as already deleted", async () => {
    const subject = gateway();
    subject.events.delete.mockRejectedValueOnce({ code: 404 });
    await expect(subject.gateway.delete("missing")).resolves.toBe(
      "already-deleted",
    );
  });
});
