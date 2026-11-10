import type { ParsedCalendarEvent } from "./parser.js";

export type CalendarOperationKind = "create" | "update" | "delete";
export type PendingStatus =
  "pending" | "processing" | "completed" | "cancelled" | "expired" | "failed";
export type MappingStatus = "active" | "deleted";

export type PendingCalendarEvent = {
  operationId: string;
  kind: CalendarOperationKind;
  ownerId: string;
  chatId: string;
  messageId: number;
  sourceLine: number;
  title: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  googleEventId: string | null;
  targetMappingId: number | null;
  status: PendingStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type CalendarEventMapping = {
  id: number;
  ownerId: string;
  chatId: string;
  messageId: number;
  sourceLine: number;
  calendarId: string;
  googleEventId: string;
  googleHtmlLink: string | null;
  actionToken: string;
  title: string;
  startDateTime: string;
  endDateTime: string;
  status: MappingStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type NewPendingCalendarEvent = Omit<
  PendingCalendarEvent,
  "status" | "createdAt" | "updatedAt"
>;

export type StoredGoogleEvent = { id: string; htmlLink: string | null };

export type CalendarAgendaEvent =
  | {
      id: string;
      title: string;
      htmlLink: string | null;
      allDay: true;
      startDate: string;
      endDate: string;
    }
  | {
      id: string;
      title: string;
      htmlLink: string | null;
      allDay: false;
      startDateTime: string;
      endDateTime: string;
    };

export interface CalendarGateway {
  checkReadable(): Promise<void>;
  listRange(timeMin: string, timeMax: string): Promise<CalendarAgendaEvent[]>;
  get(eventId: string): Promise<StoredGoogleEvent | null>;
  create(
    eventId: string,
    event: ParsedCalendarEvent,
    operationId: string,
    chatId: string,
    messageId: number,
  ): Promise<StoredGoogleEvent>;
  update(
    eventId: string,
    event: ParsedCalendarEvent,
  ): Promise<StoredGoogleEvent | null>;
  delete(eventId: string): Promise<"deleted" | "already-deleted">;
}

export interface CalendarStore {
  invalidatePendingForSource(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
  ): Promise<void>;
  createPending(value: NewPendingCalendarEvent): Promise<PendingCalendarEvent>;
  getPending(
    operationId: string,
    ownerId: string,
  ): Promise<PendingCalendarEvent | null>;
  claimPending(
    operationId: string,
    ownerId: string,
    now: Date,
  ): Promise<PendingCalendarEvent | null>;
  releasePending(
    operationId: string,
    ownerId: string,
    now: Date,
  ): Promise<void>;
  completePending(operationId: string, ownerId: string): Promise<void>;
  cancelPending(
    operationId: string,
    ownerId: string,
    now: Date,
  ): Promise<PendingCalendarEvent | null>;
  findMappingBySource(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
  ): Promise<CalendarEventMapping | null>;
  findMappingById(
    id: number,
    ownerId: string,
  ): Promise<CalendarEventMapping | null>;
  findMappingByActionToken(
    actionToken: string,
    ownerId: string,
  ): Promise<CalendarEventMapping | null>;
  upsertMapping(
    value: Omit<CalendarEventMapping, "id" | "createdAt" | "updatedAt">,
  ): Promise<CalendarEventMapping>;
  markMappingDeleted(id: number, ownerId: string): Promise<void>;
}
