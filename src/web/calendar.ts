import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE, addDays, isValidIsoDate } from "../dates.js";
import type { CalendarAgendaEvent } from "../calendar/types.js";
import { teachingWeek } from "../nus/academic-week.js";
import { lessonRunsOn } from "../nus/timetable-link.js";
import { acadWeekLabel } from "../nus/week.js";

// Everything the website's calendar shows for a range of Singapore days.
// The sources are passed in so this can be tested without a database; the
// real ones read one after another (the bot has a single pooled database
// connection, and Supabase's pooler can hang on queries sent together).

export const MAX_RANGE_DAYS = 42;

export interface CalendarSources {
  spending(
    start: string,
    end: string,
  ): Promise<Array<{ spendDate: string; totalCents: number; status: string }>>;
  reminders(
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      id: number;
      description: string;
      scheduledAt: Date;
      status: string;
      eventId: string | null;
    }>
  >;
  tasks(
    start: string,
    end: string,
  ): Promise<
    Array<{
      id: number;
      description: string;
      module: string | null;
      dueDate: string | null;
    }>
  >;
  deadlines(
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      moduleCode: string;
      name: string;
      dueAt: Date;
      htmlUrl: string | null;
    }>
  >;
  lessons(): Promise<
    Array<{
      acadYear: string;
      semester: number;
      moduleCode: string;
      lessonType: string;
      day: number;
      startTime: string;
      endTime: string;
      venue?: string | null;
      weeks: unknown;
    }>
  >;
  // Null when Google Calendar isn't set up.
  events:
    | ((timeMin: string, timeMax: string) => Promise<CalendarAgendaEvent[]>)
    | null;
}

export interface CalendarDay {
  week: string;
  spending: { cents: number; status: string } | null;
  events: Array<{
    id: string;
    title: string;
    allDay: boolean;
    start: string | null; // HH:mm for timed events
    end: string | null;
    url: string | null;
  }>;
  reminders: Array<{
    id: number;
    description: string;
    time: string;
    status: string;
    // Set when the reminder follows a Google Calendar event.
    eventId: string | null;
  }>;
  tasks: Array<{ id: number; description: string; module: string | null }>;
  deadlines: Array<{
    moduleCode: string;
    name: string;
    time: string;
    url: string | null;
  }>;
  classes: Array<{
    moduleCode: string;
    lessonType: string;
    start: string;
    end: string;
    venue: string;
  }>;
}

export interface CalendarRange {
  start: string;
  end: string;
  days: Record<string, CalendarDay>;
  eventsError: string | null;
}

const zone = { zone: SINGAPORE_TIME_ZONE };
const clock = (hhmm: string) => `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
const local = (date: Date) =>
  DateTime.fromJSDate(date).setZone(SINGAPORE_TIME_ZONE);

export function rangeProblem(start: string, end: string): string | null {
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return "Dates must be YYYY-MM-DD.";
  }
  if (start > end) return "The start must be on or before the end.";
  const days =
    DateTime.fromISO(end, zone).diff(DateTime.fromISO(start, zone), "days")
      .days + 1;
  return days > MAX_RANGE_DAYS
    ? `At most ${MAX_RANGE_DAYS} days at a time.`
    : null;
}

export async function calendarRange(
  start: string,
  end: string,
  sources: CalendarSources,
  now = new Date(),
): Promise<CalendarRange> {
  const days: Record<string, CalendarDay> = {};
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days[date] = {
      week: acadWeekLabel(date),
      spending: null,
      events: [],
      reminders: [],
      tasks: [],
      deadlines: [],
      classes: [],
    };
  }
  const from = DateTime.fromISO(start, zone).startOf("day").toJSDate();
  const to = DateTime.fromISO(end, zone)
    .plus({ days: 1 })
    .startOf("day")
    .toJSDate();
  const dayOf = (date: Date) => local(date).toISODate()!;

  // One source at a time; see the note at the top.
  for (const row of await sources.spending(start, end)) {
    const day = days[row.spendDate];
    if (day) day.spending = { cents: row.totalCents, status: row.status };
  }
  for (const row of await sources.reminders(from, to)) {
    // Only reminders still to come: once its time has passed, a reminder
    // has done its job (other items stay, past or not).
    if (row.scheduledAt.getTime() <= now.getTime()) continue;
    days[dayOf(row.scheduledAt)]?.reminders.push({
      id: row.id,
      description: row.description,
      time: local(row.scheduledAt).toFormat("HH:mm"),
      status: row.status,
      eventId: row.eventId,
    });
  }
  for (const row of await sources.tasks(start, end)) {
    if (row.dueDate) {
      days[row.dueDate]?.tasks.push({
        id: row.id,
        description: row.description,
        module: row.module,
      });
    }
  }
  for (const row of await sources.deadlines(from, to)) {
    days[dayOf(row.dueAt)]?.deadlines.push({
      moduleCode: row.moduleCode,
      name: row.name,
      time: local(row.dueAt).toFormat("HH:mm"),
      url: row.htmlUrl,
    });
  }

  const lessons = await sources.lessons();
  for (const date of Object.keys(days)) {
    const week = teachingWeek(date);
    if (!week) continue;
    const weekday = DateTime.fromISO(date, zone).weekday;
    days[date].classes = lessons
      .filter(
        (lesson) =>
          lesson.acadYear === week.year &&
          lesson.semester === week.semester &&
          lesson.day === weekday &&
          lessonRunsOn(lesson.weeks, date, week.week),
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((lesson) => ({
        moduleCode: lesson.moduleCode,
        lessonType: lesson.lessonType,
        start: clock(lesson.startTime),
        end: clock(lesson.endTime),
        venue: lesson.venue ?? "",
      }));
  }

  let eventsError: string | null = null;
  if (sources.events) {
    try {
      const events = await sources.events(
        DateTime.fromJSDate(from).toISO()!,
        DateTime.fromJSDate(to).toISO()!,
      );
      for (const event of events) {
        if (event.allDay) {
          // An all-day event's end date is the day after its last day.
          for (
            let date = event.startDate;
            date < event.endDate;
            date = addDays(date, 1)
          ) {
            days[date]?.events.push({
              id: event.id,
              title: event.title,
              allDay: true,
              start: null,
              end: null,
              url: event.htmlLink,
            });
          }
          continue;
        }
        const startAt = DateTime.fromISO(event.startDateTime).setZone(
          SINGAPORE_TIME_ZONE,
        );
        const endAt = DateTime.fromISO(event.endDateTime).setZone(
          SINGAPORE_TIME_ZONE,
        );
        days[startAt.toISODate()!]?.events.push({
          id: event.id,
          title: event.title,
          allDay: false,
          start: startAt.toFormat("HH:mm"),
          end: endAt.toFormat("HH:mm"),
          url: event.htmlLink,
        });
      }
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      console.error(`Website calendar events failed (${type})`);
      eventsError = "Couldn't read Google Calendar just now.";
    }
  }

  for (const day of Object.values(days)) {
    day.events.sort((a, b) =>
      a.allDay === b.allDay
        ? (a.start ?? "").localeCompare(b.start ?? "")
        : a.allDay
          ? -1
          : 1,
    );
    day.reminders.sort((a, b) => a.time.localeCompare(b.time));
    day.deadlines.sort((a, b) => a.time.localeCompare(b.time));
  }
  return { start, end, days, eventsError };
}
