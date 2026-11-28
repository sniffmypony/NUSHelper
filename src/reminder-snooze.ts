import type { Telegraf } from "telegraf";
import { QUIET } from "./telegram-quiet.js";
import type { TelegramInlineKeyboard } from "./telegram.js";
import { acknowledge, callbackId, setButtons } from "./telegram-buttons.js";

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
    await acknowledge(ctx);
    const id = callbackId(ctx.match[1]);
    const minutes = Number(ctx.match[2]);
    const firedMessageId = (
      ctx.callbackQuery as { message?: { message_id?: number } }
    ).message?.message_id;
    if (id === null || !firedMessageId) return;

    const result = await snooze(id, ownerId, minutes, firedMessageId);
    // The snooze is already set, so the buttons go even if this fails.
    await setButtons(ctx);
    await ctx.reply(result, QUIET);
  });
}
