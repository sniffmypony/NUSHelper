import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import {
  expenditureAdjustments,
  expenditureDays,
  expenditureInputSessions,
  expenditureReports,
} from "./db/schema.js";
import {
  isMonthEnd,
  isSunday,
  monthPeriodFor,
  weekPeriodFor,
  type ExpenditureDay,
} from "./expenditure.js";

export type InputMode = "initial" | "add" | "remove";
export type InputSession = {
  ownerId: string;
  chatId: string;
  spendDate: string;
  mode: InputMode;
  expiresAt: Date;
};

export type AppliedInput =
  | { kind: "inactive" }
  | { kind: "duplicate" }
  | {
      kind: "applied";
      spendDate: string;
      totalCents: number;
      mode: InputMode;
    }
  | { kind: "negative"; spendDate: string; totalCents: number };

export type ExpenditureReport = typeof expenditureReports.$inferSelect;

export class ExpenditureStore {
  async ensureDay(spendDate: string): Promise<void> {
    await db
      .insert(expenditureDays)
      .values({ spendDate })
      .onConflictDoNothing({ target: expenditureDays.spendDate });
  }

  async getActiveSession(
    ownerId: string,
    chatId: string,
    now: Date,
  ): Promise<InputSession | null> {
    const [session] = await db
      .select()
      .from(expenditureInputSessions)
      .where(
        and(
          eq(expenditureInputSessions.ownerId, ownerId),
          eq(expenditureInputSessions.chatId, chatId),
          gt(expenditureInputSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return (session as InputSession | undefined) ?? null;
  }

  async closeSession(ownerId: string): Promise<void> {
    await db
      .delete(expenditureInputSessions)
      .where(eq(expenditureInputSessions.ownerId, ownerId));
  }

  async openEditSession(
    ownerId: string,
    chatId: string,
    spendDate: string,
    mode: "add" | "remove",
    now: Date,
  ): Promise<void> {
    await this.ensureDay(spendDate);
    await db
      .insert(expenditureInputSessions)
      .values({
        ownerId,
        chatId,
        spendDate,
        mode,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: expenditureInputSessions.ownerId,
        set: {
          chatId,
          spendDate,
          mode,
          expiresAt: new Date(now.getTime() + 15 * 60_000),
          updatedAt: now,
        },
      });
  }

  async claimPrompt(
    spendDate: string,
    ownerId: string,
    chatId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx
        .insert(expenditureDays)
        .values({ spendDate })
        .onConflictDoNothing({ target: expenditureDays.spendDate });
      const claimed = await tx
        .update(expenditureDays)
        .set({ promptSentAt: now, updatedAt: now })
        .where(
          and(
            eq(expenditureDays.spendDate, spendDate),
            sql`${expenditureDays.promptSentAt} is null`,
          ),
        )
        .returning({ spendDate: expenditureDays.spendDate });
      if (claimed.length === 0) return false;

      await tx
        .insert(expenditureInputSessions)
        .values({
          ownerId,
          chatId,
          spendDate,
          mode: "initial",
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: expenditureInputSessions.ownerId,
          set: {
            chatId,
            spendDate,
            mode: "initial",
            expiresAt,
            updatedAt: now,
          },
        });
      return true;
    });
  }

  async releasePrompt(spendDate: string, ownerId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(expenditureDays)
        .set({ promptSentAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(expenditureDays.spendDate, spendDate),
            eq(expenditureDays.status, "pending"),
          ),
        );
      await tx
        .delete(expenditureInputSessions)
        .where(
          and(
            eq(expenditureInputSessions.ownerId, ownerId),
            eq(expenditureInputSessions.spendDate, spendDate),
            eq(expenditureInputSessions.mode, "initial"),
          ),
        );
    });
  }

  async claimReminder(
    spendDate: string,
    ownerId: string,
    chatId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx
        .insert(expenditureDays)
        .values({ spendDate })
        .onConflictDoNothing({ target: expenditureDays.spendDate });
      const claimed = await tx
        .update(expenditureDays)
        .set({ reminderSentAt: now, updatedAt: now })
        .where(
          and(
            eq(expenditureDays.spendDate, spendDate),
            eq(expenditureDays.status, "pending"),
            sql`${expenditureDays.reminderSentAt} is null`,
          ),
        )
        .returning({ spendDate: expenditureDays.spendDate });
      if (claimed.length === 0) return false;
      await tx
        .insert(expenditureInputSessions)
        .values({
          ownerId,
          chatId,
          spendDate,
          mode: "initial",
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: expenditureInputSessions.ownerId,
          set: {
            chatId,
            spendDate,
            mode: "initial",
            expiresAt,
            updatedAt: now,
          },
        });
      return true;
    });
  }

  async releaseReminder(spendDate: string): Promise<void> {
    await db
      .update(expenditureDays)
      .set({ reminderSentAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(expenditureDays.spendDate, spendDate),
          eq(expenditureDays.status, "pending"),
        ),
      );
  }

  async autoZero(
    spendDate: string,
    ownerId: string,
    now: Date,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx
        .insert(expenditureDays)
        .values({ spendDate })
        .onConflictDoNothing({ target: expenditureDays.spendDate });
      const updated = await tx
        .update(expenditureDays)
        .set({
          status: "auto_zero",
          totalCents: 0,
          autoZeroedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(expenditureDays.spendDate, spendDate),
            eq(expenditureDays.status, "pending"),
          ),
        )
        .returning({ spendDate: expenditureDays.spendDate });
      await tx
        .delete(expenditureInputSessions)
        .where(
          and(
            eq(expenditureInputSessions.ownerId, ownerId),
            eq(expenditureInputSessions.spendDate, spendDate),
            eq(expenditureInputSessions.mode, "initial"),
          ),
        );
      return updated.length > 0;
    });
  }

  async claimMissingNotice(spendDate: string, now: Date): Promise<boolean> {
    const updated = await db
      .update(expenditureDays)
      .set({ missingNoticeSentAt: now, updatedAt: now })
      .where(
        and(
          eq(expenditureDays.spendDate, spendDate),
          eq(expenditureDays.status, "auto_zero"),
          sql`${expenditureDays.missingNoticeSentAt} is null`,
        ),
      )
      .returning({ spendDate: expenditureDays.spendDate });
    return updated.length > 0;
  }

  async releaseMissingNotice(spendDate: string): Promise<void> {
    await db
      .update(expenditureDays)
      .set({ missingNoticeSentAt: null, updatedAt: new Date() })
      .where(eq(expenditureDays.spendDate, spendDate));
  }

  async applyInput(
    ownerId: string,
    chatId: string,
    sourceMessageId: number,
    amountCents: number,
    now: Date,
  ): Promise<AppliedInput> {
    const encodedNow = sql.param(now, expenditureInputSessions.expiresAt);
    return db.transaction(async (tx) => {
      const sessionRows = await tx.execute(sql`
        select
          owner_id as "ownerId",
          chat_id as "chatId",
          spend_date as "spendDate",
          mode,
          expires_at as "expiresAt"
        from ${expenditureInputSessions}
        where owner_id = ${ownerId}
          and chat_id = ${chatId}
          and expires_at > ${encodedNow}
        for update
      `);
      const [session] = Array.from(sessionRows) as unknown as InputSession[];
      if (!session) return { kind: "inactive" } as const;

      const inserted = await tx
        .insert(expenditureAdjustments)
        .values({
          spendDate: session.spendDate,
          ownerId,
          chatId,
          sourceMessageId,
          kind: session.mode,
          amountCents,
        })
        .onConflictDoNothing({
          target: [
            expenditureAdjustments.ownerId,
            expenditureAdjustments.chatId,
            expenditureAdjustments.sourceMessageId,
          ],
        })
        .returning({ id: expenditureAdjustments.id });
      if (inserted.length === 0) return { kind: "duplicate" } as const;

      const [day] = await tx
        .select()
        .from(expenditureDays)
        .where(eq(expenditureDays.spendDate, session.spendDate))
        .limit(1);
      if (!day) throw new Error("Expenditure day is missing");
      const nextTotal =
        session.mode === "remove"
          ? day.totalCents - amountCents
          : day.totalCents + amountCents;
      if (nextTotal < 0) {
        await tx
          .delete(expenditureAdjustments)
          .where(eq(expenditureAdjustments.id, inserted[0].id));
        return {
          kind: "negative",
          spendDate: session.spendDate,
          totalCents: day.totalCents,
        } as const;
      }

      await tx
        .update(expenditureDays)
        .set({
          status: "logged",
          totalCents: nextTotal,
          loggedAt: now,
          updatedAt: now,
        })
        .where(eq(expenditureDays.spendDate, session.spendDate));
      await tx
        .delete(expenditureInputSessions)
        .where(eq(expenditureInputSessions.ownerId, ownerId));
      await tx
        .update(expenditureReports)
        .set({
          revision: sql`${expenditureReports.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            lte(expenditureReports.periodStart, session.spendDate),
            gte(expenditureReports.periodEnd, session.spendDate),
            gt(expenditureReports.sentRevision, 0),
            eq(expenditureReports.sentRevision, expenditureReports.revision),
          ),
        );
      return {
        kind: "applied",
        spendDate: session.spendDate,
        totalCents: nextTotal,
        mode: session.mode as InputMode,
      } as const;
    });
  }

  async queueReportsForDate(
    spendDate: string,
    now = new Date(),
  ): Promise<void> {
    const values: Array<{
      reportType: string;
      periodStart: string;
      periodEnd: string;
      updatedAt: Date;
    }> = [];
    if (isSunday(spendDate)) {
      const week = weekPeriodFor(spendDate);
      values.push({
        reportType: "weekly",
        periodStart: week.start,
        periodEnd: week.end,
        updatedAt: now,
      });
    }
    if (isMonthEnd(spendDate)) {
      const month = monthPeriodFor(spendDate);
      values.push({
        reportType: "monthly",
        periodStart: month.start,
        periodEnd: month.end,
        updatedAt: now,
      });
    }
    if (values.length > 0) {
      await db
        .insert(expenditureReports)
        .values(values)
        .onConflictDoNothing({
          target: [
            expenditureReports.reportType,
            expenditureReports.periodStart,
            expenditureReports.periodEnd,
          ],
        });
    }
  }

  async claimReports(now: Date, limit = 10): Promise<ExpenditureReport[]> {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const encodedNow = sql.param(now, expenditureReports.claimedAt);
    await db
      .update(expenditureReports)
      .set({ claimedRevision: null, claimedAt: null, updatedAt: now })
      .where(
        and(
          lte(expenditureReports.claimedAt, staleBefore),
          gt(expenditureReports.revision, expenditureReports.sentRevision),
        ),
      );
    const rows = await db.execute(sql`
      with due as (
        select id
        from ${expenditureReports}
        where revision > sent_revision
          and claimed_revision is null
        order by period_end,
          case when report_type = 'weekly' then 0 else 1 end,
          id
        for update skip locked
        limit ${limit}
      )
      update ${expenditureReports} as report
      set claimed_revision = report.revision,
          claimed_at = ${encodedNow},
          updated_at = ${encodedNow}
      from due
      where report.id = due.id
      returning
        report.id,
        report.report_type as "reportType",
        report.period_start as "periodStart",
        report.period_end as "periodEnd",
        report.revision,
        report.sent_revision as "sentRevision",
        report.claimed_revision as "claimedRevision",
        report.claimed_at as "claimedAt",
        report.last_sent_at as "lastSentAt",
        report.created_at as "createdAt",
        report.updated_at as "updatedAt"
    `);
    return Array.from(rows) as unknown as ExpenditureReport[];
  }

  async completeReport(id: number, revision: number, now: Date): Promise<void> {
    await db
      .update(expenditureReports)
      .set({
        sentRevision: revision,
        claimedRevision: null,
        claimedAt: null,
        lastSentAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(expenditureReports.id, id),
          eq(expenditureReports.claimedRevision, revision),
        ),
      );
  }

  async releaseReport(id: number, revision: number, now: Date): Promise<void> {
    await db
      .update(expenditureReports)
      .set({ claimedRevision: null, claimedAt: null, updatedAt: now })
      .where(
        and(
          eq(expenditureReports.id, id),
          eq(expenditureReports.claimedRevision, revision),
        ),
      );
  }

  async daysInRange(start: string, end: string): Promise<ExpenditureDay[]> {
    return db
      .select({
        spendDate: expenditureDays.spendDate,
        totalCents: expenditureDays.totalCents,
        status: expenditureDays.status,
      })
      .from(expenditureDays)
      .where(
        and(
          gte(expenditureDays.spendDate, start),
          lte(expenditureDays.spendDate, end),
        ),
      )
      .orderBy(asc(expenditureDays.spendDate));
  }
}

export const expenditureStore = new ExpenditureStore();
