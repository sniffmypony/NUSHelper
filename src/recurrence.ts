import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "./dates.js";

// When a repeating item (/every) is due. Stored as text: "daily",
// "weekly:1,4" (ISO weekdays, 1 = Monday) or "monthly:15".

export type RecurrenceRule =
  | { kind: "daily" }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "monthly"; day: number };

const WEEKDAYS: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// "day", "weekdays", "mon", "mon,thu" or a day of the month such as "1" or "15th".
export function parseRecurrence(when: string): RecurrenceRule | null {
  const value = when.toLowerCase();
  if (value === "day" || value === "daily" || value === "everyday") {
    return { kind: "daily" };
  }
  if (value === "weekday" || value === "weekdays") {
    return { kind: "weekly", weekdays: [1, 2, 3, 4, 5] };
  }
  if (value === "weekend" || value === "weekends") {
    return { kind: "weekly", weekdays: [6, 7] };
  }

  const dayOfMonth = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(value);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    return day >= 1 && day <= 31 ? { kind: "monthly", day } : null;
  }

  const weekdays = value.split(",").map((part) => WEEKDAYS[part]);
  if (weekdays.length === 0 || weekdays.some((day) => day === undefined)) {
    return null;
  }
  return {
    kind: "weekly",
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
  };
}

export const RECURRING_USAGE = [
  "Usage: /every <when> <description>",
  "/every mon tutorial prep",
  "/every mon,thu gym",
  "/every weekdays check email",
  "/every day take vitamins",
  "/every 1 pay phone bill — the 1st of each month",
].join("\n");

export function parseRecurringCommand(
  line: string,
): { rule: RecurrenceRule; description: string } | null {
  const match = /^\/every(?:@\w+)? (\S+) ([^\s].*)$/.exec(line.trimEnd());
  if (!match) return null;
  const rule = parseRecurrence(match[1]);
  const description = match[2].trimEnd();
  return rule && description ? { rule, description } : null;
}

export function encodeRule(rule: RecurrenceRule): string {
  if (rule.kind === "daily") return "daily";
  if (rule.kind === "weekly") return `weekly:${rule.weekdays.join(",")}`;
  return `monthly:${rule.day}`;
}

export function decodeRule(text: string): RecurrenceRule | null {
  if (text === "daily") return { kind: "daily" };
  const weekly = /^weekly:([1-7](?:,[1-7])*)$/.exec(text);
  if (weekly) {
    return { kind: "weekly", weekdays: weekly[1].split(",").map(Number) };
  }
  const monthly = /^monthly:(\d{1,2})$/.exec(text);
  if (monthly) {
    const day = Number(monthly[1]);
    if (day >= 1 && day <= 31) return { kind: "monthly", day };
  }
  return null;
}

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeRule(rule: RecurrenceRule): string {
  if (rule.kind === "daily") return "every day";
  if (rule.kind === "monthly") {
    return `on the ${ordinal(rule.day)} of each month`;
  }
  if (rule.weekdays.join(",") === "1,2,3,4,5") return "every weekday";
  return `every ${joinNames(rule.weekdays.map((day) => WEEKDAY_NAMES[day - 1]))}`;
}

// Is the item due on this Singapore date (YYYY-MM-DD)? A monthly item for
// the 29th-31st falls on the last day of a shorter month.
export function isDueOn(rule: RecurrenceRule, isoDate: string): boolean {
  const date = DateTime.fromISO(isoDate, { zone: SINGAPORE_TIME_ZONE });
  if (!date.isValid) return false;
  if (rule.kind === "daily") return true;
  if (rule.kind === "weekly") return rule.weekdays.includes(date.weekday);
  return date.day === Math.min(rule.day, date.daysInMonth ?? 31);
}
