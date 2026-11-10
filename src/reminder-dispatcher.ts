import type { Reminder, ReminderStore } from "./reminder-store.js";
import { TelegramDeliveryError } from "./telegram.js";

const MAX_ATTEMPTS = 5;

export type ReminderSender = (text: string, chatId: string) => Promise<void>;

export type DispatchResult = {
  claimed: number;
  sent: number;
  failed: number;
};

function shouldRetry(reminder: Reminder, error: unknown, now: Date): boolean {
  const temporary =
    !(error instanceof TelegramDeliveryError) ||
    error.status === 429 ||
    (error.status !== undefined && error.status >= 500);
  return (
    temporary && reminder.attempts < MAX_ATTEMPTS && now < reminder.expiresAt
  );
}

export async function dispatchDueReminders(
  store: ReminderStore,
  send: ReminderSender,
  now = new Date(),
): Promise<DispatchResult> {
  const claimed = await store.claimDue(now);
  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    try {
      await send(reminder.description, reminder.chatId);
      await store.markSent(reminder.id, now);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Reminder ${reminder.id} delivery failed:`, error);
      await store.markFailed(
        reminder.id,
        now,
        shouldRetry(reminder, error, now),
      );
    }
  }

  return { claimed: claimed.length, sent, failed };
}
