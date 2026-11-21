import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import type { BotOwnedEvent } from "../calendar/types.js";

// Finals from NUSMods, put on Google Calendar when a timetable is saved.

export interface Exam {
  moduleCode: string;
  title: string;
  start: string; // ISO timestamp from NUSMods (UTC)
  durationMinutes: number;
}

export interface ExamCalendar {
  putEvent(eventId: string, event: BotOwnedEvent): Promise<void>;
  delete(eventId: string): Promise<"deleted" | "already-deleted">;
}

export function examTimes(exam: Exam): { start: DateTime; end: DateTime } {
  const start = DateTime.fromISO(exam.start, { zone: "utc" }).setZone(
    SINGAPORE_TIME_ZONE,
  );
  return { start, end: start.plus({ minutes: exam.durationMinutes }) };
}

export function formatExam(exam: Exam): string {
  const { start, end } = examTimes(exam);
  return `${exam.moduleCode} ${start.toFormat("ccc d LLL, HH:mm")}–${end.toFormat("HH:mm")}`;
}

// Google Calendar ids may use 0-9 and a-v, so lowercase hex is valid. The id
// depends only on the year, semester and module: saving the timetable again
// updates the same event, and a moved exam moves its event.
export function examEventId(
  acadYear: string,
  semester: number,
  moduleCode: string,
): string {
  return createHash("sha256")
    .update(`nusmods-exam:${acadYear}:${semester}:${moduleCode}`)
    .digest("hex")
    .slice(0, 40);
}

export function examEvent(
  exam: Exam,
  acadYear: string,
  semester: number,
): BotOwnedEvent {
  const { start, end } = examTimes(exam);
  return {
    title: `📝 Final: ${exam.moduleCode} ${exam.title}`,
    description: `Final exam from your NUSMods timetable (AY${acadYear.replace("-", "/")} Semester ${semester}). NUSMods has no exam venues; check the NUS exam timetable for yours.`,
    startDateTime: start.toISO({ suppressMilliseconds: true })!,
    endDateTime: end.toISO({ suppressMilliseconds: true })!,
  };
}

export interface ExamSyncResult {
  saved: string[];
  removed: string[];
  failed: string[];
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Puts every exam on the calendar and removes the exam events of
// `previousModules` (the same semester's earlier timetable) that are gone
// now. Removing an exam event that never existed is harmless.
export async function syncExamEvents(
  calendar: ExamCalendar,
  acadYear: string,
  semester: number,
  exams: Exam[],
  previousModules: string[],
): Promise<ExamSyncResult> {
  const result: ExamSyncResult = { saved: [], removed: [], failed: [] };
  const id = (moduleCode: string) =>
    examEventId(acadYear, semester, moduleCode);

  await Promise.all(
    exams.map(async (exam) => {
      try {
        await calendar.putEvent(
          id(exam.moduleCode),
          examEvent(exam, acadYear, semester),
        );
        result.saved.push(exam.moduleCode);
      } catch (error) {
        console.error(
          `Saving the ${exam.moduleCode} exam event failed (${errorType(error)})`,
        );
        result.failed.push(exam.moduleCode);
      }
    }),
  );

  const kept = new Set(exams.map((exam) => exam.moduleCode));
  const dropped = [...new Set(previousModules)].filter(
    (code) => !kept.has(code),
  );
  await Promise.all(
    dropped.map(async (moduleCode) => {
      try {
        if ((await calendar.delete(id(moduleCode))) === "deleted") {
          result.removed.push(moduleCode);
        }
      } catch (error) {
        console.error(
          `Removing the ${moduleCode} exam event failed (${errorType(error)})`,
        );
        result.failed.push(moduleCode);
      }
    }),
  );

  for (const list of Object.values(result)) list.sort();
  return result;
}

export function formatExamSync(result: ExamSyncResult): string {
  const lines: string[] = [];
  if (result.saved.length > 0) {
    lines.push(
      `📅 ${result.saved.length} final${result.saved.length === 1 ? "" : "s"} on Google Calendar: ${result.saved.join(", ")}`,
    );
  }
  if (result.removed.length > 0) {
    lines.push(
      `🗑 Removed the finals of dropped modules: ${result.removed.join(", ")}`,
    );
  }
  if (result.failed.length > 0) {
    lines.push(
      `⚠️ Couldn't update Google Calendar for: ${result.failed.join(", ")}. Send the link again to retry.`,
    );
  }
  return lines.join("\n");
}
