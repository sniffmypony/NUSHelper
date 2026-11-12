import type { Context, Telegraf } from "telegraf";
import * as actions from "../bot-actions.js";
import type { DeletableKind } from "./bot-tools.js";
import { confirmDeleteKeyboard, type InlineKeyboard } from "./keyboards.js";

// Handlers for the assistant's deletions and undos. Deleting always waits for
// a Delete press; Undo removes something the assistant just added.

const NOUN: Record<DeletableKind, string> = {
  todo: "to-do",
  task: "task",
  rem: "reminder",
};

async function describe(
  kind: DeletableKind,
  id: number,
  ownerId: string,
): Promise<string | null> {
  if (kind === "todo") {
    const todo = await actions.findTodo(id);
    return todo ? `to-do: ${todo.description}` : null;
  }
  if (kind === "task") {
    const task = await actions.findTask(id);
    return task ? `task: ${task.description}` : null;
  }
  const reminder = await actions.findPendingReminder(id, ownerId);
  return reminder
    ? `reminder at ${reminder.time}: ${reminder.description}`
    : null;
}

function performDelete(
  kind: DeletableKind,
  id: number,
  ownerId: string,
): Promise<string> {
  if (kind === "todo") return actions.deleteTodo(id);
  if (kind === "task") return actions.removeTask(id);
  return actions.cancelReminder(id, ownerId);
}

export async function requestDeletion(
  ctx: Context,
  ownerId: string,
  kind: DeletableKind,
  id: number,
): Promise<string> {
  const label = await describe(kind, id, ownerId);
  if (!label) {
    return `Error: that ${NOUN[kind]} was not found${kind === "rem" ? " or has already been sent" : ""}.`;
  }
  await ctx.reply(`Delete ${label}?`, {
    reply_markup: confirmDeleteKeyboard(kind, id),
  });
  return "Asked the user to confirm. Nothing is deleted until they press Delete.";
}

function keyboardOf(ctx: Context): InlineKeyboard | undefined {
  const message = (
    ctx.callbackQuery as { message?: { reply_markup?: InlineKeyboard } }
  )?.message;
  return message?.reply_markup;
}

async function setKeyboard(
  ctx: Context,
  keyboard: InlineKeyboard | undefined,
): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(keyboard);
  } catch {
    // The message may be too old to edit; the action itself already ran.
  }
}

export function registerAssistantButtons(bot: Telegraf, ownerId: string): void {
  bot.action(/^ai:(del|undo):(todo|task|rem):(\d{1,10})$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Telegram may retry an old callback after its acknowledgement window.
    }
    const [data, verb, kind, rawId] = ctx.match;
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return;

    const result = await performDelete(kind as DeletableKind, id, ownerId);
    if (verb === "del") {
      await setKeyboard(ctx, undefined);
    } else {
      // Keep the other Undo buttons on the same reply.
      const rows = (keyboardOf(ctx)?.inline_keyboard ?? []).filter(
        (row) => !row.some((button) => button.callback_data === data),
      );
      await setKeyboard(
        ctx,
        rows.length > 0 ? { inline_keyboard: rows } : undefined,
      );
    }
    await ctx.reply(verb === "undo" ? `Undone. ${result}` : result);
  });

  bot.action("ai:keep", async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // See above.
    }
    await setKeyboard(ctx, undefined);
    await ctx.reply("Kept.");
  });
}
