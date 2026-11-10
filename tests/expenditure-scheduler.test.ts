import { describe, expect, it, vi } from "vitest";
import { runExpenditureSchedule } from "../src/expenditure-service.js";
import type { ExpenditureStore } from "../src/expenditure-store.js";

function fakeStore(overrides: Record<string, unknown> = {}): ExpenditureStore {
  return {
    autoZero: vi.fn().mockResolvedValue(false),
    queueReportsForDate: vi.fn().mockResolvedValue(undefined),
    claimReminder: vi.fn().mockResolvedValue(false),
    releaseReminder: vi.fn().mockResolvedValue(undefined),
    claimMissingNotice: vi.fn().mockResolvedValue(false),
    releaseMissingNotice: vi.fn().mockResolvedValue(undefined),
    claimPrompt: vi.fn().mockResolvedValue(false),
    releasePrompt: vi.fn().mockResolvedValue(undefined),
    claimReports: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ExpenditureStore;
}

describe("expenditure schedule", () => {
  it("sends the 11:30pm prompt after the deferred missing notice", async () => {
    const order: string[] = [];
    const store = fakeStore({
      claimMissingNotice: vi.fn().mockResolvedValue(true),
      claimPrompt: vi.fn().mockResolvedValue(true),
    });
    const send = vi.fn(async (text: string) => {
      order.push(text);
    });
    const result = await runExpenditureSchedule(
      store,
      send,
      "123",
      "123",
      new Date("2026-10-31T15:30:00Z"),
    );
    expect(order).toEqual([
      "No expenditure was logged for 30 October 2026; recorded S$0.00.",
      "expenditure:",
    ]);
    expect(result.prompt).toBe(true);
    expect(store.claimPrompt).toHaveBeenCalledWith(
      "2026-10-31",
      "123",
      "123",
      expect.any(Date),
      new Date("2026-10-31T23:00:00.000Z"),
    );
  });

  it("repeats the previous day's prompt at 1am", async () => {
    const store = fakeStore({ claimReminder: vi.fn().mockResolvedValue(true) });
    const send = vi.fn().mockResolvedValue(undefined);
    await runExpenditureSchedule(
      store,
      send,
      "123",
      "123",
      new Date("2026-10-31T17:00:00Z"),
    );
    expect(store.claimReminder).toHaveBeenCalledWith(
      "2026-10-31",
      "123",
      "123",
      expect.any(Date),
      new Date("2026-10-31T23:00:00.000Z"),
    );
    expect(send).toHaveBeenCalledWith("expenditure:", { chatId: "123" });
  });

  it("auto-zeroes at 7am and queues Sunday reports", async () => {
    const store = fakeStore({ autoZero: vi.fn().mockResolvedValue(true) });
    await runExpenditureSchedule(
      store,
      vi.fn(),
      "123",
      "123",
      new Date("2026-11-01T23:00:00Z"),
    );
    expect(store.autoZero).toHaveBeenCalledWith(
      "2026-11-01",
      "123",
      expect.any(Date),
    );
    expect(store.queueReportsForDate).toHaveBeenCalledWith(
      "2026-11-01",
      expect.any(Date),
    );
  });
});
