import { isValidIsoDate } from "../dates.js";
import { CALENDAR_REPEATS } from "../calendar/parser.js";
import { parseExpenditureAmounts } from "../expenditure.js";
import type { CalendarActions } from "./calendar-actions.js";
import { rangeProblem } from "./calendar.js";

// The calendar's API routes, called by the router after sign-in. Inputs are
// checked here; the actions reuse the bot's own rules.

type Response = { status: number; body: unknown };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_ID = /^[A-Za-z0-9_-]{5,1024}$/;

function field(body: unknown, name: string): unknown {
  return (body as Record<string, unknown> | null)?.[name];
}

function text(body: unknown, name: string): string {
  const value = field(body, name);
  return typeof value === "string" ? value.trim() : "";
}

const bad = (error: string): Response => ({ status: 400, body: { error } });
const result = (outcome: { ok: boolean; message: string }): Response => ({
  status: outcome.ok ? 200 : 422,
  body: outcome.ok ? outcome : { error: outcome.message },
});

// "Planning, phase 2" -> quoted, as in a typed calendar line.
function calendarField(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function ddmmyyyy(date: string): string {
  return date.split("-").reverse().join("-");
}

export async function calendarRoute(
  method: string,
  route: string,
  body: unknown,
  actions: CalendarActions,
): Promise<Response | null> {
  const range = /^calendar\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(
    route,
  );
  if (method === "GET" && range) {
    const problem = rangeProblem(range[1], range[2]);
    if (problem) return bad(problem);
    return { status: 200, body: await actions.range(range[1], range[2]) };
  }

  if (method === "POST" && route === "spending") {
    const date = text(body, "date");
    const mode = text(body, "mode");
    const cents = parseExpenditureAmounts(text(body, "amount"));
    if (!isValidIsoDate(date)) return bad("Pick a day.");
    if (mode !== "add" && mode !== "remove")
      return bad("Choose add or remove.");
    if (cents === null || cents <= 0) {
      return bad("Enter amounts like 5.40 or 3 2.5.");
    }
    return result(await actions.changeSpending(date, cents, mode));
  }

  const reminder = /^reminders(?:\/(\d{1,10}))?$/.exec(route);
  if (reminder) {
    const id = reminder[1] ? Number(reminder[1]) : null;
    if (method === "DELETE" && id)
      return result(await actions.cancelReminder(id));
    const date = text(body, "date");
    const time = text(body, "time");
    if (!isValidIsoDate(date)) return bad("Pick a day.");
    if (!TIME.test(time)) return bad("Enter a time like 09:30.");
    if (method === "PATCH" && id) {
      return result(await actions.moveReminder(id, date, time));
    }
    if (method === "POST" && !id) {
      const description = text(body, "description");
      if (!description || description.length > 500) {
        return bad("Say what to remind you about (up to 500 characters).");
      }
      return result(await actions.addReminder(date, time, description));
    }
  }

  const event = /^events(?:\/(.+))?$/.exec(route);
  if (event) {
    if (method === "DELETE" && event[1]) {
      if (!EVENT_ID.test(event[1])) return bad("Unknown event.");
      return result(await actions.deleteEvent(event[1]));
    }
    if (method === "POST" && !event[1]) {
      const date = text(body, "date");
      const title = text(body, "title");
      const allDay = field(body, "allDay") === true;
      const start = text(body, "start");
      const end = text(body, "end");
      const repeat = text(body, "repeat");
      if (!isValidIsoDate(date)) return bad("Pick a day.");
      if (!title || title.length > 200)
        return bad("Give the event a title (up to 200 characters).");
      if (!allDay && (!TIME.test(start) || !TIME.test(end))) {
        return bad("Enter start and end times like 14:00.");
      }
      if (repeat && !(CALENDAR_REPEATS as readonly string[]).includes(repeat)) {
        return bad("Unknown repeat.");
      }
      const line = [
        allDay ? "all day" : `${start}-${end}`,
        calendarField(title),
        ddmmyyyy(date),
        ...(repeat ? [repeat] : []),
      ].join(", ");
      return result(await actions.addEvent(line));
    }
  }

  return null;
}
