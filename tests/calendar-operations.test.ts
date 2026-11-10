import { describe, expect, it } from "vitest";
import { FIXED_CALENDAR_ID, FIXED_TIME_ZONE } from "../src/calendar/config.js";
import { CalendarOperations } from "../src/calendar/operations.js";
import type { ParsedCalendarEvent } from "../src/calendar/parser.js";
import type {
  CalendarEventMapping,
  CalendarGateway,
  CalendarStore,
  NewPendingCalendarEvent,
  PendingCalendarEvent,
  StoredGoogleEvent,
} from "../src/calendar/types.js";

const OWNER = "123";
const NOW = new Date("2026-08-01T00:00:00Z");

function draft(title = "Homework"): ParsedCalendarEvent {
  return {
    title,
    startDateTime: "2026-08-22T12:00:00+08:00",
    endDateTime: "2026-08-22T18:00:00+08:00",
    calendarId: FIXED_CALENDAR_ID,
    timeZone: FIXED_TIME_ZONE,
    isPast: false,
  };
}

class MemoryStore implements CalendarStore {
  pending = new Map<string, PendingCalendarEvent>();
  mappings = new Map<number, CalendarEventMapping>();
  nextId = 1;

  async invalidatePendingForSource(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
  ) {
    for (const row of this.pending.values()) {
      if (
        row.ownerId === ownerId &&
        row.chatId === chatId &&
        row.messageId === messageId &&
        row.sourceLine === sourceLine &&
        row.status === "pending"
      ) {
        row.status = "cancelled";
      }
    }
  }
  async createPending(value: NewPendingCalendarEvent) {
    const row: PendingCalendarEvent = {
      ...value,
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.pending.set(row.operationId, row);
    return row;
  }
  async getPending(operationId: string, ownerId: string) {
    const row = this.pending.get(operationId);
    return row?.ownerId === ownerId ? row : null;
  }
  async claimPending(operationId: string, ownerId: string, now: Date) {
    const row = await this.getPending(operationId, ownerId);
    if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
    row.status = "processing";
    row.updatedAt = now;
    return row;
  }
  async releasePending(operationId: string, ownerId: string, now: Date) {
    const row = await this.getPending(operationId, ownerId);
    if (row?.status === "processing" && row.expiresAt > now)
      row.status = "pending";
  }
  async completePending(operationId: string, ownerId: string) {
    const row = await this.getPending(operationId, ownerId);
    if (row) row.status = "completed";
  }
  async cancelPending(operationId: string, ownerId: string, now: Date) {
    const row = await this.getPending(operationId, ownerId);
    if (!row || row.status !== "pending") return null;
    row.status = "cancelled";
    row.updatedAt = now;
    return row;
  }
  async findMappingBySource(
    ownerId: string,
    chatId: string,
    messageId: number,
    sourceLine: number,
  ) {
    return (
      [...this.mappings.values()].find(
        (row) =>
          row.ownerId === ownerId &&
          row.chatId === chatId &&
          row.messageId === messageId &&
          row.sourceLine === sourceLine,
      ) ?? null
    );
  }
  async findMappingById(id: number, ownerId: string) {
    const row = this.mappings.get(id);
    return row?.ownerId === ownerId ? row : null;
  }
  async findMappingByActionToken(actionToken: string, ownerId: string) {
    return (
      [...this.mappings.values()].find(
        (row) => row.ownerId === ownerId && row.actionToken === actionToken,
      ) ?? null
    );
  }
  async upsertMapping(
    value: Omit<CalendarEventMapping, "id" | "createdAt" | "updatedAt">,
  ) {
    const existing = await this.findMappingBySource(
      value.ownerId,
      value.chatId,
      value.messageId,
      value.sourceLine,
    );
    const row: CalendarEventMapping = {
      ...value,
      id: existing?.id ?? this.nextId++,
      createdAt: existing?.createdAt ?? NOW,
      updatedAt: NOW,
    };
    this.mappings.set(row.id, row);
    return row;
  }
  async markMappingDeleted(id: number, ownerId: string) {
    const row = await this.findMappingById(id, ownerId);
    if (row) row.status = "deleted";
  }
}

class MemoryGateway implements CalendarGateway {
  events = new Map<string, StoredGoogleEvent>();
  createCount = 0;
  updateCount = 0;
  deleteCount = 0;
  async checkReadable() {}
  async listRange() {
    return [];
  }
  async get(eventId: string) {
    return this.events.get(eventId) ?? null;
  }
  async create(eventId: string) {
    this.createCount += 1;
    const value = {
      id: eventId,
      htmlLink: "https://calendar.google.com/event",
    };
    this.events.set(eventId, value);
    return value;
  }
  async update(eventId: string) {
    this.updateCount += 1;
    return this.events.get(eventId) ?? null;
  }
  async delete(eventId: string) {
    this.deleteCount += 1;
    return this.events.delete(eventId)
      ? ("deleted" as const)
      : ("already-deleted" as const);
  }
}

function setup() {
  const store = new MemoryStore();
  const gateway = new MemoryGateway();
  const operations = new CalendarOperations(
    store,
    gateway,
    () => new Date(NOW),
  );
  return { store, gateway, operations };
}

describe("calendar confirmation operations", () => {
  it("does not call Google before explicit confirmation", async () => {
    const subject = setup();
    await subject.operations.stageEvent(OWNER, "123", 10, 0, draft(), null);
    expect(subject.gateway.createCount).toBe(0);
  });

  it("creates exactly one event after confirmation", async () => {
    const subject = setup();
    const pending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    expect(
      (await subject.operations.confirmCreate(pending.operationId, OWNER))
        .status,
    ).toBe("created");
    expect(subject.gateway.createCount).toBe(1);
  });

  it("double-clicking Create event cannot create a duplicate", async () => {
    const subject = setup();
    const pending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    const [first, second] = await Promise.all([
      subject.operations.confirmCreate(pending.operationId, OWNER),
      subject.operations.confirmCreate(pending.operationId, OWNER),
    ]);
    expect([first.status, second.status]).toContain("created");
    expect(subject.gateway.createCount).toBe(1);
  });

  it("a repeated Telegram callback returns the stored event", async () => {
    const subject = setup();
    const pending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    await subject.operations.confirmCreate(pending.operationId, OWNER);
    expect(
      (await subject.operations.confirmCreate(pending.operationId, OWNER))
        .status,
    ).toBe("already-completed");
    expect(subject.gateway.createCount).toBe(1);
  });

  it("creates independent events for separate lines in one Telegram message", async () => {
    const subject = setup();
    const first = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft("First line"),
      null,
    );
    const second = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      2,
      draft("Third line"),
      null,
    );

    expect(
      (await subject.operations.confirmCreate(first.operationId, OWNER)).status,
    ).toBe("created");
    expect(
      (await subject.operations.confirmCreate(second.operationId, OWNER))
        .status,
    ).toBe("created");
    expect(subject.gateway.createCount).toBe(2);
    expect(
      (await subject.store.findMappingBySource(OWNER, "123", 10, 0))?.title,
    ).toBe("First line");
    expect(
      (await subject.store.findMappingBySource(OWNER, "123", 10, 2))?.title,
    ).toBe("Third line");
  });

  it("an edited source message patches the existing event", async () => {
    const subject = setup();
    const createPending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    const created = await subject.operations.confirmCreate(
      createPending.operationId,
      OWNER,
    );
    if (!("mapping" in created)) throw new Error("Expected mapping");
    const updatePending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft("Updated"),
      created.mapping,
    );
    expect(
      (await subject.operations.confirmUpdate(updatePending.operationId, OWNER))
        .status,
    ).toBe("updated");
    expect(subject.gateway.createCount).toBe(1);
    expect(subject.gateway.updateCount).toBe(1);
  });

  it("deletes the mapped event and updates local state", async () => {
    const subject = setup();
    const createPending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    const created = await subject.operations.confirmCreate(
      createPending.operationId,
      OWNER,
    );
    if (!("mapping" in created)) throw new Error("Expected mapping");
    const deletion = await subject.operations.stageDelete(
      OWNER,
      created.mapping.actionToken,
    );
    if (!deletion) throw new Error("Expected deletion confirmation");
    expect(
      (await subject.operations.confirmDelete(deletion.operationId, OWNER))
        .status,
    ).toBe("deleted");
    expect(
      (await subject.store.findMappingById(created.mapping.id, OWNER))?.status,
    ).toBe("deleted");
  });

  it("treats repeated deletion safely", async () => {
    const subject = setup();
    const createPending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    const created = await subject.operations.confirmCreate(
      createPending.operationId,
      OWNER,
    );
    if (!("mapping" in created)) throw new Error("Expected mapping");
    const deletion = await subject.operations.stageDelete(
      OWNER,
      created.mapping.actionToken,
    );
    if (!deletion) throw new Error("Expected deletion confirmation");
    await subject.operations.confirmDelete(deletion.operationId, OWNER);
    expect(
      (await subject.operations.confirmDelete(deletion.operationId, OWNER))
        .status,
    ).toBe("already-deleted");
    expect(subject.gateway.deleteCount).toBe(1);
  });

  it("rejects another Telegram owner and expired confirmations", async () => {
    const subject = setup();
    const pending = await subject.operations.stageEvent(
      OWNER,
      "123",
      10,
      0,
      draft(),
      null,
    );
    expect(
      (await subject.operations.confirmCreate(pending.operationId, "999"))
        .status,
    ).toBe("invalid");
    pending.expiresAt = new Date(NOW.getTime() - 1);
    expect(
      (await subject.operations.confirmCreate(pending.operationId, OWNER))
        .status,
    ).toBe("expired");
    expect(subject.gateway.createCount).toBe(0);
  });
});
