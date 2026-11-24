import { randomInt } from "node:crypto";
import { DateTime } from "luxon";
import type { BotActions, UndoRef } from "../assistant/bot-tools.js";
import { describeDeletable } from "../assistant/buttons.js";
import * as actions from "../bot-actions.js";
import { formatCalendarAgendaEvent } from "../calendar/agenda.js";
import { listCalendarEvents } from "../calendar/handlers.js";
import { getCalendarGateway } from "../calendar/google.js";
import { parseCalendarEventMessage } from "../calendar/parser.js";
import { SINGAPORE_TIME_ZONE, todayInSingapore } from "../dates.js";
import { classesOn } from "../nus/timetable.js";
import { parseRecurrence } from "../recurrence.js";
import { addRecurring, listRecurring } from "../recurring.js";
import type { CalendarActions } from "./calendar-actions.js";
import type { ChatCard } from "./chat-cards.js";

// The bot's own commands for one website chat message: the same code the
// Telegram assistant runs (src/bot.ts), except that confirmations become
// cards on the reply instead of Telegram buttons.

const PENDING =
  "Shown to the user as a card with Confirm/Cancel. Nothing happens until they press Confirm.";

function eventLabel(line: string): string | null {
  const parsed = parseCalendarEventMessage(line);
  if (!parsed.ok) return null;
  const { event } = parsed;
  const start = DateTime.fromISO(event.startDateTime).setZone(
    SINGAPORE_TIME_ZONE,
  );
  const end = DateTime.fromISO(event.endDateTime).setZone(SINGAPORE_TIME_ZONE);
  const when = event.allDay
    ? `${start.toFormat("ccc d LLL yyyy")}, all day`
    : `${start.toFormat("ccc d LLL yyyy, HH:mm")}–${end.toFormat("HH:mm")}`;
  return `${event.title} — ${when}${event.repeat ? `, repeats ${event.repeat}` : ""}`;
}

export function webBotActions(
  ownerId: string,
  calendar: Pick<CalendarActions, "changeSpending">,
  cards: ChatCard[],
): BotActions {
  // Website changes use negative source ids so they never collide with a
  // Telegram message id; one id per chat message, a line per reminder.
  const sourceMessageId = -randomInt(1, 2_000_000_000);
  let reminderLine = 0;
  let expenditureLogged = false;

  return {
    addTask: async (input) => {
      const result = await actions.addTask(input);
      return {
        message: result.message,
        undo: result.id
          ? { kind: "task", id: result.id, label: result.label ?? "task" }
          : undefined,
      };
    },
    listTasks: () => actions.listOpenTasks(true),
    completeTask: actions.completeTask,
    addTodo: async (description) => {
      const result = await actions.addTodo(description);
      return {
        message: result.message,
        undo: result.id
          ? { kind: "todo", id: result.id, label: result.label ?? "to-do" }
          : undefined,
      };
    },
    listTodos: () => actions.listTodayTodos(true),
    addReminder: async (command) => {
      const result = await actions.addReminder(command, {
        ownerId,
        // A private chat's id is the user's id: the bot texts the owner.
        chatId: ownerId,
        sourceMessageId,
        sourceLine: reminderLine++,
      });
      if (result.id === undefined)
        return { message: `Not set: ${result.message}` };
      return {
        message: result.message,
        undo: { kind: "rem", id: result.id, label: result.label ?? "reminder" },
      };
    },
    listReminders: () =>
      actions.listPendingReminders(ownerId, new Date(), true),
    addRepeating: async (when, description) => {
      const rule = parseRecurrence(when);
      if (!rule) {
        return {
          message:
            'Not added: use "day", "weekdays", weekday names such as "mon,thu", or a day of the month from 1 to 31.',
        };
      }
      const result = await addRecurring(rule, description);
      return {
        message: result.message,
        undo: result.id
          ? { kind: "rep", id: result.id, label: result.label ?? "repeat" }
          : undefined,
      };
    },
    listRepeating: () => listRecurring(true),
    stageCalendarEvent: async (line) => {
      const label = eventLabel(line);
      if (!label) return false;
      cards.push({ type: "calendar-create", line, label, state: "pending" });
      return true;
    },
    listCalendarEvents: (startDate, days) =>
      listCalendarEvents(startDate || todayInSingapore(), days),
    requestDeletion: async (kind, id) => {
      const label = await describeDeletable(kind, id, ownerId);
      if (!label) {
        return `Error: that item was not found${kind === "rem" ? " or has already been sent" : ""}.`;
      }
      cards.push({
        type: "delete",
        kind,
        id,
        label: `Delete ${label}?`,
        state: "pending",
      });
      return PENDING;
    },
    requestCalendarDeletion: async (eventId) => {
      if (!/^[A-Za-z0-9_]{1,1024}$/.test(eventId)) {
        return "Error: that event id is not valid. Use an id from list_calendar_events.";
      }
      const event = await (await getCalendarGateway()).getAgendaEvent(eventId);
      if (!event) return "Error: no event with that id was found.";
      cards.push({
        type: "calendar-delete",
        eventId: event.id,
        label: `Delete from Google Calendar? ${formatCalendarAgendaEvent(event).replace(/^• /, "")}`,
        state: "pending",
      });
      return PENDING;
    },
    logExpenditure: async (amountCents, date, mode) => {
      if (expenditureLogged) {
        return "Error: only one expenditure entry can be made per message. Combine the amounts into one call.";
      }
      expenditureLogged = true;
      const result = await calendar.changeSpending(
        date ?? todayInSingapore(),
        amountCents,
        mode,
      );
      return result.ok
        ? `${mode === "add" ? "Added" : "Removed"}. New total for ${result.message}`
        : `Error: ${result.message}`;
    },
    expenditureReport: (period, date) =>
      actions.expenditureReport(period, date),
    expenditureBreakdown: actions.expenditureBreakdown,
    classesOn: (date) => classesOn(date),
  };
}

// Undo cards for what the assistant added, after its reply.
export function undoCards(refs: UndoRef[]): ChatCard[] {
  return refs.map((ref) => ({
    type: "undo",
    kind: ref.kind,
    id: ref.id,
    label: `Undo: ${ref.label}`,
    state: "pending",
  }));
}
