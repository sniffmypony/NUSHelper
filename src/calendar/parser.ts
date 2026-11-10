import { DateTime } from "luxon";
import { FIXED_CALENDAR_ID, FIXED_TIME_ZONE } from "./config.js";

export type ParsedCalendarEvent = {
  title: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: typeof FIXED_TIME_ZONE;
  calendarId: typeof FIXED_CALENDAR_ID;
  isPast: boolean;
};

export type ParseCalendarEventResult =
  | { ok: true; event: ParsedCalendarEvent }
  | { ok: false; error: "date" | "event" };

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

// Calendar input is "<time>, <title>, <date>". Anything else (for example a
// question for the Canvas assistant) should not receive calendar errors.
export function looksLikeCalendarMessage(input: string): boolean {
  if (/\r?\n/.test(input)) return false;
  const fields = parseCsvFields(input);
  return Boolean(fields && fields.length === 3 && /^\d/.test(fields[0]));
}

export function parseCalendarEventMessage(
  input: string,
  now = new Date(),
): ParseCalendarEventResult {
  if (!input || input.length > 4096) return { ok: false, error: "event" };

  const fields = parseCsvFields(input);
  if (!fields || fields.length !== 3) return { ok: false, error: "event" };
  const [timeText, title, dateText] = fields;
  if (!/^(\d{2})-(\d{2})-(\d{4})$/.test(dateText))
    return { ok: false, error: "date" };

  const date = parseDate(dateText);
  if (!date) return { ok: false, error: "date" };
  if (!title || title.length > 200) return { ok: false, error: "event" };

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
      timeZone: FIXED_TIME_ZONE,
      calendarId: FIXED_CALENDAR_ID,
      isPast: start.toMillis() < now.getTime(),
    },
  };
}

export function formatCalendarEvent(event: ParsedCalendarEvent): {
  date: string;
  time: string;
} {
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
