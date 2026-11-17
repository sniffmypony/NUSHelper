import type { Context } from "telegraf";
import type { TelegramInlineKeyboard } from "./telegram.js";

// Shared pieces for inline-button handlers: acknowledging the tap, reading
// the id in the button's data, and editing the buttons on the message.

type Row = TelegramInlineKeyboard["inline_keyboard"][number];

// Long labels are cut so a button stays on one line.
export const BUTTON_TEXT_LIMIT = 48;

export function buttonText(text: string): string {
  return text.length > BUTTON_TEXT_LIMIT
    ? `${text.slice(0, BUTTON_TEXT_LIMIT - 1)}…`
    : text;
}

// A database id from button data, or null if it can't be one.
export function callbackId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

// Stops the button's loading spinner. Telegram may re-send an old tap after
// its acknowledgement window, so a failure here is ignored.
export async function acknowledge(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCbQuery(text);
  } catch {
    // The tap is still handled.
  }
}

// The buttons on the tapped message, minus any whose data is listed.
export function rowsWithout(ctx: Context, ...data: string[]): Row[] {
  const keyboard = (
    ctx.callbackQuery as { message?: { reply_markup?: TelegramInlineKeyboard } }
  )?.message?.reply_markup;
  return (keyboard?.inline_keyboard ?? []).filter(
    (row) => !row.some((button) => data.includes(button.callback_data)),
  );
}

// Replaces the tapped message's buttons; no rows removes them all.
export async function setButtons(
  ctx: Context,
  rows: Row[] = [],
): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(
      rows.length > 0 ? { inline_keyboard: rows } : undefined,
    );
  } catch {
    // The message may be too old to edit; the action itself still runs.
  }
}
