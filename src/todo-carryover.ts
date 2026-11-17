import { asc, eq } from "drizzle-orm";
import type { Telegraf } from "telegraf";
import { db } from "./db/client.js";
import { tasks, todoCarryovers, todos } from "./db/schema.js";
import type { TelegramInlineKeyboard } from "./telegram.js";
import {
  acknowledge,
  buttonText,
  callbackId,
  rowsWithout,
  setButtons,
} from "./telegram-buttons.js";

// The nightly check-in clears the to-do list. Each item it showed is kept
// here for a day, so a "Move to tomorrow" tap can put it on the fresh list.

export type CarryoverItem = { id: number; description: string };

const BUTTON_LIMIT = 30;
const MOVE_ALL = "todo:carry:all";
const MOVE_ALL_ROW = [
  { text: "Move all to tomorrow", callback_data: MOVE_ALL },
];

export function carryoverKeyboard(
  items: CarryoverItem[],
): TelegramInlineKeyboard | undefined {
  if (items.length === 0) return undefined;
  const rows = items.slice(0, BUTTON_LIMIT).map((item) => [
    {
      text: buttonText(`➡️ ${item.description}`),
      callback_data: `todo:carry:${item.id}`,
    },
  ]);
  if (items.length > 1) rows.push(MOVE_ALL_ROW);
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

export function registerCarryoverButtons(bot: Telegraf): void {
  bot.action(/^todo:carry:(\d{1,10}|all)$/, async (ctx) => {
    await acknowledge(ctx);
    const [data, target] = ctx.match;
    const all = target === "all";
    const id = all ? null : callbackId(target);
    if (!all && id === null) return;

    // Take the tapped button away; "Move all" goes once one item is left.
    const itemRows = rowsWithout(ctx, data, MOVE_ALL);
    await setButtons(
      ctx,
      all ? [] : itemRows.length > 1 ? [...itemRows, MOVE_ALL_ROW] : itemRows,
    );

    await ctx.reply(all ? await moveAllCarryovers() : await moveCarryover(id!));
  });
}
