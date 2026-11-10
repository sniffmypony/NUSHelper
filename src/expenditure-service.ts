import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "./dates.js";
import {
  formatCurrency,
  formatLongDate,
  formatMonthlyReport,
  formatWeeklyReport,
} from "./expenditure.js";
import type {
  ExpenditureReport,
  ExpenditureStore,
} from "./expenditure-store.js";
import type { SendTelegramMessageOptions } from "./telegram.js";

export type ExpenditureSender = (
  text: string,
  options?: SendTelegramMessageOptions,
) => Promise<void>;

export function expenditureKeyboard(date: string) {
  return {
    inline_keyboard: [
      [
        { text: "Add amount", callback_data: `exp:add:${date}` },
        { text: "Remove amount", callback_data: `exp:remove:${date}` },
      ],
    ],
  };
}

export function expenditureConfirmation(date: string, cents: number): string {
  return `Expenditure for ${formatLongDate(date)}: ${formatCurrency(cents)}`;
}

export async function dispatchExpenditureReports(
  store: ExpenditureStore,
  send: ExpenditureSender,
  now = new Date(),
): Promise<{ claimed: number; sent: number; failed: number }> {
  const reports = await store.claimReports(now);
  let sent = 0;
  let failed = 0;
  for (const report of reports) {
    const revision = report.claimedRevision ?? report.revision;
    try {
      const text = await renderReport(store, report);
      await send(text);
      await store.completeReport(report.id, revision, now);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Expenditure report ${report.id} delivery failed:`, error);
      await store.releaseReport(report.id, revision, now);
    }
  }
  return { claimed: reports.length, sent, failed };
}

async function renderReport(
  store: ExpenditureStore,
  report: ExpenditureReport,
): Promise<string> {
  const corrected = report.sentRevision > 0;
  if (report.reportType === "weekly") {
    const sunday = DateTime.fromISO(report.periodEnd, {
      zone: SINGAPORE_TIME_ZONE,
    });
    const days = await store.daysInRange(
      sunday.startOf("month").toISODate()!,
      report.periodEnd,
    );
    return formatWeeklyReport(
      days,
      { start: report.periodStart, end: report.periodEnd },
      corrected,
    );
  }
  const days = await store.daysInRange(report.periodStart, report.periodEnd);
  return formatMonthlyReport(
    days,
    { start: report.periodStart, end: report.periodEnd },
    corrected,
  );
}

export async function processCompletedExpenditureDay(
  spendDate: string,
  send: ExpenditureSender,
  store: ExpenditureStore,
  now = new Date(),
): Promise<void> {
  await store.queueReportsForDate(spendDate, now);
  await dispatchExpenditureReports(store, send, now);
}

export async function runExpenditureSchedule(
  store: ExpenditureStore,
  send: ExpenditureSender,
  ownerId: string,
  chatId: string,
  now = new Date(),
): Promise<{
  prompt: boolean;
  reminder: boolean;
  autoZero: boolean;
  missingNotice: boolean;
  reports: { claimed: number; sent: number; failed: number };
}> {
  const local = DateTime.fromJSDate(now, { zone: SINGAPORE_TIME_ZONE });
  const today = local.toISODate()!;
  const yesterday = local.minus({ days: 1 }).toISODate()!;
  const nextSeven = DateTime.fromISO(yesterday, { zone: SINGAPORE_TIME_ZONE })
    .plus({ days: 1 })
    .set({ hour: 7, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
  let prompt = false;
  let reminder = false;
  let autoZero = false;
  let missingNotice = false;

  if (local.hour >= 7) {
    autoZero = await store.autoZero(yesterday, ownerId, now);
    await store.queueReportsForDate(yesterday, now);
  } else if (local.hour >= 1) {
    reminder = await store.claimReminder(
      yesterday,
      ownerId,
      chatId,
      now,
      nextSeven,
    );
    if (reminder) {
      try {
        await send("expenditure:", { chatId });
      } catch (error) {
        await store.releaseReminder(yesterday);
        throw error;
      }
    }
  }

  if (local.hour > 23 || (local.hour === 23 && local.minute >= 30)) {
    missingNotice = await store.claimMissingNotice(yesterday, now);
    if (missingNotice) {
      try {
        await send(
          `No expenditure was logged for ${formatLongDate(yesterday)}; recorded S$0.00.`,
          { chatId, replyMarkup: expenditureKeyboard(yesterday) },
        );
      } catch (error) {
        await store.releaseMissingNotice(yesterday);
        throw error;
      }
    }

    const expiresAt = local
      .plus({ days: 1 })
      .set({ hour: 7, minute: 0, second: 0, millisecond: 0 })
      .toJSDate();
    prompt = await store.claimPrompt(today, ownerId, chatId, now, expiresAt);
    if (prompt) {
      try {
        await send("expenditure:", { chatId });
      } catch (error) {
        await store.releasePrompt(today, ownerId);
        throw error;
      }
    }
  }

  const reports = await dispatchExpenditureReports(store, send, now);
  return { prompt, reminder, autoZero, missingNotice, reports };
}
