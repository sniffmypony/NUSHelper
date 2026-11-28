import { createHash } from "node:crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import { DateTime } from "luxon";
import { readBirthdayEvent } from "./birthdays.js";
import { singaporeDateRange, SINGAPORE_TIME_ZONE } from "./dates.js";
import type { ReminderStore } from "./reminder-store.js";

// A Telegram reminder at 23:55 the night before each birthday. The
// every-minute job looks up tomorrow's birthdays in Google Calendar (every
// 15 minutes, and each minute from 23:45 so a late addition still counts)
// and makes an ordinary reminder for each; the reminder dispatcher sends it
// with the usual snooze buttons.

export const BIRTHDAY_REMINDER = { hour: 23, minute: 55 };

export function timeToLookForBirthdays(now: Date): boolean {
  const local = DateTime.fromJSDate(now).setZone(SINGAPORE_TIME_ZONE);
  return local.minute % 15 === 0 || (local.hour === 23 && local.minute >= 45);
}

// Reminders made by the bot have no Telegram message of their own, so the
// unique key uses the birthday's date (negative, unlike real message ids)
// and a number from the event: each birthday is reminded once a year.
function reminderKey(eventId: string, date: DateTime) {
  const hash = createHash("sha256").update(eventId).digest();
  return {
    sourceMessageId: -Number(date.toFormat("yyyyLLdd")),
    sourceLine: hash.readUInt32BE(0) % 2_000_000_000,
  };
}

export function birthdayReminderText(
  name: string,
  year: number | null,
  date: DateTime,
): string {
  const turning = year ? `, turning ${date.year - year}` : "";
  return `🎂 Tomorrow (${date.toFormat("ccc d LLL")}) is ${name}'s birthday${turning}.`;
}

export async function scheduleBirthdayReminders(
  birthdaysBetween: (
    timeMin: string,
    timeMax: string,
  ) => Promise<calendar_v3.Schema$Event[]>,
  store: Pick<ReminderStore, "create">,
  ownerId: string,
  now: Date,
): Promise<{ scheduled: number }> {
  const today = DateTime.fromJSDate(now)
    .setZone(SINGAPORE_TIME_ZONE)
    .startOf("day");
  const tomorrow = today.plus({ days: 1 });
  const range = singaporeDateRange(tomorrow.toISODate()!, 1);
  const events = await birthdaysBetween(range.timeMin, range.timeMax);

  let scheduled = 0;
  for (const event of events) {
    const birthday = readBirthdayEvent(event);
    if (!birthday) continue;
    // An occurrence of a yearly event has its own id; key on the series.
    const seriesId = event.recurringEventId ?? birthday.id;
    // One reminder at a time (queries run one at a time).
    await store.create({
      ownerId,
      chatId: ownerId,
      ...reminderKey(seriesId, tomorrow),
      description: birthdayReminderText(birthday.name, birthday.year, tomorrow),
      scheduledAt: today.set(BIRTHDAY_REMINDER).toJSDate(),
      expiresAt: tomorrow.endOf("day").toJSDate(),
    });
    scheduled += 1;
  }
  return { scheduled };
}
