import { describe, expect, it, vi } from "vitest";
import type { CalendarAgendaEvent } from "../src/calendar/types.js";
import {
  planLinkedReminder,
  syncLinkedReminders,
  type LinkedReminder,
  type LinkedReminderStore,
} from "../src/linked-reminders.js";

// Tue 24 Nov 2026, 10:00 in Singapore.
const NOW = new Date("2026-11-24T02:00:00Z");

function timed(start: string, title = "CS2040S Lab"): CalendarAgendaEvent {
  return {
    id: "evt1",
    title,
    htmlLink: null,
    allDay: false,
    startDateTime: start,
    endDateTime: start.replace(/T(\d\d)/, (_, h) => `T${Number(h) + 1}`),
  };
}

function allDay(date: string): CalendarAgendaEvent {
  return {
    id: "evt2",
    title: "Mum's birthday",
    htmlLink: null,
    allDay: true,
    startDate: date,
    endDate: date,
  };
}

const sgt = (date: Date) =>
  date.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false });

describe("planning a linked reminder", () => {
  it("fires the chosen time before a timed event", () => {
    const plan = planLinkedReminder(
      timed("2026-11-24T14:00:00+08:00"),
      30,
      NOW,
    );
    expect(plan).toMatchObject({ kind: "send" });
    if (plan.kind !== "send") return;
    expect(sgt(plan.scheduledAt)).toBe("24/11/2026, 13:30:00");
    expect(plan.description).toBe("CS2040S Lab at 14:00");
    expect(sgt(plan.expiresAt)).toBe("25/11/2026, 00:00:00");
  });

  it("says the day when it fires the day before", () => {
    const plan = planLinkedReminder(
      timed("2026-11-25T14:00:00+08:00"),
      1440,
      NOW,
    );
    expect(plan.kind === "send" && plan.description).toBe(
      "CS2040S Lab at 14:00, tomorrow",
    );
  });

  it("says 'starts now' for a reminder at the start", () => {
    const plan = planLinkedReminder(timed("2026-11-24T14:00:00+08:00"), 0, NOW);
    expect(plan.kind === "send" && plan.description).toBe(
      "CS2040S Lab starts now",
    );
  });

  it("uses 9am for all-day events", () => {
    const onDay = planLinkedReminder(allDay("2026-11-26"), 0, NOW);
    const before = planLinkedReminder(allDay("2026-11-26"), 1440, NOW);
    expect(onDay.kind === "send" && sgt(onDay.scheduledAt)).toBe(
      "26/11/2026, 09:00:00",
    );
    expect(onDay.kind === "send" && onDay.description).toBe(
      "Today: Mum's birthday",
    );
    expect(before.kind === "send" && sgt(before.scheduledAt)).toBe(
      "25/11/2026, 09:00:00",
    );
    expect(before.kind === "send" && before.description).toBe(
      "Tomorrow: Mum's birthday",
    );
  });

  it("reminds right away when the event moved closer than the offset", () => {
    const plan = planLinkedReminder(
      timed("2026-11-24T10:20:00+08:00"),
      60,
      NOW,
    );
    expect(plan.kind === "send" && plan.scheduledAt).toEqual(NOW);
  });

  it("is over once the event has started", () => {
    expect(
      planLinkedReminder(timed("2026-11-24T09:00:00+08:00"), 10, NOW),
    ).toEqual({ kind: "over" });
    expect(planLinkedReminder(allDay("2026-11-24"), 0, NOW)).toEqual({
      kind: "over",
    });
  });
});

function memoryStore(rows: LinkedReminder[]) {
  const store = {
    dueForCheck: vi.fn(async () => rows),
    update: vi.fn(async () => {}),
    markChecked: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  } satisfies LinkedReminderStore;
  return store;
}

const linked = (overrides: Partial<LinkedReminder> = {}): LinkedReminder => ({
  id: 7,
  eventId: "evt1",
  eventOffsetMin: 30,
  description: "CS2040S Lab at 14:00",
  scheduledAt: new Date("2026-11-24T05:30:00Z"), // 13:30 SGT
  ...overrides,
});

describe("syncing linked reminders", () => {
  it("leaves an unchanged reminder alone, apart from noting the check", async () => {
    const store = memoryStore([linked()]);
    const result = await syncLinkedReminders(
      store,
      async () => timed("2026-11-24T14:00:00+08:00"),
      NOW,
    );
    expect(result).toEqual({ checked: 1, moved: 0, cancelled: 0 });
    expect(store.markChecked).toHaveBeenCalledWith(7, NOW);
    expect(store.update).not.toHaveBeenCalled();
  });

  it("moves the reminder when the event moved", async () => {
    const store = memoryStore([linked()]);
    const result = await syncLinkedReminders(
      store,
      async () => timed("2026-11-24T16:00:00+08:00", "CS2040S Lab (moved)"),
      NOW,
    );
    expect(result.moved).toBe(1);
    expect(store.update).toHaveBeenCalledWith(7, {
      scheduledAt: new Date("2026-11-24T07:30:00Z"),
      expiresAt: new Date("2026-11-24T16:00:00Z"),
      description: "CS2040S Lab (moved) at 16:00",
      checkedAt: NOW,
    });
  });

  it("cancels the reminder when the event was deleted", async () => {
    const store = memoryStore([linked()]);
    const result = await syncLinkedReminders(store, async () => null, NOW);
    expect(result.cancelled).toBe(1);
    expect(store.cancel).toHaveBeenCalledWith(7);
  });

  it("doesn't reschedule a reminder that is already due", async () => {
    const due = linked({
      eventOffsetMin: 60,
      description: "CS2040S Lab at 10:30",
      scheduledAt: new Date("2026-11-24T01:30:00Z"), // 09:30, a minute late
    });
    const store = memoryStore([due]);
    await syncLinkedReminders(
      store,
      async () => timed("2026-11-24T10:30:00+08:00"),
      NOW,
    );
    expect(store.update).not.toHaveBeenCalled();
    expect(store.markChecked).toHaveBeenCalledWith(7, NOW);
  });

  it("stops and changes nothing when Calendar can't be reached", async () => {
    const store = memoryStore([linked(), linked({ id: 8 })]);
    const lookup = vi.fn(async () => {
      throw new Error("401");
    });
    const result = await syncLinkedReminders(store, lookup, NOW);
    expect(result).toEqual({
      checked: 0,
      moved: 0,
      cancelled: 0,
      error: "calendar unavailable",
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(store.cancel).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });

  it("checks one reminder at a time", async () => {
    const store = memoryStore([linked(), linked({ id: 8 })]);
    let inFlight = 0;
    let most = 0;
    const lookup = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return timed("2026-11-24T14:00:00+08:00");
    };
    await syncLinkedReminders(store, lookup, NOW);
    expect(most).toBe(1);
    expect(store.markChecked).toHaveBeenCalledTimes(2);
  });
});
