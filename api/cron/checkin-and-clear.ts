import type { VercelRequest, VercelResponse } from "@vercel/node";
import { asc, sql } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { todos } from "../../src/db/schema.js";
import { formatTodoItem } from "../../src/task-todo.js";
import {
  carryoverKeyboard,
  saveCarryovers,
  type CarryoverItem,
} from "../../src/todo-carryover.js";
import { sendToTopic } from "../../src/topics.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send("unauthorized");
  }

  let items;
  try {
    items = await db.select().from(todos).orderBy(asc(todos.id));
  } catch (error) {
    console.error("Nightly check-in could not read todos:", error);
    return res.status(500).send("could not read todos; list was not cleared");
  }

  // Keep tonight's items for a day so "Move to tomorrow" can restore them.
  // A retried run finds an empty list and must not wipe what was saved.
  let carryovers: CarryoverItem[] = [];
  if (items.length > 0) {
    try {
      carryovers = await saveCarryovers(items);
    } catch (error) {
      console.error(
        "Nightly check-in could not save items to move; sending without buttons:",
        error,
      );
    }
  }

  // The list is cleared before the message goes out, so an item moved with
  // its button always lands on the fresh list. TRUNCATE also restarts the
  // serial id. (Vercel Hobby only guarantees cron timing to the hour.)
  try {
    await db.execute(sql`truncate table ${todos} restart identity`);
  } catch (error) {
    console.error("Nightly todo clear failed:", error);
    return res.status(500).send("clear failed");
  }

  // Only ping if there was actually something on the list today.
  if (items.length > 0) {
    const text =
      "🌙 Before the day ends — here's what was on today's list:\n" +
      items.map((item) => formatTodoItem(item)).join("\n") +
      (carryovers.length > 0
        ? "\n\nThe list is now cleared. Tap anything you didn't finish to keep it for tomorrow."
        : "\n\nThe list is now cleared.");

    try {
      await sendToTopic("planner", text, {
        replyMarkup: carryoverKeyboard(carryovers),
      });
    } catch (error) {
      console.error("Nightly check-in message failed after the clear:", error);
      return res.status(502).send("message failed; todos were cleared");
    }
  }

  return res.status(200).send("checked in and cleared");
}
