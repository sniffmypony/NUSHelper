import type { Context, Telegraf } from "telegraf";
import * as actions from "./bot-actions.js";
import {
  confirmDeleteKeyboard,
  type InlineKeyboard,
} from "./assistant/keyboards.js";
import { matchTasks, type TaskListItem } from "./task-todo.js";

// /done and /remove pick a task by name or from buttons, so the user never
// needs a task's database id. Removing always asks Delete/Keep first.

export type PickVerb = "done" | "remove";

const PICKER_LIMIT = 30;
const BUTTON_TEXT_LIMIT = 48;

function buttonText(task: TaskListItem): string {
  const text = `${task.description}${task.module ? ` [${task.module}]` : ""}`;
  return text.length > BUTTON_TEXT_LIMIT
    ? `${text.slice(0, BUTTON_TEXT_LIMIT - 1)}…`
    : text;
}

export function taskPickerKeyboard(
  tasks: TaskListItem[],
  verb: PickVerb,
): InlineKeyboard {
  const code = verb === "done" ? "done" : "rm";
  return {
    inline_keyboard: tasks.map((task) => [
      { text: buttonText(task), callback_data: `task:${code}:${task.id}` },
    ]),
  };
}

export function pickQuery(messageText: string, verb: PickVerb): string {
  return messageText.replace(new RegExp(`^/${verb}(@\\w+)?`), "").trim();
}

function askToDelete(ctx: Context, task: { id: number; description: string }) {
  return ctx.reply(`Delete task: ${task.description}?`, {
    reply_markup: confirmDeleteKeyboard("task", task.id),
  });
}

export async function pickTask(
  ctx: Context,
  verb: PickVerb,
  query: string,
): Promise<void> {
  const open = await actions.openTasks();
  if (open.length === 0) {
    await ctx.reply("Nothing on your list 🎉");
    return;
  }

  const matches = query ? matchTasks(open, query) : open;
  if (matches.length === 0) {
    await ctx.reply(
      `No open task matches "${query}". Send /${verb} on its own to pick from your list.`,
    );
    return;
  }

  // A name that matches exactly one task acts on it straight away.
  if (query && matches.length === 1) {
    const [task] = matches;
    if (verb === "done") await ctx.reply(await actions.completeTask(task.id));
    else await askToDelete(ctx, task);
    return;
  }

  const shown = matches.slice(0, PICKER_LIMIT);
  const prompt =
    verb === "done" ? "Which task is done?" : "Which task should be deleted?";
  const more =
    matches.length > shown.length
      ? `\nShowing ${shown.length} of ${matches.length}. Add words after /${verb} to narrow it down.`
      : "";
  await ctx.reply(`${prompt}${more}`, {
    reply_markup: taskPickerKeyboard(shown, verb),
  });
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
    // The message may be too old to edit; the action still runs.
  }
}

export function registerTaskPicker(bot: Telegraf): void {
  bot.command("done", (ctx) =>
    pickTask(ctx, "done", pickQuery(ctx.message.text, "done")),
  );
  bot.command("remove", (ctx) =>
    pickTask(ctx, "remove", pickQuery(ctx.message.text, "remove")),
  );

  bot.action(/^task:(done|rm):(\d{1,10})$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Telegram may retry an old callback after its acknowledgement window.
    }
    const [data, code, rawId] = ctx.match;
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return;

    if (code === "done") {
      // Keep the other buttons so several tasks can be ticked off in a row.
      const rows = (keyboardOf(ctx)?.inline_keyboard ?? []).filter(
        (row) => !row.some((button) => button.callback_data === data),
      );
      await setKeyboard(
        ctx,
        rows.length > 0 ? { inline_keyboard: rows } : undefined,
      );
      await ctx.reply(await actions.completeTask(id));
      return;
    }

    await setKeyboard(ctx, undefined);
    const task = await actions.findTask(id);
    if (!task) {
      await ctx.reply(
        "That task wasn't found. It may already be done or deleted.",
      );
      return;
    }
    await askToDelete(ctx, task);
  });
}
