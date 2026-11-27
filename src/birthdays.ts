import { createHash } from "node:crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import { DateTime } from "luxon";
import type { BirthdayCalendar as Calendar } from "./calendar/google.js";
import { SINGAPORE_TIME_ZONE } from "./dates.js";

// Birthdays live only in Google Calendar: one all-day event a year each,
// tagged privately so the website can list and remove them. Several can be
// pasted at once, one per line ("Alice 14/03", "14 Mar 2004 - Bob").

export interface Birthday {
  name: string;
  month: number;
  day: number;
  year: number | null;
}

export interface BirthdayLines {
  birthdays: Birthday[];
  rejected: Array<{ line: number; text: string; reason: string }>;
}

export const MAX_BIRTHDAY_LINES = 100;
const MAX_NAME = 80;
// Google reminds at 9am the day before (minutes before the day starts).
export const REMINDER_MINUTES = 15 * 60;

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const MONTH_WORD =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const ORDINAL = "(?:st|nd|rd|th)?";

// Each pattern finds a date in a line; the rest of the line is the name.
const PATTERNS: Array<{
  regex: RegExp;
  read: (m: RegExpExecArray) => [day: string, month: string, year?: string];
}> = [
  {
    // 2004-03-14
    regex: /(?<![\d/.-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d/.-])/,
    read: (m) => [m[3], m[2], m[1]],
  },
  {
    // 14/03, 14-03-2004, 14.3.04 (day first, as in Singapore)
    regex:
      /(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![\d/.-])/,
    read: (m) => [m[1], m[2], m[3]],
  },
  {
    // 14 Mar, 14th March 2004
    regex: new RegExp(
      `(?<![\\w])(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH_WORD}(?:,?\\s+(\\d{4}))?(?![\\w])`,
      "i",
    ),
    read: (m) => [m[1], m[2], m[3]],
  },
  {
    // Mar 14, March 14th, 2004
    regex: new RegExp(
      `(?<![\\w])${MONTH_WORD}\\s+(\\d{1,2})${ORDINAL}(?:,?\\s+(\\d{4}))?(?![\\w])`,
      "i",
    ),
    read: (m) => [m[2], m[1], m[3]],
  },
];

function monthNumber(text: string): number {
  const named = MONTHS.indexOf(text.slice(0, 3).toLowerCase());
  return named >= 0 ? named + 1 : Number(text);
}

function fullYear(text: string | undefined, thisYear: number): number | null {
  if (!text) return null;
  const value = Number(text);
  if (text.length === 4) return value;
  // Two digits: the most recent year ending in them.
  const century = Math.floor(thisYear / 100) * 100;
  return century + value > thisYear ? century - 100 + value : century + value;
}

const isLeap = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function realDate(day: number, month: number, year: number | null): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  // Without a year, 29 Feb is allowed (it falls on 28 Feb in other years).
  const days = DateTime.local(year ?? 2024, month, 1).daysInMonth ?? 31;
  return day <= days;
}

function cleanName(text: string): string {
  return Array.from(text, (char) =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char,
  )
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:|\-–—]+|[\s,;:|\-–—]+$/g, "")
    .replace(/(?:'s|’s)?\s+birthday$/i, "")
    .trim();
}

export function readBirthdayLines(
  text: string,
  today = DateTime.now().setZone(SINGAPORE_TIME_ZONE),
): BirthdayLines {
  const result: BirthdayLines = { birthdays: [], rejected: [] };
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const reject = (reason: string) =>
      result.rejected.push({ line: index + 1, text: line, reason });

    let found: {
      match: RegExpExecArray;
      parts: [string, string, string?];
    } | null = null;
    for (const pattern of PATTERNS) {
      const match = pattern.regex.exec(line);
      if (match) {
        found = { match, parts: pattern.read(match) };
        break;
      }
    }
    if (!found) {
      reject("No date found. Write it like 14/03 or 14 Mar.");
      continue;
    }
    const [dayText, monthText, yearText] = found.parts;
    const day = Number(dayText);
    const month = monthNumber(monthText);
    const year = fullYear(yearText, today.year);
    if (!realDate(day, month, year)) {
      reject("That date doesn't exist (dates are day first).");
      continue;
    }
    if (year !== null && (year < 1900 || year > today.year)) {
      reject("The year looks wrong.");
      continue;
    }
    const name = cleanName(
      line.slice(0, found.match.index) +
        " " +
        line.slice(found.match.index + found.match[0].length),
    );
    if (!name) {
      reject("Add the person's name.");
      continue;
    }
    if (name.length > MAX_NAME) {
      reject(`Keep the name under ${MAX_NAME} characters.`);
      continue;
    }
    const birthday = { name, month, day, year };
    const id = birthdayEventId(birthday);
    if (seen.has(id)) continue;
    seen.add(id);
    result.birthdays.push(birthday);
  }
  return result;
}

const pad = (value: number) => String(value).padStart(2, "0");

// The same person and date always get the same event id, so adding them
// again doesn't make a second event. Google ids use the letters a-v and
// digits; hex fits.
export function birthdayEventId(birthday: Birthday): string {
  const key = `${birthday.name.toLowerCase().replace(/\s+/g, " ")}|${pad(birthday.month)}-${pad(birthday.day)}`;
  return `bday${createHash("sha256").update(key).digest("hex").slice(0, 28)}`;
}

// Where this year's (or another year's) birthday falls: 29 Feb is 28 Feb
// outside leap years.
function occurrence(birthday: Birthday, year: number): DateTime {
  const day =
    birthday.month === 2 && birthday.day === 29 && !isLeap(year)
      ? 28
      : birthday.day;
  return DateTime.fromObject(
    { year, month: birthday.month, day },
    { zone: SINGAPORE_TIME_ZONE },
  );
}

export function birthdayEvent(
  birthday: Birthday,
  today = DateTime.now().setZone(SINGAPORE_TIME_ZONE),
): calendar_v3.Schema$Event {
  const start = occurrence(birthday, today.year);
  const leapDay = birthday.month === 2 && birthday.day === 29;
  return {
    summary: `🎂 ${birthday.name}'s birthday`,
    description: birthday.year
      ? `Born ${birthday.year}. Added by NUSHelper.`
      : "Added by NUSHelper.",
    start: { date: start.toISODate()! },
    end: { date: start.plus({ days: 1 }).toISODate()! },
    recurrence: [
      leapDay
        ? "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1"
        : "RRULE:FREQ=YEARLY",
    ],
    transparency: "transparent",
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: REMINDER_MINUTES }],
    },
    extendedProperties: {
      private: {
        nushelperBirthday: "1",
        birthdayName: birthday.name,
        birthdayDate: `${pad(birthday.month)}-${pad(birthday.day)}`,
        birthdayYear: birthday.year ? String(birthday.year) : "",
      },
    },
  };
}

// A birthday event back from Google, or null if it isn't one of ours.
export function readBirthdayEvent(
  event: calendar_v3.Schema$Event,
): (Birthday & { id: string }) | null {
  const tags = event.extendedProperties?.private;
  if (!event.id || event.status === "cancelled") return null;
  if (tags?.nushelperBirthday !== "1") return null;
  const date = /^(\d{2})-(\d{2})$/.exec(tags.birthdayDate ?? "");
  const name = (tags.birthdayName ?? "").trim();
  if (!date || !name) return null;
  const year = Number(tags.birthdayYear);
  return {
    id: event.id,
    name,
    month: Number(date[1]),
    day: Number(date[2]),
    year: Number.isInteger(year) && year > 0 ? year : null,
  };
}

export interface BirthdayView {
  id: string;
  name: string;
  // "14 Mar"
  date: string;
  year: number | null;
  next: string;
  daysUntil: number;
  // The age they turn next, when the year is known.
  turns: number | null;
}

export function birthdayView(
  birthday: Birthday & { id: string },
  today = DateTime.now().setZone(SINGAPORE_TIME_ZONE),
): BirthdayView {
  const start = today.startOf("day");
  let next = occurrence(birthday, start.year);
  if (next < start) next = occurrence(birthday, start.year + 1);
  return {
    id: birthday.id,
    name: birthday.name,
    date: DateTime.fromObject({
      year: 2024,
      month: birthday.month,
      day: birthday.day,
    }).toFormat("d LLL"),
    year: birthday.year,
    next: next.toISODate()!,
    daysUntil: Math.round(next.diff(start, "days").days),
    turns: birthday.year ? next.year - birthday.year : null,
  };
}

// What the website does with birthdays, given a calendar to keep them in.

export const BIRTHDAY_ID = /^bday[0-9a-f]{28}$/;

export async function listBirthdays(
  calendar: Calendar,
  today = DateTime.now().setZone(SINGAPORE_TIME_ZONE),
): Promise<BirthdayView[]> {
  const events = await calendar.listBirthdayEvents();
  return events
    .map((event) => readBirthdayEvent(event))
    .filter((birthday) => birthday !== null)
    .map((birthday) => birthdayView(birthday, today))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}

export interface AddedBirthdays {
  ok: boolean;
  message: string;
  added: number;
  existing: number;
  rejected: BirthdayLines["rejected"];
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// Adds each one in turn (never in parallel), stopping at the first Google
// error so the message can say how far it got.
export async function addBirthdays(
  calendar: Calendar,
  text: string,
  today = DateTime.now().setZone(SINGAPORE_TIME_ZONE),
  errorMessage: (error: unknown) => string = () => "Google Calendar failed.",
): Promise<AddedBirthdays> {
  const { birthdays, rejected } = readBirthdayLines(text, today);
  if (birthdays.length === 0) {
    return {
      ok: false,
      message: rejected.length
        ? "None of the lines had a name and a date."
        : "Add at least one birthday.",
      added: 0,
      existing: 0,
      rejected,
    };
  }
  let added = 0;
  let existing = 0;
  for (const birthday of birthdays) {
    try {
      const outcome = await calendar.addBirthdayEvent(
        birthdayEventId(birthday),
        birthdayEvent(birthday, today),
      );
      if (outcome === "created") added += 1;
      else existing += 1;
    } catch (error) {
      return {
        ok: added > 0,
        message: `Added ${plural(added, "birthday")}, then stopped: ${errorMessage(error)}`,
        added,
        existing,
        rejected,
      };
    }
  }
  const parts = [`Added ${plural(added, "birthday")} to Google Calendar.`];
  if (existing) {
    parts.push(`${existing} ${existing === 1 ? "was" : "were"} already there.`);
  }
  if (rejected.length)
    parts.push(`Skipped ${plural(rejected.length, "line")}.`);
  return { ok: true, message: parts.join(" "), added, existing, rejected };
}
