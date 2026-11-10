import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "./dates.js";
import type { ParsedReminderCommand } from "./message-lines.js";

export type ReminderSchedule = {
  scheduledAt: Date;
  expiresAt: Date;
  displayTime: string;
};

export function scheduleReminderToday(
  command: ParsedReminderCommand,
  now = new Date(),
): ReminderSchedule | null {
  const localNow = DateTime.fromJSDate(now).setZone(SINGAPORE_TIME_ZONE);
  const scheduled = localNow.startOf("day").set({
    hour: command.hour,
    minute: command.minute,
    second: 0,
    millisecond: 0,
  });

  if (scheduled.toMillis() <= localNow.toMillis()) return null;

  return {
    scheduledAt: scheduled.toJSDate(),
    expiresAt: scheduled.plus({ days: 1 }).startOf("day").toJSDate(),
    displayTime: scheduled.toFormat("HH:mm"),
  };
}
