import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "./dates.js";
import type { ParsedReminderCommand } from "./message-lines.js";

export type ReminderSchedule = {
  scheduledAt: Date;
  // A reminder that could not be sent on its day is dropped at midnight.
  expiresAt: Date;
  displayTime: string;
  // "today", or the day as "Fri 20 Nov" (with the year if it differs).
  displayDay: string;
};

export type ReminderProblem = "past" | "too_far" | "invalid_date";

export type ReminderScheduleResult =
  | { ok: true; schedule: ReminderSchedule }
  | { ok: false; problem: ReminderProblem };

const MAX_DAYS_AHEAD = 366;

function singaporeNow(now: Date): DateTime {
  return DateTime.fromJSDate(now).setZone(SINGAPORE_TIME_ZONE);
}

function dayLabel(day: DateTime, localNow: DateTime): string {
  if (day.hasSame(localNow, "day")) return "today";
  return day.toFormat(
    day.year === localNow.year ? "ccc d LLL" : "ccc d LLL yyyy",
  );
}

// How a reminder's time is shown in lists and confirmations.
export function formatReminderWhen(date: Date, now = new Date()): string {
  const local = singaporeNow(date);
  const label = dayLabel(local, singaporeNow(now));
  const time = local.toFormat("HH:mm");
  return label === "today" ? time : `${label} ${time}`;
}

function scheduleAt(scheduled: DateTime, localNow: DateTime): ReminderSchedule {
  return {
    scheduledAt: scheduled.toJSDate(),
    expiresAt: scheduled.plus({ days: 1 }).startOf("day").toJSDate(),
    displayTime: scheduled.toFormat("HH:mm"),
    displayDay: dayLabel(scheduled, localNow),
  };
}

export function scheduleReminder(
  command: ParsedReminderCommand,
  now = new Date(),
): ReminderScheduleResult {
  const localNow = singaporeNow(now);
  const time = {
    hour: command.hour,
    minute: command.minute,
    second: 0,
    millisecond: 0,
  };

  let scheduled: DateTime;
  if (!command.day) {
    scheduled = localNow.startOf("day").set(time);
  } else if (command.day.kind === "tomorrow") {
    scheduled = localNow.plus({ days: 1 }).startOf("day").set(time);
  } else {
    const { day, month, year } = command.day;
    const onYear = (value: number) =>
      DateTime.fromObject(
        { year: value, month, day, ...time },
        { zone: SINGAPORE_TIME_ZONE },
      );
    scheduled = onYear(year ?? localNow.year);
    // "20-01" typed in November means next January; 29-02 waits for a leap year.
    for (
      let ahead = 1;
      !year &&
      ahead <= 4 &&
      (!scheduled.isValid || scheduled.toMillis() <= localNow.toMillis());
      ahead++
    ) {
      scheduled = onYear(localNow.year + ahead);
    }
    if (!scheduled.isValid) return { ok: false, problem: "invalid_date" };
  }

  if (scheduled.toMillis() <= localNow.toMillis()) {
    return { ok: false, problem: "past" };
  }
  if (scheduled.diff(localNow, "days").days > MAX_DAYS_AHEAD) {
    return { ok: false, problem: "too_far" };
  }
  return { ok: true, schedule: scheduleAt(scheduled, localNow) };
}

// Kept for reminders that can only be today, such as "/remind HHMM text".
export function scheduleReminderToday(
  command: ParsedReminderCommand,
  now = new Date(),
): ReminderSchedule | null {
  const result = scheduleReminder({ ...command, day: undefined }, now);
  return result.ok ? result.schedule : null;
}

// A snoozed reminder fires this many minutes from now.
export function scheduleSnooze(
  minutes: number,
  now = new Date(),
): ReminderSchedule {
  const localNow = singaporeNow(now);
  return scheduleAt(
    localNow.plus({ minutes }).set({ second: 0, millisecond: 0 }),
    localNow,
  );
}

export function reminderProblemMessage(
  problem: ReminderProblem,
  command: ParsedReminderCommand,
): string {
  if (problem === "invalid_date") {
    return "That isn't a real date. Use DD-MM or DD-MM-YYYY, e.g. /remind 20-11 0900 call home";
  }
  if (problem === "too_far") {
    return "Reminders can be set up to a year ahead.";
  }
  return command.day
    ? "That date and time has already passed. Please choose a later Singapore time."
    : "That time has already passed today. Please choose a later Singapore time, or add a day: /remind tmr 0900 call home";
}
