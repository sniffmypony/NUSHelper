import { describe, expect, it } from "vitest";
import { parseReminderCommandLine } from "../src/message-lines.js";
import { snoozeKeyboard } from "../src/reminder-snooze.js";
import {
  formatReminderWhen,
  reminderProblemMessage,
  scheduleReminder,
  scheduleSnooze,
} from "../src/reminders.js";

// Friday 13 November 2026, 17:30 in Singapore.
const NOW = new Date("2026-11-13T09:30:00Z");

describe("/remind with a day", () => {
  it("keeps the today form unchanged", () => {
    expect(parseReminderCommandLine("/remind 1800 do tutorial")).toEqual({
      hour: 18,
      minute: 0,
      description: "do tutorial",
    });
  });

  it("reads tmr, tomorrow, DD-MM and DD-MM-YYYY before the time", () => {
    expect(parseReminderCommandLine("/remind tmr 0900 call home")).toEqual({
      hour: 9,
      minute: 0,
      description: "call home",
      day: { kind: "tomorrow" },
    });
    expect(
      parseReminderCommandLine("/remind Tomorrow 0900 call home")?.day,
    ).toEqual({ kind: "tomorrow" });
    expect(parseReminderCommandLine("/remind 20-11 0900 submit form")).toEqual({
      hour: 9,
      minute: 0,
      description: "submit form",
      day: { kind: "date", day: 20, month: 11 },
    });
    expect(
      parseReminderCommandLine("/remind 5-1-2027 0900 new year plans")?.day,
    ).toEqual({ kind: "date", day: 5, month: 1, year: 2027 });
  });

  it("rejects days and months that cannot exist", () => {
    expect(parseReminderCommandLine("/remind 32-11 0900 nope")).toBeNull();
    expect(parseReminderCommandLine("/remind 20-13 0900 nope")).toBeNull();
    expect(parseReminderCommandLine("/remind friday 0900 nope")).toBeNull();
  });

  it("treats a description that starts with digits as text, not a day", () => {
    expect(parseReminderCommandLine("/remind 1800 2030 meeting")).toEqual({
      hour: 18,
      minute: 0,
      description: "2030 meeting",
    });
  });
});

describe("scheduling reminders on other days", () => {
  const at = (line: string) =>
    scheduleReminder(parseReminderCommandLine(line)!, NOW);

  it("schedules tomorrow and expires at the end of that day", () => {
    const result = at("/remind tmr 0900 call home");
    expect(result).toEqual({
      ok: true,
      schedule: {
        scheduledAt: new Date("2026-11-14T01:00:00Z"),
        expiresAt: new Date("2026-11-14T16:00:00Z"),
        displayTime: "09:00",
        displayDay: "Sat 14 Nov",
      },
    });
  });

  it("uses this year for a date still ahead", () => {
    const result = at("/remind 20-11 0900 submit form");
    expect(result.ok && result.schedule.scheduledAt).toEqual(
      new Date("2026-11-20T01:00:00Z"),
    );
  });

  it("rolls a date that has passed to next year, and shows the year", () => {
    const result = at("/remind 5-1 0900 new year plans");
    expect(result.ok && result.schedule).toMatchObject({
      scheduledAt: new Date("2027-01-05T01:00:00Z"),
      displayDay: "Tue 5 Jan 2027",
    });
  });

  it("finds the next 29 February, within the one-year limit", () => {
    const command = parseReminderCommandLine("/remind 29-2 0900 leap day")!;
    const result = scheduleReminder(command, new Date("2027-11-13T09:30:00Z"));
    expect(result.ok && result.schedule.scheduledAt).toEqual(
      new Date("2028-02-29T01:00:00Z"),
    );
    // From November 2026 the next one is more than a year away.
    expect(scheduleReminder(command, NOW)).toEqual({
      ok: false,
      problem: "too_far",
    });
  });

  it("explains a time that has passed, a date too far, and a date that is not real", () => {
    expect(at("/remind 1700 too late")).toEqual({ ok: false, problem: "past" });
    expect(at("/remind 12-11-2026 0900 yesterday")).toEqual({
      ok: false,
      problem: "past",
    });
    expect(at("/remind 20-11-2028 0900 far away")).toEqual({
      ok: false,
      problem: "too_far",
    });
    expect(at("/remind 31-2-2027 0900 not real")).toEqual({
      ok: false,
      problem: "invalid_date",
    });
    expect(
      reminderProblemMessage("past", { hour: 17, minute: 0, description: "x" }),
    ).toMatch(/already passed today/);
    expect(
      reminderProblemMessage("past", {
        hour: 9,
        minute: 0,
        description: "x",
        day: { kind: "tomorrow" },
      }),
    ).toMatch(/date and time has already passed/);
  });

  it("shows only the time for today and adds the day otherwise", () => {
    expect(formatReminderWhen(new Date("2026-11-13T10:00:00Z"), NOW)).toBe(
      "18:00",
    );
    expect(formatReminderWhen(new Date("2026-11-20T01:00:00Z"), NOW)).toBe(
      "Fri 20 Nov 09:00",
    );
  });
});

describe("snoozing a reminder", () => {
  it("offers +15 min and +1 hr buttons within Telegram's limits", () => {
    const [row] = snoozeKeyboard(2_147_483_647).inline_keyboard;
    expect(row).toEqual([
      { text: "+15 min", callback_data: "rem:snooze:2147483647:15" },
      { text: "+1 hr", callback_data: "rem:snooze:2147483647:60" },
    ]);
    for (const button of row) {
      expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
  });

  it("fires the given minutes from now, on the whole minute", () => {
    const schedule = scheduleSnooze(15, new Date("2026-11-13T10:00:40Z"));
    expect(schedule.scheduledAt).toEqual(new Date("2026-11-13T10:15:00Z"));
    expect(schedule.displayDay).toBe("today");
  });

  it("can cross midnight into the next day", () => {
    // 23:50 in Singapore plus one hour.
    const schedule = scheduleSnooze(60, new Date("2026-11-13T15:50:00Z"));
    expect(schedule.scheduledAt).toEqual(new Date("2026-11-13T16:50:00Z"));
    expect(schedule.expiresAt).toEqual(new Date("2026-11-14T16:00:00Z"));
    expect(schedule.displayDay).toBe("Sat 14 Nov");
  });
});
