import type { Context, Telegraf } from "telegraf";
import * as actions from "../bot-actions.js";
import type { DeletableKind } from "./bot-tools.js";
import { confirmDeleteKeyboard } from "./keyboards.js";
import { deleteRecurring, findRecurring } from "../recurring.js";
import {
  acknowledge,
  callbackId,
  rowsWithout,
  setButtons,
} from "../telegram-buttons.js";

// Handlers for the assistant's deletions and undos. Deleting always waits for
// a Delete press; Undo removes something the assistant just added.

const NOUN: Record<DeletableKind, string> = {
  todo: "to-do",
  task: "task",
  rem: "reminder",
  rep: "repeating item",
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
  if (kind === "rep") {
    const item = await findRecurring(id);
    return item ? `repeating item (${item.when}): ${item.description}` : null;
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
  if (kind === "rep") return deleteRecurring(id);
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

export function registerAssistantButtons(bot: Telegraf, ownerId: string): void {
  bot.action(/^ai:(del|undo):(todo|task|rem|rep):(\d{1,10})$/, async (ctx) => {
    await acknowledge(ctx);
    const [data, verb, kind, rawId] = ctx.match;
    const id = callbackId(rawId);
    if (id === null) return;

    const result = await performDelete(kind as DeletableKind, id, ownerId);
    // Delete clears the buttons; Undo keeps the other Undo buttons.
    await setButtons(ctx, verb === "del" ? [] : rowsWithout(ctx, data));
    await ctx.reply(verb === "undo" ? `Undone. ${result}` : result);
  });

  bot.action("ai:keep", async (ctx) => {
    await acknowledge(ctx);
    await setButtons(ctx);
    await ctx.reply("Kept.");
  });
}
