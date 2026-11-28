import { calendarId, FIXED_TIME_ZONE } from "./config.js";
import { CalendarMcpError, callCalendarTool, type ToolResult } from "./mcp.js";
import { recurrenceRule, type ParsedCalendarEvent } from "./parser.js";
import type {
  CalendarAgendaEvent,
  CalendarGateway,
  StoredGoogleEvent,
} from "./types.js";

// Google Calendar through Google's Calendar MCP server, signed in as the
// owner: the gateway for what the assistant (an AI) does. It can't choose
// event ids or add private properties, so the bot's own events (birthdays,
// deadlines, finals) keep the REST gateway.

type Fetch = typeof fetch;

// A local time with no offset, as the MCP tools want, with the time zone
// passed separately: "2026-09-01T12:30:00+08:00" -> "2026-09-01T12:30:00".
export function localTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00`;
  return value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "").slice(0, 19);
}

type Json = Record<string, unknown>;

// The replies' JSON: structured content if given, else the first text part.
function replyJson(result: ToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const part of result.content ?? []) {
    if (!part.text) continue;
    try {
      return JSON.parse(part.text);
    } catch {
      // Plain text.
    }
  }
  return null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

// One event in whatever field names the server uses (REST's, or flatter).
export function agendaEvent(raw: unknown): CalendarAgendaEvent | null {
  const event = (raw ?? {}) as Json;
  const id = text(event.id) ?? text(event.eventId);
  if (!id || event.status === "cancelled") return null;
  const start = (event.start ?? {}) as Json;
  const end = (event.end ?? {}) as Json;
  const base = {
    id,
    title:
      text(event.summary)?.trim() ||
      text(event.title)?.trim() ||
      "(Untitled event)",
    htmlLink: text(event.htmlLink) ?? text(event.url),
  };
  const startDate = text(start.date);
  const endDate = text(end.date);
  if (startDate && endDate) {
    return { ...base, allDay: true, startDate, endDate };
  }
  const startDateTime =
    text(start.dateTime) ?? text(event.startTime) ?? text(event.start);
  const endDateTime =
    text(end.dateTime) ?? text(event.endTime) ?? text(event.end);
  if (!startDateTime || !endDateTime) return null;
  if (event.allDay === true) {
    return {
      ...base,
      allDay: true,
      startDate: startDateTime.slice(0, 10),
      endDate: endDateTime.slice(0, 10),
    };
  }
  return { ...base, allDay: false, startDateTime, endDateTime };
}

function eventsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const value = (json ?? {}) as Json;
  for (const key of ["events", "items"]) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return [];
}

function storedEvent(json: unknown): StoredGoogleEvent | null {
  const value = (json ?? {}) as Json;
  const event = (value.event ?? value) as Json;
  const id = text(event.id) ?? text(event.eventId);
  return id ? { id, htmlLink: text(event.htmlLink) ?? text(event.url) } : null;
}

const notFound = (error: unknown) =>
  error instanceof CalendarMcpError &&
  (error.status === 404 || /not ?found|404|deleted/i.test(error.message));

// Looking up an event: a refusal from the tool itself (no HTTP error, so not
// a sign-in or network problem) means there is no such event.
const missing = (error: unknown) =>
  notFound(error) || (error instanceof CalendarMcpError && error.fromTool);

export class McpCalendarGateway implements CalendarGateway {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(name: string, args: Json): Promise<unknown> {
    const result = await callCalendarTool(
      name,
      { calendarId: calendarId(), ...args },
      await this.accessToken(),
      this.fetchImpl,
    );
    return replyJson(result);
  }

  async checkReadable(): Promise<void> {
    await this.call("list_events", { pageSize: 1 });
  }

  async listRange(
    timeMin: string,
    timeMax: string,
  ): Promise<CalendarAgendaEvent[]> {
    const events: CalendarAgendaEvent[] = [];
    let pageToken: string | undefined;
    // A few pages at most: the assistant shows up to 40 events.
    for (let page = 0; page < 4; page += 1) {
      const json = (await this.call("list_events", {
        startTime: localTime(timeMin),
        endTime: localTime(timeMax),
        timeZone: FIXED_TIME_ZONE,
        orderBy: "startTime",
        pageSize: 250,
        ...(pageToken ? { pageToken } : {}),
      })) as Json | null;
      for (const raw of eventsOf(json)) {
        const event = agendaEvent(raw);
        if (event) events.push(event);
      }
      pageToken = text(json?.nextPageToken) ?? undefined;
      if (!pageToken) break;
    }
    return events;
  }

  async getAgendaEvent(eventId: string): Promise<CalendarAgendaEvent | null> {
    try {
      const json = (await this.call("get_event", { eventId })) as Json | null;
      return agendaEvent(json?.event ?? json);
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async get(eventId: string): Promise<StoredGoogleEvent | null> {
    try {
      return storedEvent(await this.call("get_event", { eventId }));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  // Google chooses the id: the one passed in (for REST's retries) is unused.
  async create(
    _eventId: string,
    event: ParsedCalendarEvent,
  ): Promise<StoredGoogleEvent> {
    const json = await this.call("create_event", {
      summary: event.title,
      startTime: localTime(event.startDateTime),
      endTime: localTime(event.endDateTime),
      allDay: event.allDay,
      timeZone: FIXED_TIME_ZONE,
      ...(event.repeat
        ? { recurrenceData: [recurrenceRule(event.repeat)] }
        : {}),
      notificationLevel: "NONE",
    });
    const stored = storedEvent(json);
    if (!stored) {
      throw new CalendarMcpError(
        "Google Calendar added the event but didn't say which one it was.",
      );
    }
    return stored;
  }

  async update(
    eventId: string,
    event: ParsedCalendarEvent,
  ): Promise<StoredGoogleEvent | null> {
    try {
      const json = await this.call("update_event", {
        eventId,
        summary: event.title,
        startTime: localTime(event.startDateTime),
        endTime: localTime(event.endDateTime),
        allDay: event.allDay,
        timeZone: FIXED_TIME_ZONE,
        notificationLevel: "NONE",
      });
      return storedEvent(json) ?? { id: eventId, htmlLink: null };
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  }

  async delete(eventId: string): Promise<"deleted" | "already-deleted"> {
    try {
      await this.call("delete_event", { eventId, notificationLevel: "NONE" });
      return "deleted";
    } catch (error) {
      if (notFound(error)) return "already-deleted";
      throw error;
    }
  }
}
