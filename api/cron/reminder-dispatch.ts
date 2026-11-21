import type { VercelRequest, VercelResponse } from "@vercel/node";
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

  const now = new Date();
  let reminderResult: unknown;
  let expenditureResult: unknown;
  let reminderError = false;
  let expenditureError = false;

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
      expenditure: expenditureResult ?? { error: "dispatcher failed" },
      deadlines: deadlineError
        ? { error: "dispatcher failed" }
        : deadlineResult,
    });
}
