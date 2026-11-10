import { describe, expect, it } from "vitest";
import { mondayOfSingaporeWeek, singaporeDateRange } from "../src/dates.js";
import { formatCalendarAgenda } from "../src/calendar/agenda.js";

describe("calendar digest ranges", () => {
  it("uses the exact Monday through Sunday Singapore week", () => {
    expect(mondayOfSingaporeWeek("2026-10-14")).toBe("2026-10-12");
    expect(singaporeDateRange("2026-10-12", 7)).toEqual({
      timeMin: "2026-10-12T00:00:00.000+08:00",
      timeMax: "2026-10-19T00:00:00.000+08:00",
    });
  });

  it("uses today plus the next two complete Singapore days", () => {
    expect(singaporeDateRange("2026-10-14", 3).timeMax).toBe(
      "2026-10-17T00:00:00.000+08:00",
    );
  });

  it("formats timed and all-day events chronologically as supplied", () => {
    expect(
      formatCalendarAgenda([
        {
          id: "one",
          title: "Tutorial",
          htmlLink: null,
          allDay: false,
          startDateTime: "2026-10-14T18:00:00+08:00",
          endDateTime: "2026-10-14T19:00:00+08:00",
        },
        {
          id: "two",
          title: "Submission",
          htmlLink: null,
          allDay: true,
          startDate: "2026-10-15",
          endDate: "2026-10-16",
        },
      ]),
    ).toBe(
      "• Wed 14 Oct, 18:00–19:00 — Tutorial\n" +
        "• Thu 15 Oct, all day — Submission",
    );
  });
});
