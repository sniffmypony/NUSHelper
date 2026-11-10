import { describe, expect, it, vi } from "vitest";
import { dispatchDueReminders } from "../src/reminder-dispatcher.js";
import type { Reminder, ReminderStore } from "../src/reminder-store.js";
import { scheduleReminderToday } from "../src/reminders.js";
import { TelegramDeliveryError } from "../src/telegram.js";

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    ownerId: "123",
    chatId: "123",
    sourceMessageId: 10,
    sourceLine: 0,
    description: "do tutorial",
    scheduledAt: new Date("2026-10-14T10:00:00Z"),
    expiresAt: new Date("2026-10-14T16:00:00Z"),
    status: "processing",
    attempts: 1,
    claimedAt: new Date("2026-10-14T10:00:00Z"),
    sentAt: null,
    createdAt: new Date("2026-10-14T09:00:00Z"),
    updatedAt: new Date("2026-10-14T10:00:00Z"),
    ...overrides,
  };
}

function storeWith(rows: Reminder[]): ReminderStore {
  return {
    create: vi.fn(),
    claimDue: vi.fn().mockResolvedValue(rows),
    markSent: vi.fn(),
    markFailed: vi.fn(),
  };
}

describe("same-day reminders", () => {
  it("schedules in Singapore time and expires at the next midnight", () => {
    const value = scheduleReminderToday(
      { hour: 18, minute: 0, description: "do tutorial" },
      new Date("2026-10-14T09:30:00Z"),
    );
    expect(value).toEqual({
      scheduledAt: new Date("2026-10-14T10:00:00Z"),
      expiresAt: new Date("2026-10-14T16:00:00Z"),
      displayTime: "18:00",
    });
  });

  it("rejects a time that has already passed", () => {
    expect(
      scheduleReminderToday(
        { hour: 17, minute: 0, description: "too late" },
        new Date("2026-10-14T09:30:00Z"),
      ),
    ).toBeNull();
  });

  it("marks successful deliveries sent", async () => {
    const store = storeWith([reminder()]);
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(
      dispatchDueReminders(store, send, new Date("2026-10-14T10:00:10Z")),
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledWith("do tutorial", "123");
    expect(store.markSent).toHaveBeenCalledWith(
      1,
      new Date("2026-10-14T10:00:10Z"),
    );
  });

  it("retries temporary failures only before expiry and attempt limit", async () => {
    const store = storeWith([
      reminder({ id: 1, attempts: 2 }),
      reminder({ id: 2, attempts: 5 }),
    ]);
    const send = vi.fn().mockRejectedValue(new Error("temporary"));
    await dispatchDueReminders(store, send, new Date("2026-10-14T10:00:10Z"));
    expect(store.markFailed).toHaveBeenNthCalledWith(
      1,
      1,
      expect.any(Date),
      true,
    );
    expect(store.markFailed).toHaveBeenNthCalledWith(
      2,
      2,
      expect.any(Date),
      false,
    );
  });

  it("does not retry permanent Telegram request errors", async () => {
    const store = storeWith([reminder()]);
    const send = vi
      .fn()
      .mockRejectedValue(new TelegramDeliveryError("bad request", 400));
    await dispatchDueReminders(store, send, new Date("2026-10-14T10:00:10Z"));
    expect(store.markFailed).toHaveBeenCalledWith(1, expect.any(Date), false);
  });
});
