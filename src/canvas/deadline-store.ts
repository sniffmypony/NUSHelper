import { and, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { canvasDeadlines } from "../db/schema.js";
import {
  CHECK_BEFORE_MS,
  type DeadlineStore,
  type StoredDeadline,
} from "./deadline-sync.js";

function toDeadline(row: typeof canvasDeadlines.$inferSelect): StoredDeadline {
  return {
    assignmentId: row.assignmentId,
    courseId: row.courseId,
    moduleCode: row.moduleCode,
    name: row.name,
    dueAt: row.dueAt,
    htmlUrl: row.htmlUrl,
    checkedForDueAt: row.checkedForDueAt,
  };
}

export const deadlineStore: DeadlineStore = {
  async all() {
    return (await db.select().from(canvasDeadlines)).map(toDeadline);
  },

  async upsert(deadlines) {
    if (deadlines.length === 0) return;
    await db
      .insert(canvasDeadlines)
      .values(deadlines.map((deadline) => ({ ...deadline })))
      .onConflictDoUpdate({
        target: canvasDeadlines.assignmentId,
        set: {
          courseId: sql`excluded.course_id`,
          moduleCode: sql`excluded.module_code`,
          name: sql`excluded.name`,
          dueAt: sql`excluded.due_at`,
          htmlUrl: sql`excluded.html_url`,
          updatedAt: sql`now()`,
        },
      });
  },

  async remove(assignmentIds) {
    if (assignmentIds.length === 0) return;
    await db
      .delete(canvasDeadlines)
      .where(inArray(canvasDeadlines.assignmentId, assignmentIds));
  },

  // One statement, so two overlapping dispatcher runs can't both claim a row.
  async claimChecks(now) {
    const rows = await db
      .update(canvasDeadlines)
      .set({ checkedForDueAt: sql`${canvasDeadlines.dueAt}` })
      .where(
        and(
          gt(canvasDeadlines.dueAt, now),
          lte(canvasDeadlines.dueAt, new Date(now.getTime() + CHECK_BEFORE_MS)),
          or(
            isNull(canvasDeadlines.checkedForDueAt),
            ne(canvasDeadlines.checkedForDueAt, canvasDeadlines.dueAt),
          ),
        ),
      )
      .returning();
    return rows.map(toDeadline);
  },
};
