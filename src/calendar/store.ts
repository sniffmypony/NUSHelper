import { and, eq, gt, lt, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { calendarEventMappings, calendarPendingEvents } from "../db/schema.js";
import type {
  CalendarEventMapping,
  CalendarStore,
  NewPendingCalendarEvent,
  PendingCalendarEvent,
} from "./types.js";

function pendingRow(
  row: typeof calendarPendingEvents.$inferSelect,
): PendingCalendarEvent {
  return row as PendingCalendarEvent;
}

function mappingRow(
  row: typeof calendarEventMappings.$inferSelect,
): CalendarEventMapping {
  return row as CalendarEventMapping;
}

export class DrizzleCalendarStore implements CalendarStore {
  async invalidatePendingForSource(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
  ): Promise<void> {
    await db
      .update(calendarPendingEvents)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(calendarPendingEvents.ownerId, ownerId),
          eq(calendarPendingEvents.chatId, chatId),
          eq(calendarPendingEvents.messageId, messageId),
          eq(calendarPendingEvents.sourceLine, sourceLine),
          eq(calendarPendingEvents.status, "pending"),
        ),
      );
  }

  async createPending(
    value: NewPendingCalendarEvent,
  ): Promise<PendingCalendarEvent> {
    const [row] = await db
      .insert(calendarPendingEvents)
      .values({ ...value, status: "pending" })
      .returning();
    return pendingRow(row);
  }

  async getPending(
    operationId: string,
    ownerId: string,
  ): Promise<PendingCalendarEvent | null> {
    const [row] = await db
      .select()
      .from(calendarPendingEvents)
      .where(
        and(
          eq(calendarPendingEvents.operationId, operationId),
          eq(calendarPendingEvents.ownerId, ownerId),
        ),
      )
      .limit(1);
    return row ? pendingRow(row) : null;
  }

  async claimPending(
    operationId: string,
    ownerId: string,
    now: Date,
  ): Promise<PendingCalendarEvent | null> {
    const stale = new Date(now.getTime() - 2 * 60_000);
    const [row] = await db
      .update(calendarPendingEvents)
      .set({ status: "processing", updatedAt: now })
      .where(
        and(
          eq(calendarPendingEvents.operationId, operationId),
          eq(calendarPendingEvents.ownerId, ownerId),
          gt(calendarPendingEvents.expiresAt, now),
          or(
            eq(calendarPendingEvents.status, "pending"),
            and(
              eq(calendarPendingEvents.status, "processing"),
              lt(calendarPendingEvents.updatedAt, stale),
            ),
          ),
        ),
      )
      .returning();
    return row ? pendingRow(row) : null;
  }

  async releasePending(
    operationId: string,
    ownerId: string,
    now: Date,
  ): Promise<void> {
    await db
      .update(calendarPendingEvents)
      .set({ status: "pending", updatedAt: now })
      .where(
        and(
          eq(calendarPendingEvents.operationId, operationId),
          eq(calendarPendingEvents.ownerId, ownerId),
          eq(calendarPendingEvents.status, "processing"),
          gt(calendarPendingEvents.expiresAt, now),
        ),
      );
  }

  async completePending(operationId: string, ownerId: string): Promise<void> {
    await db
      .update(calendarPendingEvents)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        and(
          eq(calendarPendingEvents.operationId, operationId),
          eq(calendarPendingEvents.ownerId, ownerId),
        ),
      );
  }

  async cancelPending(
    operationId: string,
    ownerId: string,
    now: Date,
  ): Promise<PendingCalendarEvent | null> {
    const [row] = await db
      .update(calendarPendingEvents)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(calendarPendingEvents.operationId, operationId),
          eq(calendarPendingEvents.ownerId, ownerId),
          eq(calendarPendingEvents.status, "pending"),
        ),
      )
      .returning();
    return row ? pendingRow(row) : null;
  }

  async findMappingBySource(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
  ): Promise<CalendarEventMapping | null> {
    const [row] = await db
      .select()
      .from(calendarEventMappings)
      .where(
        and(
          eq(calendarEventMappings.ownerId, ownerId),
          eq(calendarEventMappings.chatId, chatId),
          eq(calendarEventMappings.messageId, messageId),
          eq(calendarEventMappings.sourceLine, sourceLine),
        ),
      )
      .limit(1);
    return row ? mappingRow(row) : null;
  }

  async findMappingById(
    id: number,
    ownerId: string,
  ): Promise<CalendarEventMapping | null> {
    const [row] = await db
      .select()
      .from(calendarEventMappings)
      .where(
        and(
          eq(calendarEventMappings.id, id),
          eq(calendarEventMappings.ownerId, ownerId),
        ),
      )
      .limit(1);
    return row ? mappingRow(row) : null;
  }

  async findActiveMappingByGoogleEventId(
    googleEventId: string,
    ownerId: string,
  ): Promise<CalendarEventMapping | null> {
    const [row] = await db
      .select()
      .from(calendarEventMappings)
      .where(
        and(
          eq(calendarEventMappings.googleEventId, googleEventId),
          eq(calendarEventMappings.ownerId, ownerId),
          eq(calendarEventMappings.status, "active"),
        ),
      )
      .limit(1);
    return row ? mappingRow(row) : null;
  }

  async findMappingByActionToken(
    actionToken: string,
    ownerId: string,
  ): Promise<CalendarEventMapping | null> {
    const [row] = await db
      .select()
      .from(calendarEventMappings)
      .where(
        and(
          eq(calendarEventMappings.actionToken, actionToken),
          eq(calendarEventMappings.ownerId, ownerId),
        ),
      )
      .limit(1);
    return row ? mappingRow(row) : null;
  }

  async upsertMapping(
    value: Omit<CalendarEventMapping, "id" | "createdAt" | "updatedAt">,
  ): Promise<CalendarEventMapping> {
    const [row] = await db
      .insert(calendarEventMappings)
      .values(value)
      .onConflictDoUpdate({
        target: [
          calendarEventMappings.ownerId,
          calendarEventMappings.chatId,
          calendarEventMappings.messageId,
          calendarEventMappings.sourceLine,
        ],
        set: {
          calendarId: value.calendarId,
          googleEventId: value.googleEventId,
          googleHtmlLink: value.googleHtmlLink,
          actionToken: value.actionToken,
          title: value.title,
          startDateTime: value.startDateTime,
          endDateTime: value.endDateTime,
          status: value.status,
          updatedAt: new Date(),
        },
      })
      .returning();
    return mappingRow(row);
  }

  async markMappingDeleted(id: number, ownerId: string): Promise<void> {
    await db
      .update(calendarEventMappings)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(
        and(
          eq(calendarEventMappings.id, id),
          eq(calendarEventMappings.ownerId, ownerId),
        ),
      );
  }
}

export const calendarStore = new DrizzleCalendarStore();
