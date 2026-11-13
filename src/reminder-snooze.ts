import type { Telegraf } from "telegraf";
import type { TelegramInlineKeyboard } from "./telegram.js";

// Every reminder arrives with snooze buttons. A tap sets the same reminder
// again a little later and removes the buttons from the one that fired.

export const SNOOZE_MINUTES = [15, 60] as const;

export function snoozeKeyboard(reminderId: number): TelegramInlineKeyboard {
  return {
    inline_keyboard: [
      SNOOZE_MINUTES.map((minutes) => ({
        text: minutes < 60 ? `+${minutes} min` : `+${minutes / 60} hr`,
        callback_data: `rem:snooze:${reminderId}:${minutes}`,
      })),
    ],
  };
}

export type SnoozeReminder = (
  id: number,
  ownerId: string,
  minutes: number,
  firedMessageId: number,
) => Promise<string>;

export function registerReminderSnooze(
  bot: Telegraf,
  ownerId: string,
  snooze: SnoozeReminder,
): void {
  bot.action(/^rem:snooze:(\d{1,10}):(15|60)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Telegram may retry an old callback after its acknowledgement window.
    }
    const id = Number(ctx.match[1]);
    const minutes = Number(ctx.match[2]);
    const firedMessageId = (
      ctx.callbackQuery as { message?: { message_id?: number } }
    ).message?.message_id;
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return;
    if (!firedMessageId) return;

    const result = await snooze(id, ownerId, minutes, firedMessageId);
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch {
      // The message may be too old to edit; the snooze is already set.
    }
    await ctx.reply(result);
  });
}
