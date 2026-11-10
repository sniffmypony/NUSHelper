import { DateTime } from "luxon";

export const SINGAPORE_TIME_ZONE = "Asia/Singapore";

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

export function todayInSingapore(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SINGAPORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function mondayOfSingaporeWeek(date: string): string {
  const value = DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE });
  return value.minus({ days: value.weekday - 1 }).toISODate()!;
}

export function singaporeDateRange(
  startDate: string,
  numberOfDays: number,
): { timeMin: string; timeMax: string } {
  const start = DateTime.fromISO(startDate, {
    zone: SINGAPORE_TIME_ZONE,
  }).startOf("day");
  if (!start.isValid || numberOfDays < 1) {
    throw new Error("Invalid Singapore date range");
  }

  return {
    timeMin: start.toISO()!,
    timeMax: start.plus({ days: numberOfDays }).toISO()!,
  };
}
