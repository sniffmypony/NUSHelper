import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "./dates.js";
import type { CalendarAgendaEvent } from "./calendar/types.js";

// Reminders linked to a Google Calendar event ("remind me 30 min before").
// The reminder job checks them against Calendar before sending anything:
// a moved event moves its reminder, a deleted one cancels it.

// The choices the website offers, in minutes before the event.
export const TIMED_OFFSETS = [0, 10, 30, 60, 1440] as const;
// All-day events have no start time, so their reminders go at 9am: on the
// day, or the day before.
export const ALL_DAY_OFFSETS = [0, 1440] as const;
const ALL_DAY_HOUR = 9;

// How often a linked reminder is checked: often when it is close, rarely
// when it is far off (so an event moved closer is still noticed in time).
export const NEAR = { hours: 36 };
export const CHECK_NEAR_EVERY_MIN = 10;
export const CHECK_FAR_EVERY_MIN = 180;
// Always checked once more just before it fires.
export const FINAL_CHECK_MIN = 2;
// Calendar lookups per run, to stay well inside the job's time limit.
export const MAX_CHECKS = 15;

export type LinkedPlan =
  | { kind: "send"; scheduledAt: Date; expiresAt: Date; description: string }
  | { kind: "over" };

const local = (iso: string) =>
  DateTime.fromISO(iso, { zone: SINGAPORE_TIME_ZONE });

export function linkedOffsetLabel(offsetMin: number, allDay: boolean): string {
  if (allDay) return offsetMin === 0 ? "9am on the day" : "9am the day before";
  if (offsetMin === 0) return "When it starts";
  if (offsetMin === 1440) return "1 day before";
  return offsetMin === 60 ? "1 hour before" : `${offsetMin} min before`;
}

export function offsetsFor(event: CalendarAgendaEvent): readonly number[] {
  return event.allDay ? ALL_DAY_OFFSETS : TIMED_OFFSETS;
}

// "today", "tomorrow" or "Fri 27 Nov": the event's day, seen from `from`.
function dayWord(day: DateTime, from: DateTime): string {
  if (day.hasSame(from, "day")) return "today";
  if (day.hasSame(from.plus({ days: 1 }), "day")) return "tomorrow";
  return day.toFormat("ccc d LLL");
}

// When a reminder for `event` should fire, and what it says. "over" when the
// event has already started (nothing left to remind about).
export function planLinkedReminder(
  event: CalendarAgendaEvent,
  offsetMin: number,
  now = new Date(),
): LinkedPlan {
  const eventStart = event.allDay
    ? local(event.startDate).startOf("day")
    : DateTime.fromISO(event.startDateTime).setZone(SINGAPORE_TIME_ZONE);
  if (!eventStart.isValid || eventStart.toMillis() <= now.getTime()) {
    return { kind: "over" };
  }
  const anchor = event.allDay
    ? eventStart.set({ hour: ALL_DAY_HOUR })
    : eventStart;

  // An event moved closer than its offset is reminded about right away.
  const wanted = anchor.minus({ minutes: offsetMin });
  const current = DateTime.fromJSDate(now)
    .setZone(SINGAPORE_TIME_ZONE)
    .set({ second: 0, millisecond: 0 });
  const fireAt = wanted.toMillis() > now.getTime() ? wanted : current;

  const day = dayWord(eventStart, fireAt);
  const capital = day.charAt(0).toUpperCase() + day.slice(1);
  const description = event.allDay
    ? `${capital}: ${event.title}`
    : offsetMin === 0 && fireAt.equals(wanted)
      ? `${event.title} starts now`
      : `${event.title} at ${eventStart.toFormat("HH:mm")}${day === "today" ? "" : `, ${day}`}`;
  return {
    kind: "send",
    scheduledAt: fireAt.toJSDate(),
    // As for typed reminders: one not sent by midnight is dropped.
    expiresAt: fireAt.plus({ days: 1 }).startOf("day").toJSDate(),
    description,
  };
}

export interface LinkedReminder {
  id: number;
  eventId: string;
  eventOffsetMin: number;
  description: string;
  scheduledAt: Date;
}

export interface LinkedReminderStore {
  dueForCheck(now: Date, limit: number): Promise<LinkedReminder[]>;
  update(
    id: number,
    change: {
      scheduledAt: Date;
      expiresAt: Date;
      description: string;
      checkedAt: Date;
    },
  ): Promise<void>;
  markChecked(id: number, checkedAt: Date): Promise<void>;
  cancel(id: number): Promise<void>;
}

export type LinkedSyncResult = {
  checked: number;
  moved: number;
  cancelled: number;
  error?: string;
};

// Null when the event no longer exists (or was cancelled).
export type EventLookup = (
  eventId: string,
) => Promise<CalendarAgendaEvent | null>;

// One reminder at a time (the database has a single pooled connection).
// When Calendar can't be reached the reminders are left as they are and
// still fire at their last known time.
export async function syncLinkedReminders(
  store: LinkedReminderStore,
  lookup: EventLookup,
  now = new Date(),
): Promise<LinkedSyncResult> {
  const result: LinkedSyncResult = { checked: 0, moved: 0, cancelled: 0 };
  const due = await store.dueForCheck(now, MAX_CHECKS);
  for (const reminder of due) {
    let event: CalendarAgendaEvent | null;
    try {
      event = await lookup(reminder.eventId);
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      console.error(`Linked reminder check failed (${type})`);
      result.error = "calendar unavailable";
      break;
    }
    result.checked += 1;
    const plan = event
      ? planLinkedReminder(event, reminder.eventOffsetMin, now)
      : ({ kind: "over" } as const);
    if (plan.kind === "over") {
      // Deleted, or moved to a time already past.
      await store.cancel(reminder.id);
      result.cancelled += 1;
      continue;
    }
    // A reminder already due stays due; only a real change is written.
    const due = (date: Date) => date.getTime() <= now.getTime();
    const sameTime =
      plan.scheduledAt.getTime() === reminder.scheduledAt.getTime() ||
      (due(plan.scheduledAt) && due(reminder.scheduledAt));
    if (!sameTime || plan.description !== reminder.description) {
      await store.update(reminder.id, {
        scheduledAt: sameTime ? reminder.scheduledAt : plan.scheduledAt,
        expiresAt: sameTime
          ? DateTime.fromJSDate(reminder.scheduledAt)
              .setZone(SINGAPORE_TIME_ZONE)
              .plus({ days: 1 })
              .startOf("day")
              .toJSDate()
          : plan.expiresAt,
        description: plan.description,
        checkedAt: now,
      });
      result.moved += 1;
    } else {
      await store.markChecked(reminder.id, now);
    }
  }
  return result;
}
