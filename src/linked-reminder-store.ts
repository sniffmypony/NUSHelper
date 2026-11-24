import { and, asc, eq, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./db/client.js";
import { reminders } from "./db/schema.js";
import {
  CHECK_FAR_EVERY_MIN,
  CHECK_NEAR_EVERY_MIN,
  FINAL_CHECK_MIN,
  NEAR,
  type LinkedReminderStore,
} from "./linked-reminders.js";

// The database side of linked reminders (src/linked-reminders.ts).
export const linkedReminderStore: LinkedReminderStore = {
  async dueForCheck(now, limit) {
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const near = DateTime.fromJSDate(now).plus(NEAR).toJSDate();
    const rows = await db
      .select({
        id: reminders.id,
        eventId: reminders.eventId,
        eventOffsetMin: reminders.eventOffsetMin,
        description: reminders.description,
        scheduledAt: reminders.scheduledAt,
      })
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "pending"),
          isNotNull(reminders.eventId),
          or(
            isNull(reminders.eventCheckedAt),
            lte(reminders.scheduledAt, at(FINAL_CHECK_MIN)),
            and(
              lte(reminders.scheduledAt, near),
              lt(reminders.eventCheckedAt, at(-CHECK_NEAR_EVERY_MIN)),
            ),
            lt(reminders.eventCheckedAt, at(-CHECK_FAR_EVERY_MIN)),
          ),
        ),
      )
      .orderBy(asc(reminders.scheduledAt))
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      eventId: row.eventId!,
      eventOffsetMin: row.eventOffsetMin ?? 0,
    }));
  },

  async update(id, change) {
    await db
      .update(reminders)
      .set({
        scheduledAt: change.scheduledAt,
        expiresAt: change.expiresAt,
        description: change.description,
        eventCheckedAt: change.checkedAt,
        updatedAt: change.checkedAt,
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, "pending")));
  },

  async markChecked(id, checkedAt) {
    await db
      .update(reminders)
      .set({ eventCheckedAt: checkedAt })
      .where(and(eq(reminders.id, id), eq(reminders.status, "pending")));
  },

  async cancel(id) {
    await db
      .delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.status, "pending")));
  },
};
