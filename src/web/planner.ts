import { DateTime } from "luxon";
import {
  SINGAPORE_TIME_ZONE,
  addDays,
  mondayOfSingaporeWeek,
} from "../dates.js";
import {
  acadWeekInfo,
  longAcadYear,
  semesterNumber,
} from "../nus/academic-week.js";

// Pure helpers behind the website's planner pages (Today, Spending,
// Timetable, Deadlines) and its CSV export. The database side is in
// planner-actions.ts.

const zone = { zone: SINGAPORE_TIME_ZONE };

export type Result = { ok: boolean; message: string };

export type ExportKind =
  | "spending"
  | "tasks"
  | "todos"
  | "reminders"
  | "repeating"
  | "chats"
  | "applepay";

export const EXPORT_KINDS: ExportKind[] = [
  "spending",
  "tasks",
  "todos",
  "reminders",
  "repeating",
  "chats",
  "applepay",
];

// ---- Spending ---------------------------------------------------------

export interface SpendingDay {
  date: string;
  // Null: nothing recorded (yet). Future days are always null.
  cents: number | null;
  status: string | null;
  future: boolean;
}

export interface SpendingMonth {
  month: string; // YYYY-MM
  label: string; // "November 2026"
  days: SpendingDay[];
  totalCents: number;
  // Days up to today with a total recorded (zero days included).
  recordedDays: number;
  // Average over the recorded days; null when there are none.
  averageCents: number | null;
  highest: { date: string; cents: number } | null;
  // Monday-to-Sunday weeks that touch the month, counting only its days.
  weeks: Array<{ start: string; end: string; cents: number }>;
  // The month before, for comparison.
  previousTotalCents: number;
}

export function isMonth(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

export function monthBounds(month: string): { start: string; end: string } {
  const first = DateTime.fromISO(`${month}-01`, zone);
  return {
    start: first.toISODate()!,
    end: first.endOf("month").toISODate()!,
  };
}

export function previousMonth(month: string): string {
  return DateTime.fromISO(`${month}-01`, zone)
    .minus({ months: 1 })
    .toFormat("yyyy-MM");
}

export function spendingMonth(
  month: string,
  rows: Array<{ spendDate: string; totalCents: number; status: string }>,
  previousRows: Array<{ totalCents: number }>,
  today: string,
): SpendingMonth {
  const { start, end } = monthBounds(month);
  const byDate = new Map(rows.map((row) => [row.spendDate, row]));
  const days: SpendingDay[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const row = byDate.get(date);
    const future = date > today;
    days.push({
      date,
      cents: future || !row ? null : row.totalCents,
      status: future || !row ? null : row.status,
      future,
    });
  }
  const recorded = days.filter((day) => day.cents !== null);
  const totalCents = recorded.reduce((sum, day) => sum + day.cents!, 0);
  const highest = recorded.reduce<{ date: string; cents: number } | null>(
    (best, day) =>
      day.cents! > 0 && (!best || day.cents! > best.cents)
        ? { date: day.date, cents: day.cents! }
        : best,
    null,
  );

  const weeks: SpendingMonth["weeks"] = [];
  for (
    let monday = mondayOfSingaporeWeek(start);
    monday <= end;
    monday = addDays(monday, 7)
  ) {
    const sunday = addDays(monday, 6);
    const cents = recorded
      .filter((day) => day.date >= monday && day.date <= sunday)
      .reduce((sum, day) => sum + day.cents!, 0);
    weeks.push({
      start: monday < start ? start : monday,
      end: sunday > end ? end : sunday,
      cents,
    });
  }

  return {
    month,
    label: DateTime.fromISO(`${month}-01`, zone).toFormat("LLLL yyyy"),
    days,
    totalCents,
    recordedDays: recorded.length,
    averageCents:
      recorded.length > 0 ? Math.round(totalCents / recorded.length) : null,
    highest,
    weeks,
    previousTotalCents: previousRows.reduce(
      (sum, row) => sum + row.totalCents,
      0,
    ),
  };
}

// ---- CSV ----------------------------------------------------------------

// One CSV cell. Text that a spreadsheet would run as a formula (starting
// with = + - @ or a tab) gets a leading apostrophe; numbers stay numbers.
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(
  header: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  return [header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(","))
    .join("\r\n")
    .concat("\r\n");
}

// ---- Timetable ------------------------------------------------------------

export interface WeekLesson {
  acadYear: string;
  semester: number;
  moduleCode: string;
  lessonType: string;
  classNo: string;
  day: number;
  startTime: string;
  endTime: string;
  venue?: string | null;
}

const SEMESTER_NAMES: Record<number, string> = {
  1: "Semester 1",
  2: "Semester 2",
  3: "Special Term I",
  4: "Special Term II",
};

// The saved semester to show: the one running today if it's saved,
// otherwise the latest saved one.
export function chooseSemester(
  lessons: WeekLesson[],
  today: string,
): { acadYear: string; semester: number; label: string } | null {
  if (lessons.length === 0) return null;
  const info = acadWeekInfo(today);
  // Between semesters (vacation) there is no current one.
  const current = info.sem
    ? { acadYear: longAcadYear(info.year), semester: semesterNumber(info.sem) }
    : null;
  const saved = [
    ...new Map(
      lessons.map((lesson) => [
        `${lesson.acadYear}:${lesson.semester}`,
        { acadYear: lesson.acadYear, semester: lesson.semester },
      ]),
    ).values(),
  ];
  const pick =
    saved.find(
      (term) =>
        current !== null &&
        term.acadYear === current.acadYear &&
        term.semester === current.semester,
    ) ??
    saved.sort((a, b) =>
      a.acadYear === b.acadYear
        ? b.semester - a.semester
        : b.acadYear.localeCompare(a.acadYear),
    )[0];
  return {
    ...pick,
    label: `AY${pick.acadYear.replace("-", "/")} ${SEMESTER_NAMES[pick.semester] ?? `Semester ${pick.semester}`}`,
  };
}

// ---- Deadlines --------------------------------------------------------------

export interface DeadlineView {
  assignmentId: number;
  moduleCode: string;
  name: string;
  dueAt: string; // ISO
  url: string | null;
}

// Upcoming deadlines (soonest first) and those of the last 14 days (most
// recent first).
export function splitDeadlines(
  deadlines: Array<{
    assignmentId: number;
    moduleCode: string;
    name: string;
    dueAt: Date;
    htmlUrl: string | null;
  }>,
  now: Date,
): { upcoming: DeadlineView[]; recent: DeadlineView[] } {
  const view = (d: (typeof deadlines)[number]): DeadlineView => ({
    assignmentId: d.assignmentId,
    moduleCode: d.moduleCode,
    name: d.name,
    dueAt: d.dueAt.toISOString(),
    url: d.htmlUrl,
  });
  const since = now.getTime() - 14 * 86_400_000;
  return {
    upcoming: deadlines
      .filter((d) => d.dueAt.getTime() > now.getTime())
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map(view),
    recent: deadlines
      .filter(
        (d) => d.dueAt.getTime() <= now.getTime() && d.dueAt.getTime() > since,
      )
      .sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime())
      .map(view),
  };
}
