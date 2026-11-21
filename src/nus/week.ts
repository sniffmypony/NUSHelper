import { DateTime } from "luxon";
import { addDays, isValidIsoDate, todayInSingapore } from "../dates.js";
import { optionalEnv } from "../env.js";
import { acadWeekInfo, type AcadWeekInfo } from "./academic-week.js";

// The academic week as a short label, "Y2S1W7, AY 26/27", and the longer
// /week answer. Built on acadWeekInfo (NUSMods' rule).

const SEMESTER_CODES: Record<NonNullable<AcadWeekInfo["sem"]>, string> = {
  "Semester 1": "S1",
  "Semester 2": "S2",
  "Special Term I": "ST1",
  "Special Term II": "ST2",
};

// NUS_MATRICULATION_YEAR is the year Year 1 started, e.g. 2025 for a student
// who matriculated in AY2025/26. Optional: without it labels have no "Y2".
export function matriculationYear(): number | null {
  const raw = optionalEnv("NUS_MATRICULATION_YEAR");
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  return year;
}

export function yearOfStudy(
  info: AcadWeekInfo,
  matriculation: number | null,
): number | null {
  if (matriculation === null) return null;
  const startYear = 2000 + Number(info.year.slice(0, 2));
  const year = startYear - matriculation + 1;
  return year >= 1 && year <= 8 ? year : null;
}

// "Week 7", "Recess Week", "Exam Week 1", ...
export function periodName(info: AcadWeekInfo): string {
  switch (info.type) {
    case "Instructional":
      return `Week ${info.num}`;
    case "Orientation":
      return "Orientation Week";
    case "Recess":
      return "Recess Week";
    case "Reading":
      return "Reading Week";
    case "Examination":
      return `Exam Week ${info.num}`;
    default:
      return "Vacation";
  }
}

export function acadWeekLabel(
  isoDate: string,
  matriculation: number | null = matriculationYear(),
): string {
  const info = acadWeekInfo(isoDate);
  const year = yearOfStudy(info, matriculation);
  const prefix = `${year ? `Y${year}` : ""}${info.sem ? SEMESTER_CODES[info.sem] : ""}`;
  const ay = `AY ${info.year}`;
  if (info.type === "Instructional") return `${prefix}W${info.num}, ${ay}`;
  return `${prefix ? `${prefix} ` : ""}${periodName(info)}, ${ay}`;
}

// Vacation weeks are numbered, but /week shows the whole vacation.
const samePeriod = (a: AcadWeekInfo, b: AcadWeekInfo) =>
  a.year === b.year &&
  a.sem === b.sem &&
  a.type === b.type &&
  (a.num === b.num || a.type === "Vacation");

// Walks day by day; the rule is pure arithmetic, so this is cheap.
function findDay(
  from: string,
  step: 1 | -1,
  limit: number,
  match: (info: AcadWeekInfo, date: string) => boolean,
): string | null {
  let date = from;
  for (let i = 0; i < limit; i++) {
    date = addDays(date, step);
    if (match(acadWeekInfo(date), date)) return date;
  }
  return null;
}

// First and last day of the period a date is in.
function periodRange(isoDate: string): { start: string; end: string } {
  const info = acadWeekInfo(isoDate);
  const differs = (other: AcadWeekInfo) => !samePeriod(info, other);
  const before = findDay(isoDate, -1, 120, differs);
  const after = findDay(isoDate, 1, 120, differs);
  return {
    start: before ? addDays(before, 1) : isoDate,
    end: after ? addDays(after, -1) : isoDate,
  };
}

function formatDay(date: string): string {
  return DateTime.fromISO(date).toFormat("ccc d LLL yyyy");
}

function formatRange(start: string, end: string): string {
  return start === end
    ? formatDay(start)
    : `${formatDay(start)} – ${formatDay(end)}`;
}

function inDays(from: string, to: string): string {
  const days = Math.round(
    DateTime.fromISO(to).diff(DateTime.fromISO(from), "days").days,
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  if (weeks === 0) return `in ${days} days`;
  const weekText = `${weeks} week${weeks === 1 ? "" : "s"}`;
  return rest === 0
    ? `in ${weekText}`
    : `in ${weekText} ${rest} day${rest === 1 ? "" : "s"}`;
}

// The last exam day of the exam period a date is in.
function lastExamDay(examDate: string): string {
  const after = findDay(examDate, 1, 21, (o) => o.type !== "Examination");
  return after ? addDays(after, -1) : examDate;
}

// /week and the assistant's academic_week tool: the label, the period's
// dates (and odd/even in teaching weeks), and what comes next.
export function describeAcadWeek(
  isoDate: string,
  matriculation: number | null = matriculationYear(),
): string {
  const info = acadWeekInfo(isoDate);
  const lines = [acadWeekLabel(isoDate, matriculation)];
  const { start, end } = periodRange(isoDate);
  const isSemester = info.sem === "Semester 1" || info.sem === "Semester 2";
  const parity =
    info.type === "Instructional" && isSemester && info.num !== null
      ? ` (${info.num % 2 ? "odd" : "even"} week)`
      : "";
  lines.push(`${periodName(info)}${parity}: ${formatRange(start, end)}`);

  const inSameSemester = (other: AcadWeekInfo) =>
    other.year === info.year && other.sem === info.sem;
  if (isSemester && info.type === "Examination") {
    const examEnd = lastExamDay(isoDate);
    lines.push(
      `Finals end ${formatDay(examEnd)} (${inDays(isoDate, examEnd)})`,
    );
  } else if (isSemester && info.type !== "Vacation") {
    const examStart = findDay(
      isoDate,
      1,
      160,
      (o) => inSameSemester(o) && o.type === "Examination",
    );
    if (examStart) {
      const examEnd = lastExamDay(examStart);
      lines.push(
        `Finals: ${formatRange(examStart, examEnd)} (start ${inDays(isoDate, examStart)})`,
      );
    }
  } else {
    const next = findDay(
      isoDate,
      1,
      200,
      (o) =>
        (o.sem === "Semester 1" || o.sem === "Semester 2") &&
        o.type === "Instructional" &&
        o.num === 1,
    );
    if (next) {
      const nextInfo = acadWeekInfo(next);
      lines.push(
        `Next: AY ${nextInfo.year} ${nextInfo.sem} Week 1 starts ${formatDay(next)} (${inDays(isoDate, next)})`,
      );
    }
  }
  return lines.join("\n");
}

// /week, /week DD-MM-YYYY. Returns YYYY-MM-DD (today when no date is given),
// or null for anything else.
export function parseWeekCommand(
  text: string,
  today = todayInSingapore(),
): string | null {
  const match = /^\/week(?:@\w+)?(?:\s+(\d{1,2})-(\d{1,2})-(\d{4}))?\s*$/i.exec(
    text.trim(),
  );
  if (!match) return null;
  if (!match[1]) return today;
  const date = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isValidIsoDate(date) ? date : null;
}
