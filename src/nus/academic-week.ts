import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";

// Which week of the NUS academic year a date falls in. This is NUSMods' own
// rule, ported from their nusmoderator package (MIT licence):
// https://github.com/nusmodifications/nusmods/tree/master/packages/nusmoderator
//
// It is a calendar rule, not live data: the year starts on the first Monday
// of August (orientation week), each semester has 13 teaching weeks with a
// recess week after week 6, then a reading week and two exam weeks.

export type AcadWeekType =
  | "Instructional"
  | "Recess"
  | "Reading"
  | "Examination"
  | "Vacation"
  | "Orientation";

export type AcadSemester =
  "Semester 1" | "Semester 2" | "Special Term I" | "Special Term II";

export type AcadWeekInfo = {
  year: string; // e.g. "26/27"
  sem: AcadSemester | null;
  type: AcadWeekType | null;
  num: number | null;
};

function day(isoDate: string): DateTime {
  return DateTime.fromISO(isoDate, { zone: SINGAPORE_TIME_ZONE }).startOf(
    "day",
  );
}

// The Monday of orientation week: the first Monday on or after 1 August.
export function acadYearStart(startYear: number): string {
  const firstOfAugust = DateTime.fromObject(
    { year: startYear, month: 8, day: 1 },
    { zone: SINGAPORE_TIME_ZONE },
  );
  const daysToMonday = (8 - firstOfAugust.weekday) % 7;
  return firstOfAugust.plus({ days: daysToMonday }).toISODate()!;
}

function acadYearOf(date: DateTime): { year: string; start: DateTime } {
  const startThisYear = day(acadYearStart(date.year));
  const startYear = date < startThisYear ? date.year - 1 : date.year;
  const short = (value: number) => String(value % 100).padStart(2, "0");
  return {
    year: `${short(startYear)}/${short(startYear + 1)}`,
    start: day(acadYearStart(startYear)),
  };
}

function semesterOf(weekOfYear: number): AcadSemester | null {
  if (weekOfYear < 1) return null;
  if (weekOfYear <= 23) return "Semester 1";
  if (weekOfYear <= 40) return "Semester 2";
  if (weekOfYear <= 46) return "Special Term I";
  if (weekOfYear <= 52) return "Special Term II";
  return null;
}

// isoDate is a Singapore calendar date, YYYY-MM-DD.
export function acadWeekInfo(isoDate: string): AcadWeekInfo {
  const date = day(isoDate);
  const { year, start } = acadYearOf(date);
  const weekOfYear = Math.floor(date.diff(start, "days").days / 7) + 1;
  const sem = semesterOf(weekOfYear);
  const isWeekend = date.weekday >= 6;

  if (sem === "Semester 1" || sem === "Semester 2") {
    // Semester 2 starts 22 weeks after semester 1.
    const week = sem === "Semester 2" ? weekOfYear - 22 : weekOfYear;
    if (week === 1) return { year, sem, type: "Orientation", num: null };
    if (week > 18) return { year, sem, type: "Vacation", num: week - 18 };

    const semWeek = week - 1;
    // Recess, reading and exam weeks begin on the weekend before them.
    if (isWeekend && semWeek === 6) {
      return { year, sem, type: "Recess", num: null };
    }
    if (isWeekend && semWeek === 14) {
      return { year, sem, type: "Reading", num: null };
    }
    if (isWeekend && semWeek === 15) {
      return { year, sem, type: "Examination", num: 1 };
    }
    if (semWeek === 7) return { year, sem, type: "Recess", num: null };
    if (semWeek === 15) return { year, sem, type: "Reading", num: null };
    if (semWeek === 16 || semWeek === 17) {
      return { year, sem, type: "Examination", num: semWeek - 15 };
    }
    return {
      year,
      sem,
      type: "Instructional",
      // Teaching weeks after recess week are numbered one lower.
      num: semWeek >= 8 ? semWeek - 1 : semWeek,
    };
  }

  if (sem === "Special Term I") {
    return { year, sem, type: "Instructional", num: weekOfYear - 40 };
  }
  if (sem === "Special Term II") {
    return { year, sem, type: "Instructional", num: weekOfYear - 46 };
  }
  // A 53rd week, which happens a few times every 28 years, is vacation.
  return { year, sem, type: weekOfYear === 53 ? "Vacation" : null, num: null };
}

const SEMESTER_NUMBER: Record<AcadSemester, number> = {
  "Semester 1": 1,
  "Semester 2": 2,
  "Special Term I": 3,
  "Special Term II": 4,
};

// NUSMods numbers semesters 1-4 and writes the year as "2026-2027".
export function semesterNumber(sem: AcadSemester): number {
  return SEMESTER_NUMBER[sem];
}

export function longAcadYear(year: string): string {
  const [from, to] = year.split("/");
  return `20${from}-20${to}`;
}

export function nextAcadYear(year: string): string {
  const [from, to] = year.split("/").map(Number);
  const short = (value: number) => String(value % 100).padStart(2, "0");
  return `${short(from + 1)}/${short(to + 1)}`;
}

// A teaching week of semester 1 or 2 (weeks 1-13); null in recess, reading,
// exam, vacation and orientation weeks, and outside the two semesters.
export function teachingWeek(
  isoDate: string,
): { year: string; semester: number; week: number } | null {
  const info = acadWeekInfo(isoDate);
  if (
    info.type !== "Instructional" ||
    info.num === null ||
    (info.sem !== "Semester 1" && info.sem !== "Semester 2") ||
    info.num < 1 ||
    info.num > 13
  ) {
    return null;
  }
  return {
    year: longAcadYear(info.year),
    semester: semesterNumber(info.sem),
    week: info.num,
  };
}
