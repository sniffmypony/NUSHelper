import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  applePayPayments,
  expenditureAdjustments,
  expenditureDays,
  expenditureReports,
} from "../db/schema.js";

// Apple Pay payments in the database. A counted payment is also an
// expenditure adjustment on its day (chat "applepay", source = payment id),
// so the day's total, the reports and the website all include it. Each
// change is one transaction; nothing runs queries side by side.

export type ApplePayPayment = typeof applePayPayments.$inferSelect;

export interface NewPayment {
  receivedAt: Date;
  spendDate: string;
  amountCents: number | null;
  amountText: string;
  currency: string;
  merchant: string;
  card: string;
  // Foreign payments wait for their S$ amount until then.
  sgdRequestedUntil: Date | null;
}

export interface ApplePayStore {
  recentDuplicate(
    payment: Pick<NewPayment, "amountText" | "merchant" | "card">,
    since: Date,
  ): Promise<ApplePayPayment | null>;
  countOn(spendDate: string): Promise<number>;
  // Saves the payment; an S$ one is added to its day straight away.
  record(
    payment: NewPayment,
    ownerId: string,
  ): Promise<{ payment: ApplePayPayment; dayTotalCents: number | null }>;
  // A foreign payment given its S$ amount.
  convert(
    id: number,
    cents: number,
    ownerId: string,
  ): Promise<{ payment: ApplePayPayment; dayTotalCents: number } | null>;
  undo(
    id: number,
    ownerId: string,
  ): Promise<{ payment: ApplePayPayment; dayTotalCents: number } | null>;
  skip(id: number): Promise<ApplePayPayment | null>;
  requestSgd(id: number, until: Date): Promise<ApplePayPayment | null>;
  // The foreign payment a bare amount on Telegram is for, if one is waiting.
  awaitingSgd(now: Date): Promise<ApplePayPayment | null>;
  daySummary(spendDate: string): Promise<{ count: number; cents: number }>;
  inRange(start: string, end: string): Promise<ApplePayPayment[]>;
  latest(): Promise<ApplePayPayment | null>;
}

export const APPLE_PAY_CHAT = "applepay";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A sent weekly or monthly report covering the day is sent again, corrected.
async function reviseSentReports(tx: Tx, spendDate: string, now: Date) {
  await tx
    .update(expenditureReports)
    .set({
      revision: sql`${expenditureReports.revision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        lte(expenditureReports.periodStart, spendDate),
        gte(expenditureReports.periodEnd, spendDate),
        gt(expenditureReports.sentRevision, 0),
        eq(expenditureReports.sentRevision, expenditureReports.revision),
      ),
    );
}

// Adds a payment to its day: the adjustment plus the new total. The day's
// status is left as it is (a pending day stays pending until the owner
// answers the 11:30pm message).
async function addToDay(
  tx: Tx,
  payment: ApplePayPayment,
  cents: number,
  ownerId: string,
  now: Date,
): Promise<number> {
  await tx
    .insert(expenditureDays)
    .values({ spendDate: payment.spendDate })
    .onConflictDoNothing({ target: expenditureDays.spendDate });
  await tx
    .insert(expenditureAdjustments)
    .values({
      spendDate: payment.spendDate,
      ownerId,
      chatId: APPLE_PAY_CHAT,
      sourceMessageId: payment.id,
      kind: "applepay",
      amountCents: cents,
    })
    .onConflictDoNothing({
      target: [
        expenditureAdjustments.ownerId,
        expenditureAdjustments.chatId,
        expenditureAdjustments.sourceMessageId,
      ],
    });
  const [day] = await tx
    .update(expenditureDays)
    .set({
      totalCents: sql`${expenditureDays.totalCents} + ${cents}`,
      // A day already recorded as S$0 for lack of a reply now has a total.
      status: sql`case when ${expenditureDays.status} = 'auto_zero' then 'auto' else ${expenditureDays.status} end`,
      updatedAt: now,
    })
    .where(eq(expenditureDays.spendDate, payment.spendDate))
    .returning({ totalCents: expenditureDays.totalCents });
  await reviseSentReports(tx, payment.spendDate, now);
  return day.totalCents;
}

export const applePayStore: ApplePayStore = {
  async recentDuplicate(payment, since) {
    const [row] = await db
      .select()
      .from(applePayPayments)
      .where(
        and(
          eq(applePayPayments.amountText, payment.amountText),
          eq(applePayPayments.merchant, payment.merchant),
          eq(applePayPayments.card, payment.card),
          gte(applePayPayments.receivedAt, since),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async countOn(spendDate) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(applePayPayments)
      .where(eq(applePayPayments.spendDate, spendDate));
    return row?.count ?? 0;
  },

  async record(value, ownerId) {
    return db.transaction(async (tx) => {
      const counted = value.amountCents !== null;
      const [payment] = await tx
        .insert(applePayPayments)
        .values({
          ...value,
          status: counted ? "counted" : "awaiting_sgd",
        })
        .returning();
      const dayTotalCents = counted
        ? await addToDay(
            tx,
            payment,
            value.amountCents!,
            ownerId,
            value.receivedAt,
          )
        : null;
      return { payment, dayTotalCents };
    });
  },

  async convert(id, cents, ownerId) {
    return db.transaction(async (tx) => {
      const [payment] = await tx
        .update(applePayPayments)
        .set({ status: "counted", amountCents: cents, sgdRequestedUntil: null })
        .where(
          and(
            eq(applePayPayments.id, id),
            eq(applePayPayments.status, "awaiting_sgd"),
          ),
        )
        .returning();
      if (!payment) return null;
      const dayTotalCents = await addToDay(
        tx,
        payment,
        cents,
        ownerId,
        new Date(),
      );
      return { payment, dayTotalCents };
    });
  },

  async undo(id, ownerId) {
    return db.transaction(async (tx) => {
      const [payment] = await tx
        .update(applePayPayments)
        .set({ status: "undone" })
        .where(
          and(
            eq(applePayPayments.id, id),
            eq(applePayPayments.status, "counted"),
          ),
        )
        .returning();
      if (!payment) return null;
      const now = new Date();
      await tx
        .delete(expenditureAdjustments)
        .where(
          and(
            eq(expenditureAdjustments.ownerId, ownerId),
            eq(expenditureAdjustments.chatId, APPLE_PAY_CHAT),
            eq(expenditureAdjustments.sourceMessageId, payment.id),
          ),
        );
      const cents = payment.amountCents ?? 0;
      const [day] = await tx
        .update(expenditureDays)
        .set({
          totalCents: sql`greatest(${expenditureDays.totalCents} - ${cents}, 0)`,
          // A day that only had Apple Pay, now with nothing left, is S$0.
          status: sql`case when ${expenditureDays.status} = 'auto' and ${expenditureDays.totalCents} - ${cents} <= 0 then 'auto_zero' else ${expenditureDays.status} end`,
          updatedAt: now,
        })
        .where(eq(expenditureDays.spendDate, payment.spendDate))
        .returning({ totalCents: expenditureDays.totalCents });
      await reviseSentReports(tx, payment.spendDate, now);
      return { payment, dayTotalCents: day?.totalCents ?? 0 };
    });
  },

  async skip(id) {
    const [payment] = await db
      .update(applePayPayments)
      .set({ status: "skipped", sgdRequestedUntil: null })
      .where(
        and(
          eq(applePayPayments.id, id),
          eq(applePayPayments.status, "awaiting_sgd"),
        ),
      )
      .returning();
    return payment ?? null;
  },

  async requestSgd(id, until) {
    const [payment] = await db
      .update(applePayPayments)
      .set({ sgdRequestedUntil: until })
      .where(
        and(
          eq(applePayPayments.id, id),
          eq(applePayPayments.status, "awaiting_sgd"),
        ),
      )
      .returning();
    return payment ?? null;
  },

  async awaitingSgd(now) {
    const [payment] = await db
      .select()
      .from(applePayPayments)
      .where(
        and(
          eq(applePayPayments.status, "awaiting_sgd"),
          gt(applePayPayments.sgdRequestedUntil, now),
        ),
      )
      .orderBy(desc(applePayPayments.sgdRequestedUntil))
      .limit(1);
    return payment ?? null;
  },

  async daySummary(spendDate) {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        cents: sql<number>`coalesce(sum(${applePayPayments.amountCents}), 0)::int`,
      })
      .from(applePayPayments)
      .where(
        and(
          eq(applePayPayments.spendDate, spendDate),
          eq(applePayPayments.status, "counted"),
        ),
      );
    return { count: row?.count ?? 0, cents: row?.cents ?? 0 };
  },

  async inRange(start, end) {
    return db
      .select()
      .from(applePayPayments)
      .where(
        and(
          gte(applePayPayments.spendDate, start),
          lte(applePayPayments.spendDate, end),
        ),
      )
      .orderBy(asc(applePayPayments.receivedAt));
  },

  async latest() {
    const [payment] = await db
      .select()
      .from(applePayPayments)
      .orderBy(desc(applePayPayments.receivedAt))
      .limit(1);
    return payment ?? null;
  },
};
