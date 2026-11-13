import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";

// Reads a NUSMods timetable share link and picks the chosen classes out of
// NUSMods' module data. NUSMods has used three link formats:
//   v1  CS2103T=LEC:G14,TUT:T05                  (class numbers)
//   v2  CS4243=LAB:(1);LEC:(5)                   (positions in the timetable)
//   v3  CS4243=LAB:(2|TUE|1600|1800|AS6-0421|3_4_5);LEC:(...)   (class details)

// A lesson as the NUSMods API returns it.
export type RawLesson = {
  classNo: string;
  startTime: string;
  endTime: string;
  weeks: unknown;
  day: string;
  lessonType: string;
  venue?: string;
};

export type ShareLink = {
  semester: number;
  modules: Array<{ moduleCode: string; config: string }>;
};

const LESSON_ABBREV_TYPE: Record<string, string> = {
  DLEC: "Design Lecture",
  LAB: "Laboratory",
  LEC: "Lecture",
  PLAB: "Packaged Laboratory",
  PLEC: "Packaged Lecture",
  PTUT: "Packaged Tutorial",
  REC: "Recitation",
  SEC: "Sectional Teaching",
  SEM: "Seminar-Style Module Class",
  TUT: "Tutorial",
  TUT2: "Tutorial Type 2",
  TUT3: "Tutorial Type 3",
  WS: "Workshop",
};

const SEMESTER_PATHS: Record<string, number> = {
  "sem-1": 1,
  "sem-2": 2,
  "st-i": 3,
  "st-ii": 4,
};

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const NUSMODS_HOSTS = new Set(["nusmods.com", "www.nusmods.com"]);
export const NUSMODS_SHORT_HOST = "shorten.nusmods.com";
const MAX_MODULES = 15;

// ISO weekday (1 = Monday) from "Monday" or "MON"; 0 if it is not a day.
export function weekdayNumber(day: string): number {
  const wanted = day.slice(0, 3).toLowerCase();
  return (
    DAYS.findIndex((name) => name.slice(0, 3).toLowerCase() === wanted) + 1
  );
}

export function parseShareLink(link: string): ShareLink | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !NUSMODS_HOSTS.has(url.hostname)) {
    return null;
  }
  const path = /^\/timetable\/([a-z0-9-]+)(?:\/share)?\/?$/i.exec(url.pathname);
  const semester = path ? SEMESTER_PATHS[path[1].toLowerCase()] : undefined;
  if (!semester) return null;

  const hidden = new Set(
    (url.searchParams.get("hidden") ?? "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  );
  const modules: ShareLink["modules"] = [];
  for (const [key, value] of url.searchParams) {
    const moduleCode = key.trim().toUpperCase();
    if (moduleCode === "HIDDEN" || moduleCode === "TA") continue;
    if (!/^[A-Z]{2,5}\d{4}[A-Z0-9]{0,4}$/.test(moduleCode)) continue;
    // A module hidden on NUSMods is one the student is not attending.
    if (hidden.has(moduleCode)) continue;
    if (modules.some((module) => module.moduleCode === moduleCode)) continue;
    modules.push({ moduleCode, config: value.trim() });
  }
  if (modules.length === 0 || modules.length > MAX_MODULES) return null;
  return { semester, modules };
}

function sameLesson(a: RawLesson, b: RawLesson): boolean {
  return (
    a.lessonType === b.lessonType &&
    a.classNo === b.classNo &&
    a.day === b.day &&
    a.startTime === b.startTime &&
    a.venue === b.venue
  );
}

// The lessons a module's part of the link picks from that module's timetable.
export function selectLessons(
  config: string,
  timetable: readonly RawLesson[],
): RawLesson[] {
  const chosen: RawLesson[] = [];
  const add = (lessons: Array<RawLesson | undefined>) => {
    for (const lesson of lessons) {
      if (lesson && !chosen.some((other) => sameLesson(other, lesson))) {
        chosen.push(lesson);
      }
    }
  };

  if (config.endsWith(")")) {
    for (const part of config.split(";")) {
      const match = /^([A-Z0-9]+):\((.*)\)$/.exec(part.trim());
      const lessonType = match ? LESSON_ABBREV_TYPE[match[1]] : undefined;
      if (!match || !lessonType) continue;
      for (const identifier of match[2].split(",")) {
        if (/^\d+$/.test(identifier)) {
          const lesson = timetable[Number(identifier)];
          add(lesson?.lessonType === lessonType ? [lesson] : []);
          continue;
        }
        const [classNo, day, startTime] = identifier.split("|");
        add(
          timetable.filter(
            (lesson) =>
              lesson.lessonType === lessonType &&
              lesson.classNo === classNo &&
              weekdayNumber(lesson.day) === weekdayNumber(day ?? "") &&
              lesson.startTime === startTime,
          ),
        );
      }
    }
    return chosen;
  }

  for (const part of config.split(",")) {
    const [abbreviation, classNo] = part.trim().split(":");
    const lessonType = LESSON_ABBREV_TYPE[abbreviation];
    if (!lessonType || !classNo) continue;
    add(
      timetable.filter(
        (lesson) =>
          lesson.lessonType === lessonType && lesson.classNo === classNo,
      ),
    );
  }
  return chosen;
}

// Does a lesson run in this teaching week? NUSMods gives either the week
// numbers, or a date range with an optional interval or list of weeks.
export function lessonRunsOn(
  weeks: unknown,
  isoDate: string,
  teachingWeek: number,
): boolean {
  if (Array.isArray(weeks)) return weeks.includes(teachingWeek);
  if (!weeks || typeof weeks !== "object") return false;

  const range = weeks as {
    start?: string;
    end?: string;
    weekInterval?: number;
    weeks?: number[];
  };
  const zone = { zone: SINGAPORE_TIME_ZONE };
  const date = DateTime.fromISO(isoDate, zone);
  const start = DateTime.fromISO(range.start ?? "", zone);
  const end = DateTime.fromISO(range.end ?? "", zone);
  if (!date.isValid || !start.isValid || !end.isValid) return false;
  if (date < start.startOf("day") || date > end.endOf("day")) return false;

  const weekOfRange =
    Math.floor(date.diff(start.startOf("day"), "days").days / 7) + 1;
  if (Array.isArray(range.weeks)) return range.weeks.includes(weekOfRange);
  const interval = range.weekInterval ?? 1;
  return interval >= 1 && (weekOfRange - 1) % interval === 0;
}

export type ClassLine = {
  moduleCode: string;
  lessonType: string;
  startTime: string;
  endTime: string;
  venue: string;
};

const clock = (time: string) => `${time.slice(0, 2)}:${time.slice(2)}`;

export function formatClass(lesson: ClassLine): string {
  return `• ${clock(lesson.startTime)}–${clock(lesson.endTime)} ${lesson.moduleCode} ${lesson.lessonType}${lesson.venue ? ` — ${lesson.venue}` : ""}`;
}

export function dayName(isoWeekday: number): string {
  return DAYS[isoWeekday - 1] ?? "";
}
