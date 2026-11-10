import { DateTime } from "luxon";
import {
  SINGAPORE_TIME_ZONE,
  addDays,
  isValidIsoDate,
  todayInSingapore,
} from "./dates.js";

export type ExpenditureDay = {
  spendDate: string;
  totalCents: number;
  status: string;
};

export type DatePeriod = { start: string; end: string };

export type MonthlyQuery = DatePeriod & {
  label: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function parseExpenditureAmounts(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || !/^[\d.,\s]+$/.test(trimmed)) return null;

  const tokens = trimmed.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let total = 0n;
  for (const token of tokens) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(token);
    if (!match) return null;
    const cents =
      BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
    total += cents;
    if (total > 2_147_483_647n) return null;
  }

  return Number(total);
}

export function formatCurrency(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `S$${dollars.toLocaleString("en-SG")}.${String(remainder).padStart(2, "0")}`;
}

export function formatLongDate(date: string): string {
  return DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE }).toFormat(
    "d LLLL yyyy",
  );
}

export function parseMonthlyExpenditureQuery(
  text: string,
): MonthlyQuery | null {
  const match = /^\s*([a-z]+)\s+(\d{4})\s+expenditure\s*$/i.exec(text);
  if (!match) return null;
  const monthIndex = MONTHS.findIndex(
    (month) => month.toLowerCase() === match[1].toLowerCase(),
  );
  if (monthIndex < 0) return null;

  const year = Number(match[2]);
  if (year < 1) return null;
  const start = DateTime.fromObject(
    { year, month: monthIndex + 1, day: 1 },
    { zone: SINGAPORE_TIME_ZONE },
  );
  return {
    start: start.toISODate()!,
    end: start.endOf("month").toISODate()!,
    label: `${MONTHS[monthIndex]} ${year}`,
  };
}

export function weekPeriodFor(date: string): DatePeriod {
  const value = DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE });
  const start = value.minus({ days: value.weekday - 1 });
  return {
    start: start.toISODate()!,
    end: start.plus({ days: 6 }).toISODate()!,
  };
}

export function monthPeriodFor(date: string): DatePeriod {
  const value = DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE });
  return {
    start: value.startOf("month").toISODate()!,
    end: value.endOf("month").toISODate()!,
  };
}

export function isSunday(date: string): boolean {
  return DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE }).weekday === 7;
}

export function isMonthEnd(date: string): boolean {
  const value = DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE });
  return value.day === value.daysInMonth;
}

export function clippedWeeks(start: string, end: string): DatePeriod[] {
  const periods: DatePeriod[] = [];
  let cursor = DateTime.fromISO(start, { zone: SINGAPORE_TIME_ZONE });
  const last = DateTime.fromISO(end, { zone: SINGAPORE_TIME_ZONE });
  while (cursor <= last) {
    const segmentEnd = DateTime.min(
      cursor.plus({ days: 7 - cursor.weekday }),
      last,
    );
    periods.push({ start: cursor.toISODate()!, end: segmentEnd.toISODate()! });
    cursor = segmentEnd.plus({ days: 1 });
  }
  return periods;
}

function totalFor(days: ExpenditureDay[], start: string, end: string): number {
  return days
    .filter((day) => day.spendDate >= start && day.spendDate <= end)
    .reduce((sum, day) => sum + day.totalCents, 0);
}

function shortDate(date: string): string {
  return DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE }).toFormat(
    "d LLL",
  );
}

export function formatWeeklyReport(
  days: ExpenditureDay[],
  period: DatePeriod,
  corrected = false,
): string {
  const sunday = DateTime.fromISO(period.end, { zone: SINGAPORE_TIME_ZONE });
  const monthStart = sunday.startOf("month").toISODate()!;
  const weeklyTotal = totalFor(days, period.start, period.end);
  const monthToDate = totalFor(days, monthStart, period.end);
  return [
    `Weekly expenditure report${corrected ? " (Corrected)" : ""}`,
    `${shortDate(period.start)} – ${shortDate(period.end)}: ${formatCurrency(weeklyTotal)}`,
    `${sunday.toFormat("LLLL")} month-to-date: ${formatCurrency(monthToDate)}`,
  ].join("\n");
}

export function formatMonthlyReport(
  days: ExpenditureDay[],
  period: DatePeriod,
  corrected = false,
  historical = false,
): string {
  const month = DateTime.fromISO(period.start, { zone: SINGAPORE_TIME_ZONE });
  const stored = days.filter(
    (day) => day.spendDate >= period.start && day.spendDate <= period.end,
  );
  const weeks = clippedWeeks(period.start, period.end).map((week) => ({
    ...week,
    totalCents: totalFor(stored, week.start, week.end),
  }));
  const total = stored.reduce((sum, day) => sum + day.totalCents, 0);
  const maximum = Math.max(...weeks.map((week) => week.totalCents), 0);
  const lines = [
    `${month.toFormat("LLLL yyyy")} expenditure report${corrected ? " (Corrected)" : ""}`,
    `Total: ${formatCurrency(total)}`,
    "Weekly breakdown:",
    ...weeks.map(
      (week) =>
        `${shortDate(week.start)} – ${shortDate(week.end)}: ${formatCurrency(week.totalCents)}`,
    ),
  ];

  if (maximum === 0) {
    lines.push("Highest-spend week: all recorded weeks were S$0.00.");
  } else {
    const highest = weeks.filter((week) => week.totalCents === maximum);
    lines.push(
      `Highest-spend week${highest.length > 1 ? "s" : ""}: ${highest
        .map((week) => `${shortDate(week.start)} – ${shortDate(week.end)}`)
        .join(", ")} (${formatCurrency(maximum)})`,
    );
  }

  if (historical && stored.length > 0) {
    const dates = stored.map((day) => day.spendDate).sort();
    const expectedDays = month.daysInMonth ?? 0;
    lines.push(
      `Recorded coverage: ${formatLongDate(dates[0])} to ${formatLongDate(dates.at(-1)!)} (${stored.length}/${expectedDays} days stored).`,
    );
  }
  return lines.join("\n");
}

export function editDeadline(date: string): Date {
  return DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE })
    .plus({ days: 366 })
    .startOf("day")
    .toJSDate();
}

export function isDateEditable(date: string, now = new Date()): boolean {
  const value = DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE });
  const current = DateTime.fromJSDate(now, { zone: SINGAPORE_TIME_ZONE });
  return (
    value.isValid && value <= current.endOf("day") && now < editDeadline(date)
  );
}

// Daytime entries for today wait for the nightly prompt before reports go out,
// so a Sunday lunch entry does not send the weekly report early.
export function shouldSendReportsNow(
  spendDate: string,
  now = new Date(),
): boolean {
  const local = DateTime.fromJSDate(now).setZone(SINGAPORE_TIME_ZONE);
  if (spendDate !== local.toISODate()) return true;
  return local.hour === 23 && local.minute >= 30;
}

const MAX_BREAKDOWN_DAYS = 366;

function parseDayMonthYear(day: string, month: string, year: string) {
  const iso = `${year}-${month}-${day}`;
  return isValidIsoDate(iso) ? iso : null;
}

// "/expenditure 03-12-2026 15-12-2026", or one date for a single day. Uses the
// same DD-MM-YYYY format as calendar messages.
export function parseExpenditureBreakdownCommand(
  text: string,
): DatePeriod | null {
  const match =
    /^\/expenditure(?:@\w+)?\s+(\d{2})-(\d{2})-(\d{4})(?:\s+(?:to\s+)?(\d{2})-(\d{2})-(\d{4}))?\s*$/i.exec(
      text.trim(),
    );
  if (!match) return null;
  const start = parseDayMonthYear(match[1], match[2], match[3]);
  const end = match[4]
    ? parseDayMonthYear(match[4], match[5], match[6])
    : start;
  return start && end ? { start, end } : null;
}

export function breakdownRangeProblem(period: DatePeriod): string | null {
  if (period.start > period.end) {
    return "The start date must be on or before the end date.";
  }
  const days = DateTime.fromISO(period.end, { zone: SINGAPORE_TIME_ZONE }).diff(
    DateTime.fromISO(period.start, { zone: SINGAPORE_TIME_ZONE }),
    "days",
  ).days;
  return days >= MAX_BREAKDOWN_DAYS
    ? `A breakdown can cover at most ${MAX_BREAKDOWN_DAYS} days.`
    : null;
}

function breakdownLine(date: string, day: ExpenditureDay | undefined): string {
  const label = DateTime.fromISO(date, { zone: SINGAPORE_TIME_ZONE }).toFormat(
    "ccc d LLL",
  );
  if (day?.status === "logged") {
    return `${label}: ${formatCurrency(day.totalCents)}`;
  }
  if (day?.status === "auto_zero") {
    return `${label}: ${formatCurrency(day.totalCents)} (nothing logged)`;
  }
  return `${label}: no entry`;
}

// One line per day. Days after today are left out rather than shown as gaps.
export function formatDailyBreakdown(
  days: ExpenditureDay[],
  period: DatePeriod,
  today = todayInSingapore(),
): string {
  const range = `${formatLongDate(period.start)} to ${formatLongDate(period.end)}`;
  if (period.start > today) {
    return `${formatLongDate(period.start)} is still in the future, so there is no expenditure to show yet.`;
  }
  if (days.length === 0) return `No expenditure is stored for ${range}.`;

  const byDate = new Map(days.map((day) => [day.spendDate, day]));
  const lastDay = period.end < today ? period.end : today;
  const lines = [`Expenditure from ${range}:`, ""];
  let total = 0;
  let logged = 0;
  let count = 0;
  for (let date = period.start; date <= lastDay; date = addDays(date, 1)) {
    const day = byDate.get(date);
    lines.push(breakdownLine(date, day));
    count += 1;
    if (day) total += day.totalCents;
    if (day?.status === "logged") logged += 1;
  }
  lines.push(
    "",
    `Total: ${formatCurrency(total)}`,
    `Logged on ${logged} of ${count} days.`,
  );
  if (period.end > today) lines.push("Later dates haven't happened yet.");
  return lines.join("\n");
}
