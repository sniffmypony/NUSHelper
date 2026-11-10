import { and, asc, eq, gt } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./db/client.js";
import { reminders, tasks, todos } from "./db/schema.js";
import {
  SINGAPORE_TIME_ZONE,
  isValidIsoDate,
  todayInSingapore,
} from "./dates.js";
import {
  breakdownRangeProblem,
  formatDailyBreakdown,
  formatMonthlyReport,
  formatWeeklyReport,
  monthPeriodFor,
  weekPeriodFor,
} from "./expenditure.js";
import { expenditureStore } from "./expenditure-store.js";
import type { ParsedReminderCommand } from "./message-lines.js";
import { scheduleReminderToday } from "./reminders.js";
import { reminderStore } from "./reminder-store.js";
import { formatTodoItem, isTaskDueOn } from "./task-todo.js";

// The bodies of the task, to-do, reminder and expenditure commands. Both the
// slash commands and the Canvas assistant's tools call these, so validation,
// storage and confirmations are identical whichever way a request arrives.

export type ActionResult = { message: string; id?: number };

// Pulls "#MODULE" and "@YYYY-MM-DD" out of free text, whatever order they're typed in.
export function parseTaskInput(input: string):
  | {
      description: string;
      module: string | null;
      dueDate: string | null;
      error?: never;
    }
  | { error: string; description?: never; module?: never; dueDate?: never } {
  let text = input;
  const dueMatch = text.match(/@(\d{4}-\d{2}-\d{2})/);
  const moduleMatch = text.match(/#(\w+)/);

  if (dueMatch && !isValidIsoDate(dueMatch[1])) {
    return {
      error: `Invalid due date: ${dueMatch[1]}. Use a real date in YYYY-MM-DD format.`,
    };
  }

  if (dueMatch) text = text.replace(dueMatch[0], "");
  if (moduleMatch) text = text.replace(moduleMatch[0], "");

  return {
    description: text.trim(),
    module: moduleMatch ? moduleMatch[1].toUpperCase() : null,
    dueDate: dueMatch ? dueMatch[1] : null,
  };
}

export async function addTask(input: string): Promise<ActionResult> {
  const parsed = parseTaskInput(input);
  if (parsed.error) return { message: parsed.error };

  const { description, module, dueDate } = parsed;
  if (!description) return { message: "Task needs a description." };

  const dueToday = isTaskDueOn(dueDate, todayInSingapore());
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tasks)
      .values({ description, module, dueDate })
      .returning({ id: tasks.id });

    if (dueToday) {
      await tx
        .insert(todos)
        .values({ description, taskId: created.id })
        .onConflictDoNothing({ target: todos.taskId });
    }

    return created;
  });

  return {
    id: row.id,
    message:
      `Added #${row.id}: ${description}${module ? ` [${module}]` : ""}${dueDate ? ` — due ${dueDate}` : ""}` +
      (dueToday ? `\nAlso added to today's to-do list (task #${row.id}).` : ""),
  };
}

export async function completeTask(id: number): Promise<string> {
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(tasks)
      .set({ done: true })
      .where(eq(tasks.id, id))
      .returning({ id: tasks.id });

    if (rows.length > 0) {
      await tx.delete(todos).where(eq(todos.taskId, id));
    }

    return rows;
  });
  if (updated.length === 0) return `Task #${id} not found.`;
  return `Marked #${id} done ✅`;
}

export async function removeTask(id: number): Promise<string> {
  const deleted = await db
    .delete(tasks)
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id });
  if (deleted.length === 0) return `Task #${id} not found.`;
  return `Removed #${id}`;
}

export async function findTask(
  id: number,
): Promise<{ id: number; description: string } | null> {
  const [row] = await db
    .select({ id: tasks.id, description: tasks.description })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  return row ?? null;
}

export async function listOpenTasks(): Promise<string> {
  const open = await db
    .select()
    .from(tasks)
    .where(eq(tasks.done, false))
    .orderBy(asc(tasks.dueDate));
  if (open.length === 0) return "Nothing on your list 🎉";

  return open
    .map(
      (t) =>
        `#${t.id} ${t.description}${t.module ? ` [${t.module}]` : ""}${t.dueDate ? ` — due ${t.dueDate}` : ""}`,
    )
    .join("\n");
}

export async function addTodo(description: string): Promise<ActionResult> {
  const [row] = await db
    .insert(todos)
    .values({ description })
    .returning({ id: todos.id });
  return {
    id: row.id,
    message: `Added to today's list: #${row.id} ${description}`,
  };
}

export async function findTodo(
  id: number,
): Promise<{ id: number; description: string } | null> {
  const [row] = await db
    .select({ id: todos.id, description: todos.description })
    .from(todos)
    .where(eq(todos.id, id))
    .limit(1);
  return row ?? null;
}

export async function deleteTodo(id: number): Promise<string> {
  const deleted = await db
    .delete(todos)
    .where(eq(todos.id, id))
    .returning({ description: todos.description });
  if (deleted.length === 0) return `To-do #${id} not found.`;
  return `Removed to-do #${id}: ${deleted[0].description}`;
}

export async function listTodayTodos(): Promise<string> {
  const items = await db.select().from(todos).orderBy(asc(todos.id));
  if (items.length === 0) return "Today's list is empty.";
  return items.map(formatTodoItem).join("\n");
}

// Returns null when the time has already passed today.
export async function addReminder(
  command: ParsedReminderCommand,
  source: {
    ownerId: string;
    chatId: string;
    sourceMessageId: number;
    sourceLine: number;
  },
): Promise<ActionResult | null> {
  const schedule = scheduleReminderToday(command);
  if (!schedule) return null;

  const reminder = await reminderStore.create({
    ...source,
    description: command.description,
    scheduledAt: schedule.scheduledAt,
    expiresAt: schedule.expiresAt,
  });
  return {
    id: reminder.id,
    message: `Reminder set for ${schedule.displayTime} today: ${command.description}`,
  };
}

function reminderTime(date: Date): string {
  return DateTime.fromJSDate(date)
    .setZone(SINGAPORE_TIME_ZONE)
    .toFormat("HH:mm");
}

export async function listPendingReminders(
  ownerId: string,
  now = new Date(),
): Promise<string> {
  const rows = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.status, "pending"),
        gt(reminders.expiresAt, now),
      ),
    )
    .orderBy(asc(reminders.scheduledAt));
  if (rows.length === 0) return "No reminders are waiting to be sent.";
  return rows
    .map(
      (row) => `#${row.id} ${reminderTime(row.scheduledAt)} ${row.description}`,
    )
    .join("\n");
}

export async function findPendingReminder(
  id: number,
  ownerId: string,
): Promise<{ id: number; description: string; time: string } | null> {
  const [row] = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.id, id),
        eq(reminders.ownerId, ownerId),
        eq(reminders.status, "pending"),
      ),
    )
    .limit(1);
  return row
    ? {
        id: row.id,
        description: row.description,
        time: reminderTime(row.scheduledAt),
      }
    : null;
}

// Only a reminder that has not started sending can be cancelled.
export async function cancelReminder(
  id: number,
  ownerId: string,
): Promise<string> {
  const deleted = await db
    .delete(reminders)
    .where(
      and(
        eq(reminders.id, id),
        eq(reminders.ownerId, ownerId),
        eq(reminders.status, "pending"),
      ),
    )
    .returning({ description: reminders.description });
  if (deleted.length === 0) {
    return `Reminder #${id} was not found or has already been sent.`;
  }
  return `Cancelled reminder #${id}: ${deleted[0].description}`;
}

export async function expenditureBreakdown(
  start: string,
  end: string,
): Promise<string> {
  const period = { start, end };
  const problem = breakdownRangeProblem(period);
  if (problem) return problem;
  const days = await expenditureStore.daysInRange(start, end);
  return formatDailyBreakdown(days, period);
}

// Weekly reports cover Monday–Sunday plus the month-to-date total; monthly
// reports match "<month> <year> expenditure".
export async function expenditureReport(
  period: "week" | "month",
  date = todayInSingapore(),
): Promise<string> {
  if (period === "month") {
    const range = monthPeriodFor(date);
    const days = await expenditureStore.daysInRange(range.start, range.end);
    if (days.length === 0) {
      const label = DateTime.fromISO(date, {
        zone: SINGAPORE_TIME_ZONE,
      }).toFormat("LLLL yyyy");
      return `No expenditure data is stored for ${label}.`;
    }
    return formatMonthlyReport(days, range, false, true);
  }

  const range = weekPeriodFor(date);
  const monthStart = DateTime.fromISO(range.end, { zone: SINGAPORE_TIME_ZONE })
    .startOf("month")
    .toISODate()!;
  const start = monthStart < range.start ? monthStart : range.start;
  const days = await expenditureStore.daysInRange(start, range.end);
  return formatWeeklyReport(days, range);
}
