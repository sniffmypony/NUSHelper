import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import type { BotOwnedEvent } from "../calendar/types.js";
import {
  CanvasRequestError,
  type CanvasAssignment,
  type CanvasCourse,
} from "./client.js";
import { primaryModuleCode } from "./modules.js";

// Canvas deadlines on Google Calendar, and a check an hour before each one.
//
// The daily sync (api/cron/canvas-deadlines) copies every upcoming assignment
// with a due date into canvas_deadlines and puts it on Google Calendar as the
// hour ending at the deadline (due 23:59 → 22:59–23:59). The event id comes
// from the assignment id, so a moved deadline moves its event; an assignment
// that disappears from Canvas has its event removed.
//
// The per-minute dispatcher (api/cron/reminder-dispatch) asks Canvas about
// each deadline an hour before it and says whether something is submitted.

const SYNC_DAYS = 180;
export const CHECK_BEFORE_MS = 60 * 60_000;

export interface StoredDeadline {
  assignmentId: number;
  courseId: number;
  moduleCode: string;
  name: string;
  dueAt: Date;
  htmlUrl: string | null;
  checkedForDueAt: Date | null;
}

export interface DeadlineStore {
  all(): Promise<StoredDeadline[]>;
  // Inserts or updates by assignment id, keeping checkedForDueAt.
  upsert(deadlines: Omit<StoredDeadline, "checkedForDueAt">[]): Promise<void>;
  remove(assignmentIds: number[]): Promise<void>;
  // Deadlines due within the next hour whose check hasn't been sent for
  // their current due time, marked as sent so no other run sends it too.
  claimChecks(now: Date): Promise<StoredDeadline[]>;
}

export interface CanvasDeadlineSource {
  listActiveCourses(): Promise<CanvasCourse[]>;
  listFutureAssignments(courseId: number): Promise<CanvasAssignment[]>;
  getAssignment(
    courseId: number,
    assignmentId: number,
  ): Promise<CanvasAssignment>;
}

export interface DeadlineCalendar {
  putEvent(eventId: string, event: BotOwnedEvent): Promise<void>;
  delete(eventId: string): Promise<"deleted" | "already-deleted">;
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// A valid Google Calendar id (0-9, a-v) that depends only on the assignment.
export function deadlineEventId(assignmentId: number): string {
  return createHash("sha256")
    .update(`canvas-deadline:${assignmentId}`)
    .digest("hex")
    .slice(0, 40);
}

function local(date: Date): DateTime {
  return DateTime.fromJSDate(date).setZone(SINGAPORE_TIME_ZONE);
}

export function deadlineEvent(deadline: StoredDeadline): BotOwnedEvent {
  const due = local(deadline.dueAt);
  return {
    title: `📌 Due: ${deadline.moduleCode} ${deadline.name}`,
    description: [
      `Canvas deadline: ${due.toFormat("ccc d LLL yyyy, HH:mm")}.`,
      ...(deadline.htmlUrl ? [deadline.htmlUrl] : []),
      "Added by NUSHelper; it moves with the deadline on Canvas.",
    ].join("\n"),
    startDateTime: due
      .minus({ hours: 1 })
      .toISO({ suppressMilliseconds: true })!,
    endDateTime: due.toISO({ suppressMilliseconds: true })!,
  };
}

export interface SyncResult {
  added: StoredDeadline[];
  moved: StoredDeadline[];
  removed: StoredDeadline[];
  calendarFailed: number;
  // Modules whose assignments Canvas refused; their stored deadlines are kept.
  skippedCourses: string[];
}

// Reads Canvas, updates the store and, when given, Google Calendar.
export async function syncDeadlines(
  source: CanvasDeadlineSource,
  store: DeadlineStore,
  calendar: DeadlineCalendar | null,
  now: Date,
): Promise<SyncResult> {
  const result: SyncResult = {
    added: [],
    moved: [],
    removed: [],
    calendarFailed: 0,
    skippedCourses: [],
  };
  const until = now.getTime() + SYNC_DAYS * 24 * 60 * 60_000;
  const courses = await source.listActiveCourses();
  const fetchedCourses = new Set<number>();
  const current: Omit<StoredDeadline, "checkedForDueAt">[] = [];

  await Promise.all(
    courses.map(async (course) => {
      let assignments: CanvasAssignment[];
      try {
        assignments = await source.listFutureAssignments(course.id);
      } catch (error) {
        if (!(error instanceof CanvasRequestError)) throw error;
        result.skippedCourses.push(primaryModuleCode(course));
        return;
      }
      fetchedCourses.add(course.id);
      for (const assignment of assignments) {
        const due = assignment.due_at ? new Date(assignment.due_at) : null;
        if (!due || Number.isNaN(due.getTime())) continue;
        if (due.getTime() <= now.getTime() || due.getTime() > until) continue;
        current.push({
          assignmentId: assignment.id,
          courseId: course.id,
          moduleCode: primaryModuleCode(course),
          name: assignment.name,
          dueAt: due,
          htmlUrl: assignment.html_url ?? null,
        });
      }
    }),
  );

  const stored = new Map(
    (await store.all()).map((deadline) => [deadline.assignmentId, deadline]),
  );
  const seen = new Set(current.map((deadline) => deadline.assignmentId));
  for (const deadline of current) {
    const before = stored.get(deadline.assignmentId);
    const full = {
      ...deadline,
      checkedForDueAt: before?.checkedForDueAt ?? null,
    };
    if (!before) result.added.push(full);
    else if (before.dueAt.getTime() !== deadline.dueAt.getTime()) {
      result.moved.push(full);
    }
  }
  // Stored deadlines Canvas no longer lists: past ones are simply forgotten;
  // upcoming ones from a course Canvas did answer for were deleted or
  // unpublished there; ones from a course it refused are kept for now.
  const forget: number[] = [];
  for (const deadline of stored.values()) {
    if (seen.has(deadline.assignmentId)) continue;
    if (deadline.dueAt.getTime() <= now.getTime()) {
      forget.push(deadline.assignmentId);
    } else if (fetchedCourses.has(deadline.courseId)) {
      forget.push(deadline.assignmentId);
      result.removed.push(deadline);
    }
  }

  await store.upsert(current);
  if (forget.length > 0) await store.remove(forget);

  if (calendar) {
    // Every upcoming deadline is written each day, so an event deleted or
    // edited by hand comes back as Canvas has it.
    const writes = [
      ...current.map(
        (deadline) => () =>
          calendar.putEvent(
            deadlineEventId(deadline.assignmentId),
            deadlineEvent({ ...deadline, checkedForDueAt: null }),
          ),
      ),
      ...result.removed.map((deadline) => async () => {
        await calendar.delete(deadlineEventId(deadline.assignmentId));
      }),
    ];
    const outcomes = await Promise.allSettled(writes.map((write) => write()));
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        result.calendarFailed += 1;
        console.error(
          `Canvas deadline calendar write failed (${errorType(outcome.reason)})`,
        );
      }
    }
  }

  const byDue = (a: StoredDeadline, b: StoredDeadline) =>
    a.dueAt.getTime() - b.dueAt.getTime();
  result.added.sort(byDue);
  result.moved.sort(byDue);
  result.removed.sort(byDue);
  result.skippedCourses.sort();
  return result;
}

function dueText(deadline: StoredDeadline): string {
  return local(deadline.dueAt).toFormat("ccc d LLL, HH:mm");
}

function deadlineLine(deadline: StoredDeadline): string {
  return `• ${dueText(deadline)} — ${deadline.moduleCode}: ${deadline.name}`;
}

// The message after a sync, or null when nothing changed.
export function formatSyncResult(
  result: SyncResult,
  calendarOn: boolean,
): string | null {
  const sections: string[] = [];
  if (result.added.length > 0) {
    sections.push(
      [
        `📌 New Canvas deadline${result.added.length === 1 ? "" : "s"}${calendarOn ? ", added to Google Calendar" : ""}:`,
        ...result.added.map(deadlineLine),
      ].join("\n"),
    );
  }
  if (result.moved.length > 0) {
    sections.push(
      [
        `🔁 Deadline${result.moved.length === 1 ? "" : "s"} moved on Canvas${calendarOn ? " (Calendar updated)" : ""}:`,
        ...result.moved.map(deadlineLine),
      ].join("\n"),
    );
  }
  if (result.removed.length > 0) {
    sections.push(
      [
        `🗑 No longer on Canvas${calendarOn ? ", removed from Google Calendar" : ""}:`,
        ...result.removed.map(deadlineLine),
      ].join("\n"),
    );
  }
  if (sections.length === 0) return null;
  if (result.calendarFailed > 0) {
    sections.push(
      `⚠️ ${result.calendarFailed} Google Calendar update${result.calendarFailed === 1 ? "" : "s"} failed; tomorrow's sync will retry.`,
    );
  }
  return sections.join("\n\n");
}

// Submissions Canvas itself receives; anything else (on paper, none, an
// external tool) can't be checked here.
const CANVAS_SUBMISSION_TYPES = new Set([
  "online_upload",
  "online_text_entry",
  "online_url",
  "online_quiz",
  "media_recording",
  "student_annotation",
  "discussion_topic",
]);

export type SubmissionState = "submitted" | "missing" | "unknown";

export function submissionState(assignment: CanvasAssignment): SubmissionState {
  const types = assignment.submission_types ?? [];
  if (!types.some((type) => CANVAS_SUBMISSION_TYPES.has(type))) {
    return "unknown";
  }
  const submission = assignment.submission;
  if (submission?.excused) return "submitted";
  if (submission?.submitted_at) return "submitted";
  return submission ? "missing" : "unknown";
}

export function formatDeadlineCheck(
  deadline: StoredDeadline,
  state: SubmissionState,
  submittedAt: string | null,
  now: Date,
): string {
  const minutes = Math.max(
    1,
    Math.round((deadline.dueAt.getTime() - now.getTime()) / 60_000),
  );
  const left = minutes >= 60 ? "in 1 hour" : `in ${minutes} min`;
  const what = `${deadline.moduleCode}: ${deadline.name}`;
  const due = local(deadline.dueAt).toFormat("HH:mm");
  const link = deadline.htmlUrl ? `\n${deadline.htmlUrl}` : "";
  if (state === "submitted") {
    const at = submittedAt
      ? ` (submitted ${local(new Date(submittedAt)).toFormat("ccc d LLL, HH:mm")})`
      : "";
    return `✅ ${what} is due at ${due} (${left}). Your submission is in${at}, you're good.`;
  }
  if (state === "missing") {
    return `⚠️ ${what} is due at ${due} (${left}) and nothing is submitted yet. Submit something now!${link}`;
  }
  return `⏰ ${what} is due at ${due} (${left}). I can't see submissions for this one on Canvas, so check it's handed in.${link}`;
}

// Sends the one-hour check for every deadline that needs it. A Canvas
// failure still sends the check, without the submission state.
export async function runDeadlineChecks(
  store: DeadlineStore,
  source: Pick<CanvasDeadlineSource, "getAssignment">,
  send: (text: string) => Promise<void>,
  now: Date,
): Promise<{ sent: number; failed: number }> {
  const due = await store.claimChecks(now);
  let sent = 0;
  let failed = 0;
  for (const deadline of due) {
    let state: SubmissionState = "unknown";
    let submittedAt: string | null = null;
    try {
      const assignment = await source.getAssignment(
        deadline.courseId,
        deadline.assignmentId,
      );
      state = submissionState(assignment);
      submittedAt = assignment.submission?.submitted_at ?? null;
    } catch (error) {
      console.error(`Canvas submission check failed (${errorType(error)})`);
    }
    try {
      await send(formatDeadlineCheck(deadline, state, submittedAt, now));
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Deadline check delivery failed (${errorType(error)})`);
    }
  }
  return { sent, failed };
}
