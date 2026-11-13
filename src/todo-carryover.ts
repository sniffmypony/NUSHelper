import { asc, eq } from "drizzle-orm";
import type { Context, Telegraf } from "telegraf";
import { db } from "./db/client.js";
import { tasks, todoCarryovers, todos } from "./db/schema.js";
import type { TelegramInlineKeyboard } from "./telegram.js";

// The nightly check-in clears the to-do list. Each item it showed is kept
// here for a day, so a "Move to tomorrow" tap can put it on the fresh list.

export type CarryoverItem = { id: number; description: string };

const BUTTON_TEXT_LIMIT = 48;
const BUTTON_LIMIT = 30;

function buttonText(description: string): string {
  const text = `➡️ ${description}`;
  return text.length > BUTTON_TEXT_LIMIT
    ? `${text.slice(0, BUTTON_TEXT_LIMIT - 1)}…`
    : text;
}

export function carryoverKeyboard(
  items: CarryoverItem[],
): TelegramInlineKeyboard | undefined {
  if (items.length === 0) return undefined;
  const rows = items.slice(0, BUTTON_LIMIT).map((item) => [
    {
      text: buttonText(item.description),
      callback_data: `todo:carry:${item.id}`,
    },
  ]);
  if (items.length > 1) {
    rows.push([
      { text: "Move all to tomorrow", callback_data: "todo:carry:all" },
    ]);
  }
  return { inline_keyboard: rows };
}

// Replaces last night's saved items with tonight's.
export async function saveCarryovers(
  items: Array<{ description: string; taskId: number | null }>,
): Promise<CarryoverItem[]> {
  return db.transaction(async (tx) => {
    await tx.delete(todoCarryovers);
    if (items.length === 0) return [];
    return tx
      .insert(todoCarryovers)
      .values(
        items.map((item) => ({
          description: item.description,
          taskId: item.taskId,
        })),
      )
      .returning({
        id: todoCarryovers.id,
        description: todoCarryovers.description,
      });
  });
}

type MoveResult = "moved" | "task_done" | "gone";

async function moveOne(id: number): Promise<{
  result: MoveResult;
  description?: string;
}> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .delete(todoCarryovers)
      .where(eq(todoCarryovers.id, id))
      .returning();
    if (!item) return { result: "gone" as const };

    // A to-do that came from a task keeps its link only while the task is open.
    let taskId: number | null = null;
    if (item.taskId !== null) {
      const [task] = await tx
        .select({ done: tasks.done })
        .from(tasks)
        .where(eq(tasks.id, item.taskId))
        .limit(1);
      if (task?.done) {
        return { result: "task_done" as const, description: item.description };
      }
      if (task) taskId = item.taskId;
    }
    await tx
      .insert(todos)
      .values({ description: item.description, taskId })
      .onConflictDoNothing({ target: todos.taskId });
    return { result: "moved" as const, description: item.description };
  });
}

export async function moveCarryover(id: number): Promise<string> {
  const { result, description } = await moveOne(id);
  if (result === "gone") {
    return "That item is no longer available to move. Add it again with /todo.";
  }
  if (result === "task_done") {
    return `Left off, because its task is already done: ${description}`;
  }
  return `Back on your to-do list: ${description}`;
}

export async function moveAllCarryovers(): Promise<string> {
  const items = await db
    .select({ id: todoCarryovers.id })
    .from(todoCarryovers)
    .orderBy(asc(todoCarryovers.id));
  let moved = 0;
  for (const item of items) {
    if ((await moveOne(item.id)).result === "moved") moved += 1;
  }
  if (moved === 0) return "There was nothing left to move.";
  return `Back on your to-do list: ${moved} ${moved === 1 ? "item" : "items"}.`;
}

type Keyboard = TelegramInlineKeyboard;

function keyboardOf(ctx: Context): Keyboard | undefined {
  return (ctx.callbackQuery as { message?: { reply_markup?: Keyboard } })
    ?.message?.reply_markup;
}

export function registerCarryoverButtons(bot: Telegraf): void {
  bot.action(/^todo:carry:(\d{1,10}|all)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Telegram may retry an old callback after its acknowledgement window.
    }
    const [data, target] = ctx.match;
    const all = target === "all";
    const id = Number(target);
    if (!all && (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647)) {
      return;
    }

    // Take the tapped button away; "Move all" goes once one item is left.
    const itemRows = (keyboardOf(ctx)?.inline_keyboard ?? []).filter(
      (row) =>
        !row.some(
          (button) =>
            button.callback_data === data ||
            button.callback_data === "todo:carry:all",
        ),
    );
    const rows =
      all || itemRows.length === 0
        ? []
        : itemRows.length > 1
          ? [
              ...itemRows,
              [
                {
                  text: "Move all to tomorrow",
                  callback_data: "todo:carry:all",
                },
              ],
            ]
          : itemRows;
    try {
      await ctx.editMessageReplyMarkup(
        rows.length > 0 ? { inline_keyboard: rows } : undefined,
      );
    } catch {
      // The message may be too old to edit; the move still runs.
    }

    await ctx.reply(all ? await moveAllCarryovers() : await moveCarryover(id));
  });
}
