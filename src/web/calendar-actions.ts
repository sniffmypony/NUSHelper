import { randomBytes, randomInt } from "node:crypto";
import { and, asc, eq, gte, isNotNull, lt, lte } from "drizzle-orm";
import { addReminder, cancelReminder } from "../bot-actions.js";
import { isCalendarConfigured } from "../calendar/config.js";
import { getCalendarGateway } from "../calendar/google.js";
import { parseCalendarEventMessage } from "../calendar/parser.js";
import { db } from "../db/client.js";
import { canvasDeadlines, reminders, tasks } from "../db/schema.js";
import { telegramOwnerId } from "../env.js";
import { processCompletedExpenditureDay } from "../expenditure-service.js";
import { expenditureStore } from "../expenditure-store.js";
import {
  formatCurrency,
  formatLongDate,
  isDateEditable,
  shouldSendReportsNow,
} from "../expenditure.js";
import type { ParsedReminderCommand } from "../message-lines.js";
import { timetableStore } from "../nus/timetable.js";
import { scheduleReminder, reminderProblemMessage } from "../reminders.js";
import { sendTo } from "../topics.js";
import { calendarRange, type CalendarRange } from "./calendar.js";

// What the website's calendar can do. Each change goes through the same
// code as the bot's commands, so the same rules apply.

export type ActionResult = { ok: boolean; message: string };

export interface CalendarActions {
  range(start: string, end: string): Promise<CalendarRange>;
  changeSpending(
    date: string,
    cents: number,
    mode: "add" | "remove",
  ): Promise<ActionResult>;
  addReminder(
    date: string,
    time: string,
    description: string,
  ): Promise<ActionResult>;
  moveReminder(id: number, date: string, time: string): Promise<ActionResult>;
  cancelReminder(id: number): Promise<ActionResult>;
  addEvent(line: string): Promise<ActionResult>;
  deleteEvent(id: string): Promise<ActionResult>;
}

// The source id of a website change, so it can't collide with a Telegram
// message id (those are positive).
const webSourceId = () => -randomInt(1, 2_000_000_000);
const WEB_CHAT = "web";

function reminderCommand(
  date: string,
  time: string,
  description: string,
): ParsedReminderCommand {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return { hour, minute, description, day: { kind: "date", day, month, year } };
}

export const calendarActions: CalendarActions = {
  range(start, end) {
    const owner = telegramOwnerId();
    return calendarRange(start, end, {
      spending: (from, to) => expenditureStore.daysInRange(from, to),
      reminders: (from, to) =>
        db
          .select({
            id: reminders.id,
            description: reminders.description,
            scheduledAt: reminders.scheduledAt,
            status: reminders.status,
          })
          .from(reminders)
          .where(
            and(
              eq(reminders.ownerId, owner),
              gte(reminders.scheduledAt, from),
              lt(reminders.scheduledAt, to),
            ),
          )
          .orderBy(asc(reminders.scheduledAt)),
      tasks: (from, to) =>
        db
          .select({
            id: tasks.id,
            description: tasks.description,
            module: tasks.module,
            dueDate: tasks.dueDate,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.done, false),
              isNotNull(tasks.dueDate),
              gte(tasks.dueDate, from),
              lte(tasks.dueDate, to),
            ),
          ),
      deadlines: (from, to) =>
        db
          .select({
            moduleCode: canvasDeadlines.moduleCode,
            name: canvasDeadlines.name,
            dueAt: canvasDeadlines.dueAt,
            htmlUrl: canvasDeadlines.htmlUrl,
          })
          .from(canvasDeadlines)
          .where(
            and(
              gte(canvasDeadlines.dueAt, from),
              lt(canvasDeadlines.dueAt, to),
            ),
          ),
      lessons: () => timetableStore.all(),
      events: isCalendarConfigured()
        ? async (timeMin, timeMax) =>
            (await getCalendarGateway()).listRange(timeMin, timeMax)
        : null,
    });
  },

  async changeSpending(date, cents, mode) {
    const now = new Date();
    if (!isDateEditable(date, now)) {
      return {
        ok: false,
        message:
          "That day can't be edited (it's in the future or over a year ago).",
      };
    }
    const owner = telegramOwnerId();
    // The same short entry window the Add/Remove buttons open, used at once.
    await expenditureStore.openEditSession(owner, WEB_CHAT, date, mode, now);
    let result;
    try {
      result = await expenditureStore.applyInput(
        owner,
        WEB_CHAT,
        webSourceId(),
        cents,
        now,
      );
    } finally {
      await expenditureStore.closeSession(owner);
    }
    if (result.kind === "negative") {
      return {
        ok: false,
        message: `Can't remove ${formatCurrency(cents)}: ${formatLongDate(result.spendDate)} only has ${formatCurrency(result.totalCents)}.`,
      };
    }
    if (result.kind !== "applied") {
      return { ok: false, message: "Nothing was recorded. Please try again." };
    }
    if (shouldSendReportsNow(result.spendDate, now)) {
      await processCompletedExpenditureDay(
        result.spendDate,
        sendTo("expenditure"),
        expenditureStore,
        now,
      );
    }
    return {
      ok: true,
      message: `${formatLongDate(result.spendDate)}: ${formatCurrency(result.totalCents)}`,
    };
  },

  async addReminder(date, time, description) {
    const owner = telegramOwnerId();
    const result = await addReminder(reminderCommand(date, time, description), {
      ownerId: owner,
      // A private chat's id is the user's id: the bot texts the owner.
      chatId: owner,
      sourceMessageId: webSourceId(),
      sourceLine: 0,
    });
    return { ok: Boolean(result.id), message: result.message };
  },

  async moveReminder(id, date, time) {
    const command = reminderCommand(date, time, "");
    const scheduled = scheduleReminder(command);
    if (!scheduled.ok) {
      return {
        ok: false,
        message: reminderProblemMessage(scheduled.problem, command),
      };
    }
    const moved = await db
      .update(reminders)
      .set({
        scheduledAt: scheduled.schedule.scheduledAt,
        expiresAt: scheduled.schedule.expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.ownerId, telegramOwnerId()),
          eq(reminders.status, "pending"),
        ),
      )
      .returning({ description: reminders.description });
    return moved.length > 0
      ? { ok: true, message: `Moved: ${moved[0].description}` }
      : { ok: false, message: "That reminder was already sent or removed." };
  },

  async cancelReminder(id) {
    const message = await cancelReminder(id, telegramOwnerId());
    return { ok: message.startsWith("Cancelled"), message };
  },

  async addEvent(line) {
    if (!isCalendarConfigured()) {
      return { ok: false, message: "Google Calendar isn't set up." };
    }
    const parsed = parseCalendarEventMessage(line);
    if (!parsed.ok) {
      return {
        ok: false,
        message: "That event isn't valid. Check the date and times.",
      };
    }
    const gateway = await getCalendarGateway();
    // Google event ids may use 0-9 and a-v; random hex fits.
    const eventId = randomBytes(16).toString("hex");
    await gateway.create(eventId, parsed.event, eventId, WEB_CHAT, 0);
    return { ok: true, message: `Added: ${parsed.event.title}` };
  },

  async deleteEvent(id) {
    if (!isCalendarConfigured()) {
      return { ok: false, message: "Google Calendar isn't set up." };
    }
    const result = await (await getCalendarGateway()).delete(id);
    return {
      ok: true,
      message:
        result === "deleted"
          ? "Event deleted."
          : "That event was already gone.",
    };
  },
};
