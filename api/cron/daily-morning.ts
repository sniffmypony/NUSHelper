import type { VercelRequest, VercelResponse } from "@vercel/node";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { tasks, todos } from "../../src/db/schema.js";
import {
  addDays,
  singaporeDateRange,
  todayInSingapore,
} from "../../src/dates.js";
import {
  formatTaskItem,
  formatTodoItem,
  isTaskDueOn,
} from "../../src/task-todo.js";
import { formatCalendarAgenda } from "../../src/calendar/agenda.js";
import { isCalendarConfigured } from "../../src/calendar/config.js";
import { getCalendarGateway } from "../../src/calendar/google.js";
import { withVercelOidcToken } from "../../src/calendar/request-context.js";
import type { CalendarAgendaEvent } from "../../src/calendar/types.js";
import { canvasDeadlineSection } from "../../src/canvas/deadlines.js";
import { todaysClassesSection } from "../../src/nus/timetable.js";
import { addDueRecurringTodos } from "../../src/recurring.js";
import { sendToTopic } from "../../src/topics.js";

const CANVAS_WINDOW_HOURS = 48;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send("unauthorized");
  }

  const now = new Date();
  const today = todayInSingapore(now);
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);

  // Repeating items (/every) due today join the to-do list first. They are
  // an extra: a failure here must not stop the morning message.
  try {
    await addDueRecurringTodos(today);
  } catch (error) {
    console.error("Daily morning could not add repeating items:", error);
  }

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

  // Classes show only in teaching weeks 1-13 (see src/nus/academic-week.ts).
  let classes: string | null = null;
  try {
    classes = await todaysClassesSection(today);
  } catch (error) {
    console.error("Daily morning could not read the timetable:", error);
  }

  // Canvas is optional too: unsubmitted work due in the next 48 hours.
  const canvas = await canvasDeadlineSection(
    "🎓 Canvas — due in the next 48 hours:",
    now,
    new Date(now.getTime() + CANVAS_WINDOW_HOURS * 3_600_000),
    { includeSubmitted: false },
  );

  const sections: string[] = [];
  if (classes) sections.push(classes);
  if (canvas.text) sections.push(canvas.text);
  const dueTomorrow = dueSoon.filter((task) =>
    isTaskDueOn(task.dueDate, tomorrow),
  );
  if (dueTomorrow.length) {
    sections.push(
      "📋 Due tomorrow:\n" +
        dueTomorrow.map((t) => formatTaskItem(t)).join("\n"),
    );
  }
  if (todosToday.length) {
    sections.push(
      "✅ Today's to-dos:\n" +
        todosToday.map((item) => formatTodoItem(item)).join("\n"),
    );
  }
  if (calendarEvents.length) {
    sections.push(
      `📅 Calendar — today through ${dayAfterTomorrow}:\n` +
        formatCalendarAgenda(calendarEvents),
    );
  }
  const unchecked = [
    ...(calendarReadFailed ? ["Google Calendar"] : []),
    ...(canvas.failed ? ["Canvas"] : []),
  ];
  if (unchecked.length > 0) {
    sections.push(
      `⚠️ I couldn't check ${unchecked.join(" or ")}, so this update may be incomplete.`,
    );
  }

  const text = sections.length
    ? "🌅 Good morning!\n\n" + sections.join("\n\n")
    : "🌅 Good morning! Nothing due soon and nothing on today's list yet.";

  try {
    await sendToTopic("planner", text, {
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
