import { and, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { reminders } from "./db/schema.js";

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = Omit<
  typeof reminders.$inferInsert,
  | "id"
  | "status"
  | "attempts"
  | "claimedAt"
  | "sentAt"
  | "createdAt"
  | "updatedAt"
>;

export interface ReminderStore {
  create(value: NewReminder): Promise<Reminder>;
  claimDue(now: Date, limit?: number): Promise<Reminder[]>;
  markSent(id: number, sentAt: Date): Promise<void>;
  markFailed(id: number, now: Date, retry: boolean): Promise<void>;
}

export class DrizzleReminderStore implements ReminderStore {
  async create(value: NewReminder): Promise<Reminder> {
    const inserted = await db
      .insert(reminders)
      .values(value)
      .onConflictDoNothing({
        target: [
          reminders.ownerId,
          reminders.chatId,
          reminders.sourceMessageId,
          reminders.sourceLine,
        ],
      })
      .returning();
    if (inserted[0]) return inserted[0];

    const [existing] = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.ownerId, value.ownerId),
          eq(reminders.chatId, value.chatId),
          eq(reminders.sourceMessageId, value.sourceMessageId),
          eq(reminders.sourceLine, value.sourceLine ?? 0),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Could not create or recover reminder");
    return existing;
  }

  async claimDue(now: Date, limit = 50): Promise<Reminder[]> {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const encodedNow = sql.param(now, reminders.scheduledAt);
    await db
      .update(reminders)
      .set({ status: "expired", claimedAt: null, updatedAt: now })
      .where(
        and(
          inArray(reminders.status, ["pending", "processing"]),
          lte(reminders.expiresAt, now),
        ),
      );
    await db
      .update(reminders)
      .set({ status: "pending", claimedAt: null, updatedAt: now })
      .where(
        and(
          eq(reminders.status, "processing"),
          or(
            lt(reminders.claimedAt, staleBefore),
            sql`${reminders.claimedAt} is null`,
          ),
          gt(reminders.expiresAt, now),
        ),
      );

    const rows = await db.execute(sql`
      with due as (
        select id
        from ${reminders}
        where status = 'pending'
          and scheduled_at <= ${encodedNow}
          and expires_at > ${encodedNow}
        order by scheduled_at, id
        for update skip locked
        limit ${limit}
      )
      update ${reminders} as reminder
      set status = 'processing',
          claimed_at = ${encodedNow},
          attempts = reminder.attempts + 1,
          updated_at = ${encodedNow}
      from due
      where reminder.id = due.id
      returning
        reminder.id,
        reminder.owner_id as "ownerId",
        reminder.chat_id as "chatId",
        reminder.source_message_id as "sourceMessageId",
        reminder.source_line as "sourceLine",
        reminder.description,
        reminder.scheduled_at as "scheduledAt",
        reminder.expires_at as "expiresAt",
        reminder.status,
        reminder.attempts,
        reminder.claimed_at as "claimedAt",
        reminder.sent_at as "sentAt",
        reminder.created_at as "createdAt",
        reminder.updated_at as "updatedAt"
    `);
    return Array.from(rows) as unknown as Reminder[];
  }

  async markSent(id: number, sentAt: Date): Promise<void> {
    await db
      .update(reminders)
      .set({
        status: "sent",
        sentAt,
        claimedAt: null,
        updatedAt: sentAt,
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, "processing")));
  }

  async markFailed(id: number, now: Date, retry: boolean): Promise<void> {
    await db
      .update(reminders)
      .set({
        status: retry ? "pending" : "failed",
        claimedAt: null,
        updatedAt: now,
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, "processing")));
  }
}

export const reminderStore = new DrizzleReminderStore();
