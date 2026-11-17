import type { Context, Telegraf } from "telegraf";
import * as actions from "./bot-actions.js";
import {
  confirmDeleteKeyboard,
  type InlineKeyboard,
} from "./assistant/keyboards.js";
import { matchTasks, type TaskListItem } from "./task-todo.js";
import {
  acknowledge,
  buttonText,
  callbackId,
  rowsWithout,
  setButtons,
} from "./telegram-buttons.js";

// /done and /remove pick a task by name or from buttons, so the user never
// needs a task's database id. Removing always asks Delete/Keep first.

export type PickVerb = "done" | "remove";

const PICKER_LIMIT = 30;

export function taskPickerKeyboard(
  tasks: TaskListItem[],
  verb: PickVerb,
): InlineKeyboard {
  const code = verb === "done" ? "done" : "rm";
  return {
    inline_keyboard: tasks.map((task) => [
      {
        text: buttonText(
          `${task.description}${task.module ? ` [${task.module}]` : ""}`,
        ),
        callback_data: `task:${code}:${task.id}`,
      },
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

export function registerTaskPicker(bot: Telegraf): void {
  bot.command("done", (ctx) =>
    pickTask(ctx, "done", pickQuery(ctx.message.text, "done")),
  );
  bot.command("remove", (ctx) =>
    pickTask(ctx, "remove", pickQuery(ctx.message.text, "remove")),
  );

  bot.action(/^task:(done|rm):(\d{1,10})$/, async (ctx) => {
    await acknowledge(ctx);
    const [data, code, rawId] = ctx.match;
    const id = callbackId(rawId);
    if (id === null) return;

    if (code === "done") {
      // Keep the other buttons so several tasks can be ticked off in a row.
      await setButtons(ctx, rowsWithout(ctx, data));
      await ctx.reply(await actions.completeTask(id));
      return;
    }

    await setButtons(ctx);
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
