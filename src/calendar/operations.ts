import { createHash, randomUUID } from "node:crypto";
import { FIXED_CALENDAR_ID, FIXED_TIME_ZONE } from "./config.js";
import type { ParsedCalendarEvent } from "./parser.js";
import type {
  CalendarEventMapping,
  CalendarGateway,
  CalendarStore,
  PendingCalendarEvent,
} from "./types.js";

const PENDING_TTL_MS = 15 * 60_000;

export type ConfirmResult =
  | {
      status: "created" | "updated" | "already-completed";
      mapping: CalendarEventMapping;
    }
  | { status: "deleted" | "already-deleted" }
  | { status: "expired" | "processing" | "invalid" };

function deterministicEventId(
  ownerId: string,
  chatId: string,
  messageId: number,
  sourceLine: number,
  operationId: string,
): string {
  const hash = createHash("sha256")
    .update(`${ownerId}:${chatId}:${messageId}:${sourceLine}:${operationId}`)
    .digest("hex");
  return `tg${hash.slice(0, 40)}`;
}

function pendingEvent(row: PendingCalendarEvent): ParsedCalendarEvent | null {
  if (!row.title || !row.startDateTime || !row.endDateTime) return null;
  return {
    title: row.title,
    startDateTime: row.startDateTime,
    endDateTime: row.endDateTime,
    timeZone: FIXED_TIME_ZONE,
    calendarId: FIXED_CALENDAR_ID,
    isPast: new Date(row.startDateTime).getTime() < Date.now(),
  };
}

export class CalendarOperations {
  constructor(
    private readonly store: CalendarStore,
    private readonly gateway: CalendarGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async stageEvent(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
    event: ParsedCalendarEvent,
    existingMapping: CalendarEventMapping | null,
  ): Promise<PendingCalendarEvent> {
    const operationId = randomUUID();
    await this.store.invalidatePendingForSource(
      ownerId,
      chatId,
      messageId,
      sourceLine,
    );
    return this.store.createPending({
      operationId,
      kind: existingMapping?.status === "active" ? "update" : "create",
      ownerId,
      chatId,
      messageId,
      sourceLine,
      title: event.title,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      googleEventId:
        existingMapping?.googleEventId ??
        deterministicEventId(
          ownerId,
          chatId,
          messageId,
          sourceLine,
          operationId,
        ),
      targetMappingId:
        existingMapping?.status === "active" ? existingMapping.id : null,
      expiresAt: new Date(this.now().getTime() + PENDING_TTL_MS),
    });
  }

  async stageDelete(
    ownerId: string,
    actionToken: string,
  ): Promise<PendingCalendarEvent | null> {
    const mapping = await this.store.findMappingByActionToken(
      actionToken,
      ownerId,
    );
    if (!mapping || mapping.status !== "active") return null;
    return this.store.createPending({
      operationId: randomUUID(),
      kind: "delete",
      ownerId,
      chatId: mapping.chatId,
      messageId: mapping.messageId,
      sourceLine: mapping.sourceLine,
      title: mapping.title,
      startDateTime: mapping.startDateTime,
      endDateTime: mapping.endDateTime,
      googleEventId: mapping.googleEventId,
      targetMappingId: mapping.id,
      expiresAt: new Date(this.now().getTime() + PENDING_TTL_MS),
    });
  }

  async cancel(
    operationId: string,
    ownerId: string,
  ): Promise<"cancelled" | "expired" | "invalid"> {
    const now = this.now();
    const row = await this.store.cancelPending(operationId, ownerId, now);
    if (row) return "cancelled";
    const existing = await this.store.getPending(operationId, ownerId);
    if (existing && existing.expiresAt <= now) return "expired";
    return "invalid";
  }

  private async unavailableResult(
    operationId: string,
    ownerId: string,
  ): Promise<ConfirmResult> {
    const row = await this.store.getPending(operationId, ownerId);
    if (!row) return { status: "invalid" };
    if (row.expiresAt <= this.now()) return { status: "expired" };
    if (row.status === "processing") return { status: "processing" };
    if (row.status === "completed") {
      const mapping = row.targetMappingId
        ? await this.store.findMappingById(row.targetMappingId, ownerId)
        : await this.store.findMappingBySource(
            ownerId,
            row.chatId,
            row.messageId,
            row.sourceLine,
          );
      if (mapping?.status === "active")
        return { status: "already-completed", mapping };
      return { status: "already-deleted" };
    }
    return { status: "invalid" };
  }

  async confirmCreate(
    operationId: string,
    ownerId: string,
  ): Promise<ConfirmResult> {
    const now = this.now();
    const pending = await this.store.claimPending(operationId, ownerId, now);
    if (!pending) return this.unavailableResult(operationId, ownerId);
    if (pending.kind !== "create" || !pending.googleEventId) {
      await this.store.releasePending(operationId, ownerId, now);
      return { status: "invalid" };
    }

    try {
      const existingMapping = await this.store.findMappingBySource(
        ownerId,
        pending.chatId,
        pending.messageId,
        pending.sourceLine,
      );
      if (existingMapping?.status === "active") {
        await this.store.completePending(operationId, ownerId);
        return { status: "already-completed", mapping: existingMapping };
      }

      const event = pendingEvent(pending);
      if (!event) {
        await this.store.completePending(operationId, ownerId);
        return { status: "invalid" };
      }
      const googleEvent =
        (await this.gateway.get(pending.googleEventId)) ??
        (await this.gateway.create(
          pending.googleEventId,
          event,
          pending.operationId,
          pending.chatId,
          pending.messageId,
        ));
      const mapping = await this.store.upsertMapping({
        ownerId,
        chatId: pending.chatId,
        messageId: pending.messageId,
        sourceLine: pending.sourceLine,
        calendarId: FIXED_CALENDAR_ID,
        googleEventId: googleEvent.id,
        googleHtmlLink: googleEvent.htmlLink,
        actionToken: randomUUID(),
        title: event.title,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        status: "active",
      });
      await this.store.completePending(operationId, ownerId);
      return { status: "created", mapping };
    } catch (error) {
      await this.store.releasePending(operationId, ownerId, this.now());
      throw error;
    }
  }

  async confirmUpdate(
    operationId: string,
    ownerId: string,
  ): Promise<ConfirmResult> {
    const now = this.now();
    const pending = await this.store.claimPending(operationId, ownerId, now);
    if (!pending) return this.unavailableResult(operationId, ownerId);
    if (pending.kind !== "update" || !pending.targetMappingId) {
      await this.store.releasePending(operationId, ownerId, now);
      return { status: "invalid" };
    }

    try {
      const mapping = await this.store.findMappingById(
        pending.targetMappingId,
        ownerId,
      );
      const event = pendingEvent(pending);
      if (!mapping || mapping.status !== "active" || !event) {
        await this.store.completePending(operationId, ownerId);
        return { status: "invalid" };
      }

      const googleEvent = await this.gateway.update(
        mapping.googleEventId,
        event,
      );
      if (!googleEvent) {
        await this.store.markMappingDeleted(mapping.id, ownerId);
        await this.store.completePending(operationId, ownerId);
        return { status: "already-deleted" };
      }
      const updated = await this.store.upsertMapping({
        ownerId: mapping.ownerId,
        chatId: mapping.chatId,
        messageId: mapping.messageId,
        sourceLine: mapping.sourceLine,
        calendarId: mapping.calendarId,
        googleEventId: mapping.googleEventId,
        googleHtmlLink: googleEvent.htmlLink,
        actionToken: mapping.actionToken,
        title: event.title,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        status: "active",
      });
      await this.store.completePending(operationId, ownerId);
      return { status: "updated", mapping: updated };
    } catch (error) {
      await this.store.releasePending(operationId, ownerId, this.now());
      throw error;
    }
  }

  async confirmDelete(
    operationId: string,
    ownerId: string,
  ): Promise<ConfirmResult> {
    const now = this.now();
    const pending = await this.store.claimPending(operationId, ownerId, now);
    if (!pending) return this.unavailableResult(operationId, ownerId);
    if (pending.kind !== "delete" || !pending.targetMappingId) {
      await this.store.releasePending(operationId, ownerId, now);
      return { status: "invalid" };
    }

    try {
      const mapping = await this.store.findMappingById(
        pending.targetMappingId,
        ownerId,
      );
      if (!mapping || mapping.status === "deleted") {
        await this.store.completePending(operationId, ownerId);
        return { status: "already-deleted" };
      }
      const result = await this.gateway.delete(mapping.googleEventId);
      await this.store.markMappingDeleted(mapping.id, ownerId);
      await this.store.completePending(operationId, ownerId);
      return { status: result === "deleted" ? "deleted" : "already-deleted" };
    } catch (error) {
      await this.store.releasePending(operationId, ownerId, this.now());
      throw error;
    }
  }
}
