import { google, type calendar_v3 } from "googleapis";
import { createCalendarAuthClient } from "./auth.js";
import {
  FIXED_CALENDAR_ID,
  FIXED_TIME_ZONE,
  getCalendarConfig,
} from "./config.js";
import type { ParsedCalendarEvent } from "./parser.js";
import type {
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

export class GoogleCalendarGateway implements CalendarGateway {
  constructor(private readonly client: calendar_v3.Calendar) {}

  async checkReadable(): Promise<void> {
    await this.client.events.list({
      calendarId: FIXED_CALENDAR_ID,
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
        calendarId: FIXED_CALENDAR_ID,
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
        calendarId: FIXED_CALENDAR_ID,
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
        calendarId: FIXED_CALENDAR_ID,
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
      event.calendarId !== FIXED_CALENDAR_ID ||
      event.timeZone !== FIXED_TIME_ZONE
    ) {
      throw new Error(
        "Calendar event attempted to override the fixed calendar configuration",
      );
    }

    try {
      const response = await this.client.events.insert({
        calendarId: FIXED_CALENDAR_ID,
        sendUpdates: "none",
        requestBody: {
          id: eventId,
          summary: event.title,
          start: { dateTime: event.startDateTime, timeZone: FIXED_TIME_ZONE },
          end: { dateTime: event.endDateTime, timeZone: FIXED_TIME_ZONE },
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
      event.calendarId !== FIXED_CALENDAR_ID ||
      event.timeZone !== FIXED_TIME_ZONE
    ) {
      throw new Error(
        "Calendar event attempted to override the fixed calendar configuration",
      );
    }
    try {
      const response = await this.client.events.patch({
        calendarId: FIXED_CALENDAR_ID,
        eventId,
        sendUpdates: "none",
        requestBody: {
          summary: event.title,
          start: { dateTime: event.startDateTime, timeZone: FIXED_TIME_ZONE },
          end: { dateTime: event.endDateTime, timeZone: FIXED_TIME_ZONE },
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
        calendarId: FIXED_CALENDAR_ID,
        eventId,
        sendUpdates: "none",
      });
      return "deleted";
    } catch (error) {
      if (errorStatus(error) === 404) return "already-deleted";
      throw error;
    }
  }
}

let gatewayPromise: Promise<GoogleCalendarGateway> | undefined;
let accessCheckPromise: Promise<void> | undefined;
let accessChecked = false;

export async function getCalendarGateway(): Promise<GoogleCalendarGateway> {
  getCalendarConfig();
  gatewayPromise ??= createCalendarAuthClient().then(
    // googleapis bundles its own google-auth-library types; both clients implement
    // the same runtime AuthClient contract but TypeScript sees their private fields as distinct.
    (auth) =>
      new GoogleCalendarGateway(
        (
          google.calendar as unknown as (options: {
            version: "v3";
            auth: unknown;
          }) => calendar_v3.Calendar
        )({
          version: "v3",
          auth,
        }),
      ),
  );
  return gatewayPromise;
}

export async function ensureCalendarReadable(): Promise<void> {
  if (accessChecked) return;
  accessCheckPromise ??= getCalendarGateway()
    .then((gateway) => gateway.checkReadable())
    .then(() => {
      accessChecked = true;
    })
    .catch((error) => {
      accessCheckPromise = undefined;
      throw error;
    });
  return accessCheckPromise;
}

export function calendarErrorMessage(error: unknown): string {
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
