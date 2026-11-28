import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { createCalendarAuthClient } from "./auth.js";
import { calendarId, FIXED_TIME_ZONE, getCalendarConfig } from "./config.js";
import { recurrenceRule, type ParsedCalendarEvent } from "./parser.js";
import type {
  BotOwnedEvent,
  CalendarAgendaEvent,
  CalendarGateway,
  StoredGoogleEvent,
} from "./types.js";

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof value.code === "number") return value.code;
  if (typeof value.response?.status === "number") return value.response.status;
  return undefined;
}

function storedEvent(data: calendar_v3.Schema$Event): StoredGoogleEvent {
  if (!data.id) throw new Error("Google Calendar did not return an event ID");
  return { id: data.id, htmlLink: data.htmlLink ?? null };
}

function agendaEvent(
  data: calendar_v3.Schema$Event,
): CalendarAgendaEvent | null {
  if (!data.id || data.status === "cancelled") return null;
  const base = {
    id: data.id,
    title: data.summary?.trim() || "(Untitled event)",
    htmlLink: data.htmlLink ?? null,
  };

  if (data.start?.date && data.end?.date) {
    return {
      ...base,
      allDay: true,
      startDate: data.start.date,
      endDate: data.end.date,
    };
  }
  if (data.start?.dateTime && data.end?.dateTime) {
    return {
      ...base,
      allDay: false,
      startDateTime: data.start.dateTime,
      endDateTime: data.end.dateTime,
    };
  }
  return null;
}

// Start, end and recurrence as Google Calendar wants them. For an update
// (a patch) the unused one of date/dateTime is cleared, so an event can
// switch between timed and all-day, and an empty recurrence stops it
// repeating.
export function eventTiming(
  event: ParsedCalendarEvent,
  forPatch = false,
): Pick<calendar_v3.Schema$Event, "start" | "end" | "recurrence"> {
  const at = (value: string): calendar_v3.Schema$EventDateTime => {
    const set: calendar_v3.Schema$EventDateTime = event.allDay
      ? { date: value }
      : { dateTime: value, timeZone: FIXED_TIME_ZONE };
    if (!forPatch) return set;
    return event.allDay
      ? { ...set, dateTime: null, timeZone: null }
      : { ...set, date: null };
  };
  const recurrence = event.repeat ? [recurrenceRule(event.repeat)] : [];
  return {
    start: at(event.startDateTime),
    end: at(event.endDateTime),
    ...(forPatch || recurrence.length > 0 ? { recurrence } : {}),
  };
}

export class GoogleCalendarGateway
  implements CalendarGateway, BirthdayCalendar
{
  constructor(private readonly client: calendar_v3.Calendar) {}

  // `id` lets the website test a calendar before switching to it.
  async checkReadable(id = calendarId()): Promise<void> {
    await this.client.events.list({
      calendarId: id,
      maxResults: 1,
      singleEvents: true,
      timeMin: new Date().toISOString(),
    });
  }

  async listRange(
    timeMin: string,
    timeMax: string,
  ): Promise<CalendarAgendaEvent[]> {
    const events: CalendarAgendaEvent[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.client.events.list({
        calendarId: calendarId(),
        timeMin,
        timeMax,
        timeZone: FIXED_TIME_ZONE,
        singleEvents: true,
        orderBy: "startTime",
        showDeleted: false,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of response.data.items ?? []) {
        const normalized = agendaEvent(item);
        if (normalized) events.push(normalized);
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }

  async getAgendaEvent(eventId: string): Promise<CalendarAgendaEvent | null> {
    try {
      const response = await this.client.events.get({
        calendarId: calendarId(),
        eventId,
      });
      return agendaEvent(response.data);
    } catch (error) {
      const status = errorStatus(error);
      if (status === 404 || status === 400) return null;
      throw error;
    }
  }

  async get(eventId: string): Promise<StoredGoogleEvent | null> {
    try {
      const response = await this.client.events.get({
        calendarId: calendarId(),
        eventId,
      });
      return storedEvent(response.data);
    } catch (error) {
      if (errorStatus(error) === 404) return null;
      throw error;
    }
  }

  async create(
    eventId: string,
    event: ParsedCalendarEvent,
    operationId: string,
    chatId: string,
    messageId: number,
  ): Promise<StoredGoogleEvent> {
    if (
      event.calendarId !== calendarId() ||
      event.timeZone !== FIXED_TIME_ZONE
    ) {
      throw new Error(
        "Calendar event attempted to override the fixed calendar configuration",
      );
    }

    try {
      const response = await this.client.events.insert({
        calendarId: calendarId(),
        sendUpdates: "none",
        requestBody: {
          id: eventId,
          summary: event.title,
          ...eventTiming(event),
          extendedProperties: {
            private: {
              telegramOperationId: operationId,
              telegramChatId: chatId,
              telegramMessageId: String(messageId),
            },
          },
        },
      });
      return storedEvent(response.data);
    } catch (error) {
      if (errorStatus(error) === 409) {
        const existing = await this.get(eventId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async update(
    eventId: string,
    event: ParsedCalendarEvent,
  ): Promise<StoredGoogleEvent | null> {
    if (
      event.calendarId !== calendarId() ||
      event.timeZone !== FIXED_TIME_ZONE
    ) {
      throw new Error(
        "Calendar event attempted to override the fixed calendar configuration",
      );
    }
    try {
      const response = await this.client.events.patch({
        calendarId: calendarId(),
        eventId,
        sendUpdates: "none",
        requestBody: {
          summary: event.title,
          ...eventTiming(event, true),
        },
      });
      return storedEvent(response.data);
    } catch (error) {
      if (errorStatus(error) === 404) return null;
      throw error;
    }
  }

  async delete(eventId: string): Promise<"deleted" | "already-deleted"> {
    try {
      await this.client.events.delete({
        calendarId: calendarId(),
        eventId,
        sendUpdates: "none",
      });
      return "deleted";
    } catch (error) {
      // Google answers 410 Gone for an event that was already deleted.
      const status = errorStatus(error);
      if (status === 404 || status === 410) return "already-deleted";
      throw error;
    }
  }

  // Creates or overwrites an event under an id the bot chose. Patching the
  // status back to confirmed also restores one deleted in Google Calendar.
  async putEvent(eventId: string, event: BotOwnedEvent): Promise<void> {
    const requestBody: calendar_v3.Schema$Event = {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.startDateTime, timeZone: FIXED_TIME_ZONE },
      end: { dateTime: event.endDateTime, timeZone: FIXED_TIME_ZONE },
      status: "confirmed",
    };
    try {
      await this.client.events.patch({
        calendarId: calendarId(),
        eventId,
        sendUpdates: "none",
        requestBody,
      });
      return;
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
    }
    await this.client.events.insert({
      calendarId: calendarId(),
      sendUpdates: "none",
      requestBody: { ...requestBody, id: eventId },
    });
  }

  // Creates an event under an id the bot chose, unless that id is already
  // used. Google keeps the id of a deleted event too, so an event the user
  // edited or deleted is left exactly as they left it.
  async addEventIfMissing(
    eventId: string,
    event: BotOwnedEvent,
  ): Promise<"created" | "exists"> {
    try {
      await this.client.events.insert({
        calendarId: calendarId(),
        sendUpdates: "none",
        requestBody: {
          id: eventId,
          summary: event.title,
          description: event.description,
          start: { dateTime: event.startDateTime, timeZone: FIXED_TIME_ZONE },
          end: { dateTime: event.endDateTime, timeZone: FIXED_TIME_ZONE },
        },
      });
      return "created";
    } catch (error) {
      if (errorStatus(error) === 409) return "exists";
      throw error;
    }
  }

  async listBirthdayEvents(): Promise<calendar_v3.Schema$Event[]> {
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.client.events.list({
        calendarId: calendarId(),
        privateExtendedProperty: ["nushelperBirthday=1"],
        singleEvents: false,
        showDeleted: false,
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return events;
  }

  // Each birthday falling in a range, one entry per occurrence.
  async birthdaysBetween(
    timeMin: string,
    timeMax: string,
  ): Promise<calendar_v3.Schema$Event[]> {
    const response = await this.client.events.list({
      calendarId: calendarId(),
      privateExtendedProperty: ["nushelperBirthday=1"],
      singleEvents: true,
      showDeleted: false,
      timeMin,
      timeMax,
      maxResults: 250,
    });
    return response.data.items ?? [];
  }

  async addBirthdayEvent(
    eventId: string,
    event: calendar_v3.Schema$Event,
  ): Promise<"created" | "exists"> {
    try {
      await this.client.events.insert({
        calendarId: calendarId(),
        sendUpdates: "none",
        requestBody: { ...event, id: eventId },
      });
      return "created";
    } catch (error) {
      if (errorStatus(error) !== 409) throw error;
    }
    // Google keeps a deleted event's id: bring a removed birthday back.
    const existing = await this.client.events.get({
      calendarId: calendarId(),
      eventId,
    });
    if (existing.data.status !== "cancelled") return "exists";
    await this.client.events.patch({
      calendarId: calendarId(),
      eventId,
      sendUpdates: "none",
      requestBody: { ...event, status: "confirmed" },
    });
    return "created";
  }
}

// Birthdays (see src/birthdays.ts): yearly events tagged in private
// extended properties, added under ids the bot chooses.
export interface BirthdayCalendar {
  listBirthdayEvents(): Promise<calendar_v3.Schema$Event[]>;
  addBirthdayEvent(
    eventId: string,
    event: calendar_v3.Schema$Event,
  ): Promise<"created" | "exists">;
  delete(eventId: string): Promise<"deleted" | "already-deleted">;
}

let gatewayPromise: Promise<GoogleCalendarGateway> | undefined;
// The calendar can be switched on the website, so access is remembered per
// calendar ID.
let accessCheckPromise: { id: string; promise: Promise<void> } | undefined;
let accessCheckedFor: string | undefined;

// The credentials the gateway was made with: a key saved on the website can
// replace Vercel's, so a different one means a new gateway.
let gatewayCredentials: string | undefined;

export async function getCalendarGateway(): Promise<GoogleCalendarGateway> {
  const config = getCalendarConfig();
  const credentials = [
    config.jsonCredentialsBase64 ?? "",
    config.credentialsFile ?? "",
    config.serviceAccountEmail ?? "",
  ].join("|");
  if (credentials !== gatewayCredentials) {
    gatewayPromise = undefined;
    gatewayCredentials = credentials;
  }
  if (gatewayPromise) return gatewayPromise;
  const promise = createCalendarAuthClient().then(
    // The Calendar client bundles its own google-auth-library types; both
    // clients implement the same runtime AuthClient contract but TypeScript
    // sees their private fields as distinct.
    (auth) =>
      new GoogleCalendarGateway(
        (
          calendar as unknown as (options: {
            version: "v3";
            auth: unknown;
          }) => calendar_v3.Calendar
        )({
          version: "v3",
          auth,
        }),
      ),
  );
  gatewayPromise = promise;
  // A failed attempt isn't kept: the next request tries again.
  promise.catch(() => {
    if (gatewayPromise === promise) gatewayPromise = undefined;
  });
  return promise;
}

export async function ensureCalendarReadable(): Promise<void> {
  const id = calendarId();
  if (accessCheckedFor === id) return;
  if (accessCheckPromise?.id !== id) {
    const promise = getCalendarGateway()
      .then((gateway) => gateway.checkReadable(id))
      .then(() => {
        accessCheckedFor = id;
      })
      .catch((error) => {
        if (accessCheckPromise?.promise === promise) {
          accessCheckPromise = undefined;
        }
        throw error;
      });
    accessCheckPromise = { id, promise };
  }
  return accessCheckPromise.promise;
}

export function calendarErrorMessage(error: unknown): string {
  // The assistant's MCP access explains itself (never with the token).
  if (
    error instanceof Error &&
    (error.name === "CalendarMcpError" || error.name === "AssistantCalendarOff")
  ) {
    return error.message;
  }
  const status = errorStatus(error);
  if (status === 401)
    return "Google Calendar authentication failed. Please check the bot's OIDC configuration.";
  if (status === 403)
    return "The bot does not have permission to change this Google Calendar.";
  if (status === 404)
    return "The configured Google Calendar was not found or has not been shared with the bot.";
  if (status === 429 || (status !== undefined && status >= 500)) {
    return "Google Calendar is temporarily unavailable. Please try again.";
  }
  return "I could not update Google Calendar. Please try again.";
}
