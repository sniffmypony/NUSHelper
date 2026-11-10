import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dispatchDueReminders } from "../../src/reminder-dispatcher.js";
import { reminderStore } from "../../src/reminder-store.js";
import { sendTelegramMessage } from "../../src/telegram.js";
import { runExpenditureSchedule } from "../../src/expenditure-service.js";
import { expenditureStore } from "../../src/expenditure-store.js";
import { telegramOwnerId } from "../../src/env.js";

function authorized(value: string | undefined, secret: string): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("method not allowed");
  }

  const secret = process.env.REMINDER_DISPATCH_SECRET?.trim();
  if (!secret || !authorized(req.headers.authorization, secret)) {
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
      (text, chatId) => sendTelegramMessage(text, { chatId }),
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
      sendTelegramMessage,
      ownerId,
      ownerId,
      now,
    );
  } catch (error) {
    expenditureError = true;
    console.error("Expenditure dispatcher failed:", error);
  }

  return res.status(reminderError || expenditureError ? 500 : 200).json({
    reminders: reminderResult ?? { error: "dispatcher failed" },
    expenditure: expenditureResult ?? { error: "dispatcher failed" },
  });
}
