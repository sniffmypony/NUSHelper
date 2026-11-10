import type { VercelRequest, VercelResponse } from "@vercel/node";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { tasks, todos } from "../../src/db/schema.js";
import { addDays, todayInSingapore } from "../../src/dates.js";
import { sendTelegramMessage } from "../../src/telegram.js";
import { formatTodoItem, isTaskDueOn } from "../../src/task-todo.js";
import { singaporeDateRange } from "../../src/dates.js";
import { formatCalendarAgenda } from "../../src/calendar/agenda.js";
import { isCalendarConfigured } from "../../src/calendar/config.js";
import { getCalendarGateway } from "../../src/calendar/google.js";
import { withVercelOidcToken } from "../../src/calendar/request-context.js";
import type { CalendarAgendaEvent } from "../../src/calendar/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send("unauthorized");
  }

  const today = todayInSingapore();
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);

  let dueSoon: (typeof tasks.$inferSelect)[];
  let todosToday: (typeof todos.$inferSelect)[];
  try {
    dueSoon = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.done, false),
          gte(tasks.dueDate, today),
          lte(tasks.dueDate, tomorrow),
        ),
      )
      .orderBy(asc(tasks.dueDate), asc(tasks.id));

    const dueToday = dueSoon.filter((task) => isTaskDueOn(task.dueDate, today));
    if (dueToday.length > 0) {
      await db
        .insert(todos)
        .values(
          dueToday.map((task) => ({
            description: task.description,
            taskId: task.id,
          })),
        )
        .onConflictDoNothing({ target: todos.taskId });
    }

    todosToday = await db.select().from(todos).orderBy(asc(todos.id));
  } catch (error) {
    console.error("Daily morning database query failed:", error);
    return res.status(500).send("daily morning database query failed");
  }

  let calendarEvents: CalendarAgendaEvent[] = [];
  let calendarReadFailed = false;
  // Google Calendar is optional: without it the section is simply left out.
  if (isCalendarConfigured())
    try {
      const range = singaporeDateRange(today, 3);
      calendarEvents = await withVercelOidcToken(
        req.headers["x-vercel-oidc-token"],
        async () => {
          const gateway = await getCalendarGateway();
          return gateway.listRange(range.timeMin, range.timeMax);
        },
      );
    } catch (error) {
      calendarReadFailed = true;
      console.error("Daily morning Calendar query failed:", error);
    }

  const sections: string[] = [];
  const dueTomorrow = dueSoon.filter((task) =>
    isTaskDueOn(task.dueDate, tomorrow),
  );
  if (dueTomorrow.length) {
    sections.push(
      "📋 Due tomorrow:\n" +
        dueTomorrow
          .map(
            (t) =>
              `#${t.id} ${t.description}${t.module ? ` [${t.module}]` : ""} — ${t.dueDate}`,
          )
          .join("\n"),
    );
  }
  if (todosToday.length) {
    sections.push(
      "✅ Today's to-dos:\n" + todosToday.map(formatTodoItem).join("\n"),
    );
  }
  if (calendarEvents.length) {
    sections.push(
      `📅 Calendar — today through ${dayAfterTomorrow}:\n` +
        formatCalendarAgenda(calendarEvents),
    );
  } else if (calendarReadFailed) {
    sections.push(
      "⚠️ I couldn't check Google Calendar, so this update may be incomplete.",
    );
  }

  const text = sections.length
    ? "🌅 Good morning!\n\n" + sections.join("\n\n")
    : "🌅 Good morning! Nothing due soon and nothing on today's list yet.";

  try {
    await sendTelegramMessage(text, {
      replyMarkup: {
        inline_keyboard: [
          [{ text: "✅", callback_data: `morning:done:${today}` }],
        ],
      },
    });
    return res.status(200).send("sent");
  } catch (error) {
    console.error("Daily morning Telegram delivery failed:", error);
    return res.status(502).send("daily morning delivery failed");
  }
}
