import { and, asc, eq } from "drizzle-orm";
import type { Telegraf } from "telegraf";
import { todayInSingapore } from "../dates.js";
import { db } from "../db/client.js";
import { timetableLessons } from "../db/schema.js";
import {
  acadWeekInfo,
  longAcadYear,
  nextAcadYear,
  teachingWeek,
} from "./academic-week.js";
import {
  NUSMODS_HOSTS,
  NUSMODS_SHORT_HOST,
  dayName,
  formatClass,
  lessonRunsOn,
  parseShareLink,
  selectLessons,
  weekdayNumber,
  type RawLesson,
} from "./timetable-link.js";

// The class timetable (/timetable): imported once from a NUSMods share link
// and stored, so the morning message needs no network call. Classes are only
// announced in teaching weeks 1-13; recess, reading, exam and vacation weeks
// stay silent.

const NUSMODS_API = "https://api.nusmods.com/v2";
const REQUEST_TIMEOUT_MS = 15_000;

export const TIMETABLE_USAGE = [
  "Send your NUSMods share link after the command:",
  "/timetable https://nusmods.com/timetable/sem-2/share?CS2103T=LEC:G14,TUT:T05",
  "On NUSMods, open your timetable and use Share/Sync to copy the link.",
  "/timetable on its own shows what is saved; /timetable clear removes it.",
].join("\n");

type ModuleData = {
  semesterData?: Array<{ semester: number; timetable?: RawLesson[] }>;
};

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; redirect?: "manual" },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type NewLesson = typeof timetableLessons.$inferInsert;

export interface TimetableStore {
  replaceAll(lessons: NewLesson[]): Promise<void>;
  clear(): Promise<void>;
  all(): Promise<NewLesson[]>;
  forDay(acadYear: string, semester: number, day: number): Promise<NewLesson[]>;
}

export const timetableStore: TimetableStore = {
  async replaceAll(lessons) {
    await db.transaction(async (tx) => {
      await tx.delete(timetableLessons);
      if (lessons.length > 0) await tx.insert(timetableLessons).values(lessons);
    });
  },
  async clear() {
    await db.delete(timetableLessons);
  },
  all() {
    return db
      .select()
      .from(timetableLessons)
      .orderBy(asc(timetableLessons.day), asc(timetableLessons.startTime));
  },
  forDay(acadYear, semester, day) {
    return db
      .select()
      .from(timetableLessons)
      .where(
        and(
          eq(timetableLessons.acadYear, acadYear),
          eq(timetableLessons.semester, semester),
          eq(timetableLessons.day, day),
        ),
      )
      .orderBy(asc(timetableLessons.startTime));
  },
};

// A short NUSMods link only redirects to the full one; nothing else is followed.
async function expandShortLink(
  link: string,
  fetchImpl: FetchLike,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return link;
  }
  if (url.protocol !== "https:" || url.hostname !== NUSMODS_SHORT_HOST) {
    return link;
  }
  const response = await fetchImpl(url.toString(), {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const target = response.headers.get("location");
  if (!target) return link;
  try {
    return NUSMODS_HOSTS.has(new URL(target).hostname) ? target : link;
  } catch {
    return link;
  }
}

async function fetchTimetable(
  acadYear: string,
  moduleCode: string,
  semester: number,
  fetchImpl: FetchLike,
): Promise<RawLesson[] | null> {
  const response = await fetchImpl(
    `${NUSMODS_API}/${acadYear}/modules/${encodeURIComponent(moduleCode)}.json`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`NUSMods returned HTTP ${response.status}`);
  const data = (await response.json()) as ModuleData;
  const term = data.semesterData?.find((item) => item.semester === semester);
  return term?.timetable ?? null;
}

// A semester 1 link sent after semester 1 has ended is for the coming year.
function acadYearCandidates(semester: number, today: string): string[] {
  const info = acadWeekInfo(today);
  const current = longAcadYear(info.year);
  const next = longAcadYear(nextAcadYear(info.year));
  return semester === 1 && info.sem !== "Semester 1"
    ? [next, current]
    : [current, next];
}

const SEMESTER_LABEL: Record<number, string> = {
  1: "Semester 1",
  2: "Semester 2",
  3: "Special Term I",
  4: "Special Term II",
};

export async function importTimetable(
  link: string,
  now = new Date(),
  store: TimetableStore = timetableStore,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  const parsed = parseShareLink(await expandShortLink(link, fetchImpl));
  if (!parsed) {
    return `That doesn't look like a NUSMods timetable link.\n\n${TIMETABLE_USAGE}`;
  }

  const today = todayInSingapore(now);
  for (const acadYear of acadYearCandidates(parsed.semester, today)) {
    const perModule = await Promise.all(
      parsed.modules.map(async (module) => ({
        module,
        timetable: await fetchTimetable(
          acadYear,
          module.moduleCode,
          parsed.semester,
          fetchImpl,
        ),
      })),
    );
    // None of the modules runs in that year and semester: try the other year.
    if (perModule.every((item) => item.timetable === null)) continue;

    const lessons: NewLesson[] = [];
    const missing: string[] = [];
    for (const { module, timetable } of perModule) {
      const chosen = timetable ? selectLessons(module.config, timetable) : [];
      if (chosen.length === 0) {
        missing.push(module.moduleCode);
        continue;
      }
      for (const lesson of chosen) {
        const day = weekdayNumber(lesson.day);
        if (!day || !/^\d{4}$/.test(lesson.startTime)) continue;
        lessons.push({
          acadYear,
          semester: parsed.semester,
          moduleCode: module.moduleCode,
          lessonType: lesson.lessonType,
          classNo: lesson.classNo,
          day,
          startTime: lesson.startTime,
          endTime: /^\d{4}$/.test(lesson.endTime)
            ? lesson.endTime
            : lesson.startTime,
          venue: lesson.venue ?? "",
          weeks: lesson.weeks ?? [],
        });
      }
    }
    if (lessons.length === 0) continue;

    await store.replaceAll(lessons);
    const moduleCount = new Set(lessons.map((lesson) => lesson.moduleCode))
      .size;
    return [
      `Saved your ${SEMESTER_LABEL[parsed.semester]} timetable (AY${acadYear.replace("-", "/")}): ${lessons.length} ${lessons.length === 1 ? "class" : "classes"} across ${moduleCount} ${moduleCount === 1 ? "module" : "modules"}.`,
      ...(missing.length > 0
        ? [
            `No classes found for: ${missing.join(", ")}. Check them on NUSMods and send the link again.`,
          ]
        : []),
      "",
      formatWeek(lessons),
      "",
      "Each day's classes appear in the 8am message during teaching weeks 1–13. Recess, reading, exam and vacation weeks stay quiet.",
    ].join("\n");
  }
  return "I couldn't find those modules' classes on NUSMods for that semester. Check the link, or try again once NUSMods has the new timetable.";
}

function formatWeek(lessons: NewLesson[]): string {
  const sorted = [...lessons].sort(
    (a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime),
  );
  const lines: string[] = [];
  let currentDay = 0;
  for (const lesson of sorted) {
    if (lesson.day !== currentDay) {
      if (lines.length > 0) lines.push("");
      lines.push(dayName(lesson.day));
      currentDay = lesson.day;
    }
    lines.push(formatClass({ ...lesson, venue: lesson.venue ?? "" }));
  }
  return lines.join("\n");
}

export async function describeTimetable(
  store: TimetableStore = timetableStore,
  now = new Date(),
): Promise<string> {
  const lessons = await store.all();
  if (lessons.length === 0) {
    return `No timetable is saved.\n\n${TIMETABLE_USAGE}`;
  }
  const { acadYear, semester } = lessons[0];
  const week = teachingWeek(todayInSingapore(now));
  const status = !week
    ? "This is not a teaching week, so classes are not announced."
    : week.year === acadYear && week.semester === semester
      ? `This is teaching week ${week.week}.`
      : "This timetable is for a different semester, so nothing is announced. Send a new link with /timetable.";
  return [
    `${SEMESTER_LABEL[semester]}, AY${acadYear.replace("-", "/")}`,
    "",
    formatWeek(lessons),
    "",
    status,
  ].join("\n");
}

// The morning message's class list, or null when there is nothing to show:
// not a teaching week, no timetable for this semester, or no class today.
export async function todaysClassesSection(
  today: string,
  store: TimetableStore = timetableStore,
): Promise<string | null> {
  const week = teachingWeek(today);
  if (!week) return null;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  const lessons = (
    await store.forDay(week.year, week.semester, weekday)
  ).filter((lesson) => lessonRunsOn(lesson.weeks, today, week.week));
  if (lessons.length === 0) return null;
  return [
    `🏫 Today's classes (Week ${week.week}):`,
    ...lessons.map((lesson) =>
      formatClass({ ...lesson, venue: lesson.venue ?? "" }),
    ),
  ].join("\n");
}

export function registerTimetableCommands(bot: Telegraf): void {
  bot.command("timetable", async (ctx) => {
    const argument = ctx.message.text.replace(/^\/timetable(@\w+)?/, "").trim();
    try {
      if (!argument) return await ctx.reply(await describeTimetable());
      if (argument.toLowerCase() === "clear") {
        await timetableStore.clear();
        return await ctx.reply(
          "Timetable removed. Send /timetable with a NUSMods link to add one again.",
        );
      }
      return await ctx.reply(await importTimetable(argument));
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      console.error(`Timetable command failed (${type})`);
      return ctx.reply(
        "I couldn't reach NUSMods or save the timetable just now. Please try again in a bit.",
      );
    }
  });
}
