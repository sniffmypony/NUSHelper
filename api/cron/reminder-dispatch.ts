import type { VercelRequest, VercelResponse } from "@vercel/node";
import { refreshSettings } from "../../src/settings/runtime.js";
import { applePayStore } from "../../src/apple-pay/store.js";
import { dispatchDueReminders } from "../../src/reminder-dispatcher.js";
import { reminderStore } from "../../src/reminder-store.js";
import { snoozeKeyboard } from "../../src/reminder-snooze.js";
import { sendTo, sendToTopic } from "../../src/topics.js";
import { runExpenditureSchedule } from "../../src/expenditure-service.js";
import { expenditureStore } from "../../src/expenditure-store.js";
import { telegramOwnerId } from "../../src/env.js";
import { hasBearerSecret } from "../../src/scheduled-jobs.js";
import { canvasConfig, isCanvasConfigured } from "../../src/env.js";
import { CanvasClient } from "../../src/canvas/client.js";
import { deadlineStore } from "../../src/canvas/deadline-store.js";
import { runDeadlineChecks } from "../../src/canvas/deadline-sync.js";
import { isCalendarConfigured } from "../../src/calendar/config.js";
import { getCalendarGateway } from "../../src/calendar/google.js";
import { withVercelOidcToken } from "../../src/calendar/request-context.js";
import { linkedReminderStore } from "../../src/linked-reminder-store.js";
import { syncLinkedReminders } from "../../src/linked-reminders.js";
import {
  scheduleBirthdayReminders,
  timeToLookForBirthdays,
} from "../../src/birthday-reminders.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("method not allowed");
  }

  // Supabase's per-minute job sends its own secret, not Vercel's.
  if (
    !hasBearerSecret(
      req.headers.authorization,
      process.env.REMINDER_DISPATCH_SECRET,
    )
  ) {
    return res.status(401).send("unauthorized");
  }

  // Settings changed on the website override Vercel's.
  await refreshSettings();

  const now = new Date();
  let reminderResult: unknown;
  let expenditureResult: unknown;
  let reminderError = false;
  let expenditureError = false;

  // First, reminders linked to Calendar events follow any moved or deleted
  // event. If Calendar can't be reached they keep their last known time.
  let linkedResult: unknown = { skipped: "calendar off" };
  if (isCalendarConfigured()) {
    try {
      linkedResult = await withVercelOidcToken(
        req.headers["x-vercel-oidc-token"],
        async () => {
          const gateway = await getCalendarGateway();
          return syncLinkedReminders(
            linkedReminderStore,
            (eventId) => gateway.getAgendaEvent(eventId),
            now,
          );
        },
      );
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      console.error(`Linked reminder sync failed (${type})`);
      linkedResult = { error: "sync failed" };
    }
  }

  // Tomorrow's birthdays become reminders at 23:55 tonight, before the
  // dispatcher below runs so one due now goes out in the same run.
  let birthdayResult: unknown = { skipped: "not now" };
  if (isCalendarConfigured() && timeToLookForBirthdays(now)) {
    try {
      birthdayResult = await withVercelOidcToken(
        req.headers["x-vercel-oidc-token"],
        async () => {
          const gateway = await getCalendarGateway();
          return scheduleBirthdayReminders(
            (timeMin, timeMax) => gateway.birthdaysBetween(timeMin, timeMax),
            reminderStore,
            telegramOwnerId(),
            now,
          );
        },
      );
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      console.error(`Birthday reminders failed (${type})`);
      birthdayResult = { error: "lookup failed" };
    }
  }

  try {
    reminderResult = await dispatchDueReminders(
      reminderStore,
      (text, chatId, reminder) =>
        sendToTopic("planner", text, {
          chatId,
          replyMarkup: snoozeKeyboard(reminder.id),
        }),
      now,
    );
  } catch (error) {
    reminderError = true;
    console.error("Reminder dispatcher failed:", error);
  }

  try {
    const ownerId = telegramOwnerId();
    expenditureResult = await runExpenditureSchedule(
      expenditureStore,
      sendTo("expenditure"),
      ownerId,
      ownerId,
      now,
      // The 11:30pm message shows the day's Apple Pay payments.
      async (date) => {
        // One query after the other (see src/db/client.ts).
        const day = await applePayStore.daySummary(date);
        const waiting = await applePayStore.waitingCount();
        return { ...day, waiting };
      },
    );
  } catch (error) {
    expenditureError = true;
    console.error("Expenditure dispatcher failed:", error);
  }

  // An hour before each Canvas deadline: is something submitted?
  let deadlineResult: unknown = { skipped: "canvas off" };
  let deadlineError = false;
  if (isCanvasConfigured()) {
    try {
      const { baseUrl, token } = canvasConfig();
      deadlineResult = await runDeadlineChecks(
        deadlineStore,
        new CanvasClient(baseUrl, token),
        (text) => sendToTopic("planner", text),
        now,
      );
    } catch (error) {
      deadlineError = true;
      console.error("Deadline checks failed:", error);
    }
  }

  return res
    .status(reminderError || expenditureError || deadlineError ? 500 : 200)
    .json({
      reminders: reminderResult ?? { error: "dispatcher failed" },
      linked: linkedResult,
      birthdays: birthdayResult,
      expenditure: expenditureResult ?? { error: "dispatcher failed" },
      deadlines: deadlineError
        ? { error: "dispatcher failed" }
        : deadlineResult,
    });
}
