import { describe, expect, it, vi } from "vitest";
import {
  CanvasRequestError,
  type CanvasAssignment,
  type CanvasCourse,
} from "../src/canvas/client.js";
import {
  CHECK_BEFORE_MS,
  deadlineEventId,
  formatSyncResult,
  runDeadlineChecks,
  submissionState,
  syncDeadlines,
  type CanvasDeadlineSource,
  type DeadlineStore,
  type StoredDeadline,
} from "../src/canvas/deadline-sync.js";

// Fri 20 Nov 2026, 08:00 in Singapore.
const NOW = new Date("2026-11-20T00:00:00Z");

const COURSES: CanvasCourse[] = [
  { id: 1, name: "CS2102 Database Systems", course_code: "CS2102" },
  { id: 2, name: "ST2334 Probability and Statistics", course_code: "ST2334" },
];

function assignment(
  id: number,
  dueAt: string | null,
  extra: Partial<CanvasAssignment> = {},
): CanvasAssignment {
  return {
    id,
    name: `Assignment ${id}`,
    due_at: dueAt,
    html_url: `https://canvas.nus.edu.sg/courses/1/assignments/${id}`,
    submission_types: ["online_upload"],
    ...extra,
  };
}

class MemoryStore implements DeadlineStore {
  rows = new Map<number, StoredDeadline>();
  async all() {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
  async upsert(deadlines: Omit<StoredDeadline, "checkedForDueAt">[]) {
    for (const deadline of deadlines) {
      const before = this.rows.get(deadline.assignmentId);
      this.rows.set(deadline.assignmentId, {
        ...deadline,
        checkedForDueAt: before?.checkedForDueAt ?? null,
      });
    }
  }
  async remove(ids: number[]) {
    for (const id of ids) this.rows.delete(id);
  }
  async claimChecks(now: Date) {
    const claimed: StoredDeadline[] = [];
    for (const row of this.rows.values()) {
      const due = row.dueAt.getTime();
      if (
        due > now.getTime() &&
        due <= now.getTime() + CHECK_BEFORE_MS &&
        row.checkedForDueAt?.getTime() !== due
      ) {
        row.checkedForDueAt = row.dueAt;
        claimed.push({ ...row });
      }
    }
    return claimed;
  }
}

function source(byCourse: Record<number, CanvasAssignment[] | Error>) {
  return {
    listActiveCourses: vi.fn().mockResolvedValue(COURSES),
    listFutureAssignments: vi.fn(async (courseId: number) => {
      const value = byCourse[courseId] ?? [];
      if (value instanceof Error) throw value;
      return value;
    }),
    getAssignment: vi.fn(),
  } satisfies CanvasDeadlineSource;
}

// Like Google: an event id, once used (even by a deleted event), can't be
// created again.
function fakeCalendar() {
  const used = new Set<string>();
  return {
    used,
    putEvent: vi.fn(async (eventId: string) => {
      used.add(eventId);
    }),
    addEventIfMissing: vi.fn(async (eventId: string) => {
      if (used.has(eventId)) return "exists" as const;
      used.add(eventId);
      return "created" as const;
    }),
    delete: vi.fn().mockResolvedValue("deleted" as const),
  };
}

describe("daily Canvas deadline sync", () => {
  it("stores upcoming deadlines and puts each on Calendar as the hour before it", async () => {
    const store = new MemoryStore();
    const calendar = fakeCalendar();
    const result = await syncDeadlines(
      source({
        1: [
          // Due 23:59 Thu 26 Nov in Singapore.
          assignment(101, "2026-11-26T15:59:00Z", { name: "Project Part 2" }),
          assignment(102, null), // no due date
          assignment(103, "2026-11-19T15:59:00Z"), // already past
          assignment(104, "2027-08-01T15:59:00Z"), // beyond 180 days
        ],
        2: [assignment(201, "2026-11-22T04:00:00Z", { name: "Quiz 9" })],
      }),
      store,
      calendar,
      NOW,
    );

    expect(result.added.map((d) => d.assignmentId)).toEqual([201, 101]);
    expect([...store.rows.keys()].sort()).toEqual([101, 201]);
    // Titled like the user's own events, with only the deadline as notes.
    expect(calendar.addEventIfMissing).toHaveBeenCalledWith(
      deadlineEventId(101),
      {
        title: "CS2102 Project Part 2",
        description: "Due Thu 26 Nov 2026, 23:59",
        startDateTime: "2026-11-26T22:59:00+08:00",
        endDateTime: "2026-11-26T23:59:00+08:00",
      },
    );
    expect(calendar.putEvent).not.toHaveBeenCalled();
    expect(formatSyncResult(result, true)).toBe(
      [
        "📌 New Canvas deadlines, added to Google Calendar:",
        "• Sun 22 Nov, 12:00 — ST2334: Quiz 9",
        "• Thu 26 Nov, 23:59 — CS2102: Project Part 2",
      ].join("\n"),
    );
  });

  it("moves changed deadlines, removes deleted ones and says nothing when nothing changed", async () => {
    const store = new MemoryStore();
    const calendar = fakeCalendar();
    const first = {
      1: [
        assignment(101, "2026-11-26T15:59:00Z", { name: "Project Part 2" }),
        assignment(102, "2026-11-27T15:59:00Z", { name: "Tutorial 10" }),
      ],
    };
    await syncDeadlines(source(first), store, calendar, NOW);

    // The next day's sync leaves existing events alone, so the user's own
    // edits (or older-style events) are kept.
    calendar.addEventIfMissing.mockClear();
    const unchanged = await syncDeadlines(source(first), store, calendar, NOW);
    expect(formatSyncResult(unchanged, true)).toBeNull();
    expect(calendar.putEvent).not.toHaveBeenCalled();
    expect(
      await Promise.all(
        calendar.addEventIfMissing.mock.results.map((call) => call.value),
      ),
    ).toEqual(["exists", "exists"]);

    calendar.putEvent.mockClear();
    const result = await syncDeadlines(
      source({
        1: [
          assignment(101, "2026-11-28T15:59:00Z", { name: "Project Part 2" }),
        ],
      }),
      store,
      calendar,
      NOW,
    );
    expect(result.moved.map((d) => d.assignmentId)).toEqual([101]);
    expect(result.removed.map((d) => d.assignmentId)).toEqual([102]);
    expect(calendar.putEvent).toHaveBeenCalledWith(
      deadlineEventId(101),
      expect.objectContaining({ endDateTime: "2026-11-28T23:59:00+08:00" }),
    );
    expect(calendar.delete).toHaveBeenCalledWith(deadlineEventId(102));
    expect([...store.rows.keys()]).toEqual([101]);
    expect(formatSyncResult(result, true)).toBe(
      [
        "🔁 Deadline moved on Canvas (Calendar updated):",
        "• Sat 28 Nov, 23:59 — CS2102: Project Part 2",
        "",
        "🗑 No longer on Canvas, removed from Google Calendar:",
        "• Fri 27 Nov, 23:59 — CS2102: Tutorial 10",
      ].join("\n"),
    );
  });

  it("keeps a module's deadlines when Canvas refuses its assignments", async () => {
    const store = new MemoryStore();
    await syncDeadlines(
      source({ 2: [assignment(201, "2026-11-22T04:00:00Z")] }),
      store,
      null,
      NOW,
    );
    const calendar = fakeCalendar();
    const result = await syncDeadlines(
      source({ 2: new CanvasRequestError("Forbidden", 403) }),
      store,
      calendar,
      NOW,
    );
    expect(result.skippedCourses).toEqual(["ST2334"]);
    expect(result.removed).toEqual([]);
    expect(store.rows.has(201)).toBe(true);
    expect(calendar.delete).not.toHaveBeenCalled();
  });

  it("forgets past deadlines without touching Calendar, and works without Calendar", async () => {
    const store = new MemoryStore();
    await syncDeadlines(
      source({ 1: [assignment(101, "2026-11-20T15:59:00Z")] }),
      store,
      null,
      NOW,
    );
    const later = new Date("2026-11-21T00:00:00Z");
    const calendar = fakeCalendar();
    const result = await syncDeadlines(source({}), store, calendar, later);
    expect(store.rows.size).toBe(0);
    expect(result.removed).toEqual([]);
    expect(calendar.delete).not.toHaveBeenCalled();

    const offline = await syncDeadlines(
      source({ 1: [assignment(105, "2026-11-30T15:59:00Z")] }),
      new MemoryStore(),
      null,
      NOW,
    );
    expect(formatSyncResult(offline, false)).toBe(
      "📌 New Canvas deadline:\n• Mon 30 Nov, 23:59 — CS2102: Assignment 105",
    );
  });

  it("reports Calendar failures and retries them the next day", async () => {
    const calendar = fakeCalendar();
    const store = new MemoryStore();
    const canvas = source({ 1: [assignment(101, "2026-11-26T15:59:00Z")] });
    calendar.addEventIfMissing.mockRejectedValueOnce(new Error("quota"));
    const result = await syncDeadlines(canvas, store, calendar, NOW);
    expect(result.calendarFailed).toBe(1);
    expect(formatSyncResult(result, true)).toContain(
      "⚠️ 1 Google Calendar update failed; tomorrow's sync will retry.",
    );

    // Already stored, so not "new" the next day, but its event is created.
    const retry = await syncDeadlines(canvas, store, calendar, NOW);
    expect(retry.calendarFailed).toBe(0);
    expect(calendar.used.has(deadlineEventId(101))).toBe(true);
  });

  it("tidies runs of spaces in Canvas names", async () => {
    const store = new MemoryStore();
    const calendar = fakeCalendar();
    await syncDeadlines(
      source({
        2: [
          assignment(201, "2026-11-22T15:59:00Z", {
            name: "    Post-Lecture  Quiz Week 12 ",
          }),
        ],
      }),
      store,
      calendar,
      NOW,
    );
    expect(store.rows.get(201)?.name).toBe("Post-Lecture Quiz Week 12");
    expect(calendar.addEventIfMissing).toHaveBeenCalledWith(
      deadlineEventId(201),
      expect.objectContaining({ title: "ST2334 Post-Lecture Quiz Week 12" }),
    );
  });

  it("uses a valid Google event id per assignment", () => {
    expect(deadlineEventId(101)).toMatch(/^[0-9a-v]{40}$/);
    expect(deadlineEventId(102)).not.toBe(deadlineEventId(101));
  });
});

describe("one hour before a deadline", () => {
  async function storeWith(
    dueAt: string,
    extra: Partial<CanvasAssignment> = {},
  ) {
    const store = new MemoryStore();
    await syncDeadlines(
      source({
        1: [assignment(101, dueAt, { name: "Project Part 2", ...extra })],
      }),
      store,
      null,
      NOW,
    );
    return store;
  }

  // 23:59 Thu 26 Nov; checks run from 22:59.
  const DUE = "2026-11-26T15:59:00Z";
  const AT_22_59 = new Date("2026-11-26T14:59:00Z");

  it("warns when nothing is submitted, once", async () => {
    const store = await storeWith(DUE);
    const send = vi.fn().mockResolvedValue(undefined);
    const canvas = {
      getAssignment: vi.fn().mockResolvedValue(
        assignment(101, DUE, {
          submission: { workflow_state: "unsubmitted" },
        }),
      ),
    };
    expect(
      await runDeadlineChecks(
        store,
        canvas,
        send,
        new Date("2026-11-26T14:58:00Z"),
      ),
    ).toEqual({ sent: 0, skipped: 0, failed: 0 });

    expect(await runDeadlineChecks(store, canvas, send, AT_22_59)).toEqual({
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    expect(send).toHaveBeenCalledWith(
      "⚠️ CS2102: Project Part 2 is due at 23:59 (in 1 hour) and nothing is submitted yet. Submit something now!\nhttps://canvas.nus.edu.sg/courses/1/assignments/101",
    );
    expect(canvas.getAssignment).toHaveBeenCalledWith(1, 101);

    // The next minute's run doesn't send it again.
    await runDeadlineChecks(
      store,
      canvas,
      send,
      new Date("2026-11-26T15:00:00Z"),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when a submission is in", async () => {
    const store = await storeWith(DUE);
    const send = vi.fn().mockResolvedValue(undefined);
    const canvas = {
      getAssignment: vi.fn().mockResolvedValue(
        assignment(101, DUE, {
          submission: {
            workflow_state: "submitted",
            submitted_at: "2026-11-26T13:14:00Z",
          },
        }),
      ),
    };
    expect(await runDeadlineChecks(store, canvas, send, AT_22_59)).toEqual({
      sent: 0,
      skipped: 1,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    // Still claimed, so the next minute doesn't ask Canvas again.
    await runDeadlineChecks(
      store,
      canvas,
      send,
      new Date("2026-11-26T15:00:00Z"),
    );
    expect(canvas.getAssignment).toHaveBeenCalledTimes(1);
  });

  it("can't tell for work handed in elsewhere, or when Canvas fails", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeadlineChecks(
      await storeWith(DUE),
      {
        getAssignment: vi
          .fn()
          .mockResolvedValue(
            assignment(101, DUE, { submission_types: ["on_paper"] }),
          ),
      },
      send,
      AT_22_59,
    );
    await runDeadlineChecks(
      await storeWith(DUE),
      { getAssignment: vi.fn().mockRejectedValue(new Error("timeout")) },
      send,
      new Date("2026-11-26T15:29:00Z"),
    );
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      "⏰ CS2102: Project Part 2 is due at 23:59 (in 1 hour). I can't see submissions for this one on Canvas, so check it's handed in.\nhttps://canvas.nus.edu.sg/courses/1/assignments/101",
      "⏰ CS2102: Project Part 2 is due at 23:59 (in 30 min). I can't see submissions for this one on Canvas, so check it's handed in.\nhttps://canvas.nus.edu.sg/courses/1/assignments/101",
    ]);
  });

  it("checks a moved deadline again", async () => {
    const store = await storeWith(DUE);
    const send = vi.fn().mockResolvedValue(undefined);
    const canvas = { getAssignment: vi.fn().mockRejectedValue(new Error("x")) };
    await runDeadlineChecks(store, canvas, send, AT_22_59);
    // Extended by a day after the check was sent.
    await syncDeadlines(
      source({
        1: [
          assignment(101, "2026-11-27T15:59:00Z", { name: "Project Part 2" }),
        ],
      }),
      store,
      null,
      NOW,
    );
    await runDeadlineChecks(
      store,
      canvas,
      send,
      new Date("2026-11-27T14:59:00Z"),
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reads Canvas submission states", () => {
    const base = assignment(1, DUE);
    expect(
      submissionState({ ...base, submission: { submitted_at: "x" } }),
    ).toBe("submitted");
    expect(submissionState({ ...base, submission: { excused: true } })).toBe(
      "submitted",
    );
    expect(
      submissionState({
        ...base,
        submission: { workflow_state: "unsubmitted" },
      }),
    ).toBe("missing");
    expect(submissionState({ ...base, submission_types: ["none"] })).toBe(
      "unknown",
    );
    expect(
      submissionState({
        ...base,
        submission_types: ["online_quiz"],
        submission: { workflow_state: "unsubmitted" },
      }),
    ).toBe("missing");
  });
});
