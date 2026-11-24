import { DateTime } from "luxon";
import { calendarId, FIXED_TIME_ZONE } from "./config.js";

export const CALENDAR_REPEATS = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
] as const;
export type CalendarRepeat = (typeof CALENDAR_REPEATS)[number];

// An all-day event's start and end are dates (YYYY-MM-DD), the end being the
// day after the last day, as Google Calendar stores them. A timed event's are
// ISO date-times with the Singapore offset.
export type ParsedCalendarEvent = {
  title: string;
  startDateTime: string;
  endDateTime: string;
  allDay: boolean;
  repeat: CalendarRepeat | null;
  timeZone: typeof FIXED_TIME_ZONE;
  calendarId: string;
  isPast: boolean;
};

export type ParseCalendarEventResult =
  | { ok: true; event: ParsedCalendarEvent }
  | { ok: false; error: "date" | "event" | "repeat" };

type ClockValue = {
  hour: number;
  minute: number;
  hasMeridian: boolean;
  hasExplicitMinutes: boolean;
};

function parseCsvFields(input: string): string[] | null {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        current += character;
      }
      continue;
    }

    if (closedQuote) {
      if (character === ",") {
        fields.push(current.trim());
        current = "";
        closedQuote = false;
      } else if (!/\s/.test(character)) {
        return null;
      }
      continue;
    }

    if (character === '"') {
      if (current.trim()) return null;
      current = "";
      quoted = true;
    } else if (character === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (quoted) return null;
  fields.push(current.trim());
  return fields;
}

function parseClock(value: string): ClockValue | null {
  const match = /^(\d{1,4})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) return null;

  const digits = match[1];
  const colonMinutes = match[2];
  const meridian = match[3]?.toLowerCase();
  if (colonMinutes && digits.length > 2) return null;

  const isCompact = !colonMinutes && digits.length >= 3;
  let hour = Number(isCompact ? digits.slice(0, -2) : digits);
  const minute = Number(colonMinutes ?? (isCompact ? digits.slice(-2) : "0"));
  if (minute < 0 || minute > 59) return null;

  if (meridian) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridian === "pm") hour += 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return {
    hour,
    minute,
    hasMeridian: Boolean(meridian),
    hasExplicitMinutes: Boolean(colonMinutes) || isCompact,
  };
}

function parseDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = DateTime.fromObject(
    { year, month, day },
    { zone: FIXED_TIME_ZONE },
  );
  if (
    !date.isValid ||
    date.year !== year ||
    date.month !== month ||
    date.day !== day
  )
    return null;
  return { year, month, day };
}

function parseTimeRange(value: string): {
  startMinutes: number;
  endMinutes: number;
  crossesMidnight: boolean;
} | null {
  const match = /^(.+?)\s*(?:-|–|\bto\b)\s*(.+)$/i.exec(value.trim());
  if (!match) return null;

  const start = parseClock(match[1]);
  const end = parseClock(match[2]);
  if (!start || !end || start.hasMeridian !== end.hasMeridian) return null;
  if (!start.hasMeridian && start.hasExplicitMinutes !== end.hasExplicitMinutes)
    return null;

  const startMinutes = start.hour * 60 + start.minute;
  let endMinutes = end.hour * 60 + end.minute;
  let crossesMidnight = false;

  if (start.hasMeridian) {
    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60;
      crossesMidnight = true;
    }
  } else if (!start.hasExplicitMinutes) {
    // Deterministic shorthand: 8-10 is morning; 12-6 and 15-5 end in the afternoon.
    if (start.hour >= 12 && end.hour < 12) endMinutes += 12 * 60;
    if (endMinutes <= startMinutes || endMinutes >= 24 * 60) return null;
  } else if (endMinutes <= startMinutes) {
    return null;
  }

  return { startMinutes, endMinutes, crossesMidnight };
}

const ALL_DAY = /^all[\s-]?day$/i;

const REPEAT_WORDS: Record<string, CalendarRepeat> = {
  daily: "daily",
  "every day": "daily",
  weekdays: "weekdays",
  "every weekday": "weekdays",
  weekly: "weekly",
  "every week": "weekly",
  monthly: "monthly",
  "every month": "monthly",
  yearly: "yearly",
  annually: "yearly",
  annual: "yearly",
  "every year": "yearly",
};

export function parseRepeat(value: string): CalendarRepeat | null {
  return REPEAT_WORDS[value.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

// A date-only value (all-day events) rather than a date-time.
export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Whether an event starts before `now`. An all-day event is past from the
// day after it starts.
export function startsBefore(startDateTime: string, now: Date): boolean {
  if (!isDateOnly(startDateTime)) {
    return new Date(startDateTime).getTime() < now.getTime();
  }
  const today = DateTime.fromJSDate(now).setZone(FIXED_TIME_ZONE).toISODate()!;
  return startDateTime < today;
}

// Calendar input is "<time>, <title>, <date>" with an optional fourth
// "<repeat>" field, where <time> may be "all day". Anything else (for
// example a question for the AI assistant) should not receive calendar errors.
export function looksLikeCalendarMessage(input: string): boolean {
  if (/\r?\n/.test(input)) return false;
  const fields = parseCsvFields(input);
  return Boolean(
    fields &&
    (fields.length === 3 || fields.length === 4) &&
    (/^\d/.test(fields[0]) || ALL_DAY.test(fields[0])),
  );
}

export function parseCalendarEventMessage(
  input: string,
  now = new Date(),
): ParseCalendarEventResult {
  if (!input || input.length > 4096) return { ok: false, error: "event" };

  const fields = parseCsvFields(input);
  if (!fields || (fields.length !== 3 && fields.length !== 4)) {
    return { ok: false, error: "event" };
  }
  const [timeText, title, dateText, repeatText] = fields;
  const repeat = repeatText === undefined ? null : parseRepeat(repeatText);
  if (repeatText !== undefined && !repeat)
    return { ok: false, error: "repeat" };
  if (!/^(\d{2})-(\d{2})-(\d{4})$/.test(dateText))
    return { ok: false, error: "date" };

  const date = parseDate(dateText);
  if (!date) return { ok: false, error: "date" };
  if (!title || title.length > 200) return { ok: false, error: "event" };

  if (ALL_DAY.test(timeText)) {
    const day = DateTime.fromObject(date, { zone: FIXED_TIME_ZONE });
    return {
      ok: true,
      event: {
        title,
        startDateTime: day.toISODate()!,
        endDateTime: day.plus({ days: 1 }).toISODate()!,
        allDay: true,
        repeat,
        timeZone: FIXED_TIME_ZONE,
        calendarId: calendarId(),
        isPast: startsBefore(day.toISODate()!, now),
      },
    };
  }

  const range = parseTimeRange(timeText);
  if (!range) return { ok: false, error: "event" };

  const start = DateTime.fromObject(
    {
      ...date,
      hour: Math.floor(range.startMinutes / 60),
      minute: range.startMinutes % 60,
      second: 0,
      millisecond: 0,
    },
    { zone: FIXED_TIME_ZONE },
  );
  const endBase = DateTime.fromObject(
    {
      ...date,
      hour: Math.floor((range.endMinutes % (24 * 60)) / 60),
      minute: range.endMinutes % 60,
      second: 0,
      millisecond: 0,
    },
    { zone: FIXED_TIME_ZONE },
  );
  const end = range.crossesMidnight ? endBase.plus({ days: 1 }) : endBase;
  const startDateTime = start.toISO({
    suppressMilliseconds: true,
    includeOffset: true,
  });
  const endDateTime = end.toISO({
    suppressMilliseconds: true,
    includeOffset: true,
  });
  if (!startDateTime || !endDateTime || end.toMillis() <= start.toMillis()) {
    return { ok: false, error: "event" };
  }

  return {
    ok: true,
    event: {
      title,
      startDateTime,
      endDateTime,
      allDay: false,
      repeat,
      timeZone: FIXED_TIME_ZONE,
      calendarId: calendarId(),
      isPast: start.toMillis() < now.getTime(),
    },
  };
}

// An event read back from a pending or mapping row.
export function storedCalendarEvent(
  row: {
    title: string;
    startDateTime: string;
    endDateTime: string;
    repeat: string | null;
  },
  now = new Date(),
): ParsedCalendarEvent {
  return {
    title: row.title,
    startDateTime: row.startDateTime,
    endDateTime: row.endDateTime,
    allDay: isDateOnly(row.startDateTime),
    repeat: row.repeat ? parseRepeat(row.repeat) : null,
    timeZone: FIXED_TIME_ZONE,
    calendarId: calendarId(),
    isPast: startsBefore(row.startDateTime, now),
  };
}

// Google Calendar's RRULE for a repeat. "monthly" repeats on the same day
// of the month and "yearly" on the same date.
export function recurrenceRule(repeat: CalendarRepeat): string {
  switch (repeat) {
    case "daily":
      return "RRULE:FREQ=DAILY";
    case "weekdays":
      return "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return "RRULE:FREQ=WEEKLY";
    case "monthly":
      return "RRULE:FREQ=MONTHLY";
    case "yearly":
      return "RRULE:FREQ=YEARLY";
  }
}

// "Every year on 19 August", for previews and confirmations.
export function describeRepeat(
  repeat: CalendarRepeat,
  startDateTime: string,
): string {
  const start = isDateOnly(startDateTime)
    ? DateTime.fromISO(startDateTime, { zone: FIXED_TIME_ZONE })
    : DateTime.fromISO(startDateTime, { setZone: true }).setZone(
        FIXED_TIME_ZONE,
      );
  switch (repeat) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday (Monday to Friday)";
    case "weekly":
      return `Every week on ${start.toFormat("cccc")}`;
    case "monthly":
      return `Every month on day ${start.day}`;
    case "yearly":
      return `Every year on ${start.toFormat("d LLLL")}`;
  }
}

export function formatCalendarEvent(event: ParsedCalendarEvent): {
  date: string;
  time: string;
} {
  if (event.allDay) {
    const start = DateTime.fromISO(event.startDateTime, {
      zone: FIXED_TIME_ZONE,
    });
    const last = DateTime.fromISO(event.endDateTime, {
      zone: FIXED_TIME_ZONE,
    }).minus({ days: 1 });
    return {
      date:
        last > start
          ? `${start.toFormat("cccc, d LLLL yyyy")} – ${last.toFormat("cccc, d LLLL yyyy")}`
          : start.toFormat("cccc, d LLLL yyyy"),
      time: "All day",
    };
  }
  const start = DateTime.fromISO(event.startDateTime, {
    setZone: true,
  }).setZone(FIXED_TIME_ZONE);
  const end = DateTime.fromISO(event.endDateTime, { setZone: true }).setZone(
    FIXED_TIME_ZONE,
  );
  const date = start.toFormat("cccc, d LLLL yyyy");
  const endDate =
    end.toFormat("yyyy-LL-dd") === start.toFormat("yyyy-LL-dd")
      ? ""
      : ` (${end.toFormat("d LLL")})`;
  return {
    date,
    time: `${start.toFormat("h:mm a")}–${end.toFormat("h:mm a")}${endDate}`,
  };
}
