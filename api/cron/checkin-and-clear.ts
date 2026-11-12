import type { VercelRequest, VercelResponse } from "@vercel/node";
import { asc, sql } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { todos } from "../../src/db/schema.js";
import { sendTelegramMessage } from "../../src/telegram.js";
import { formatTodoItem } from "../../src/task-todo.js";

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

  // Only ping if there was actually something on the list today.
  let sendFailed = false;
  if (items.length > 0) {
    const text =
      "🌙 Before the day ends — here's what was on today's list:\n" +
      items.map((item) => formatTodoItem(item)).join("\n") +
      "\n\nDid you get through these?";

    try {
      await sendTelegramMessage(text);
    } catch (error) {
      sendFailed = true;
      console.error(
        "Nightly check-in message failed; continuing with the required clear:",
        error,
      );
    }
  }

  // Runs right after the message so the two can never fire out of order.
  // TRUNCATE also restarts the serial ID, so each new daily list begins at #1.
  // (Vercel Hobby only guarantees cron timing to the hour, not the minute).
  try {
    await db.execute(sql`truncate table ${todos} restart identity`);
  } catch (error) {
    console.error("Nightly todo clear failed:", error);
    return res
      .status(500)
      .send(sendFailed ? "message and clear failed" : "clear failed");
  }

  if (sendFailed)
    return res.status(502).send("message failed; todos were cleared");
  return res.status(200).send("checked in and cleared");
}
