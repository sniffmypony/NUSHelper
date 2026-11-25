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
    daysInRange: vi.fn().mockResolvedValue([]),
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

  it("asks only for the rest when Apple Pay has payments that day", async () => {
    const store = fakeStore({ claimPrompt: vi.fn().mockResolvedValue(true) });
    const send = vi.fn(async () => {});
    const applePay = vi.fn(async () => ({ count: 3, cents: 2340 }));
    await runExpenditureSchedule(
      store,
      send,
      "123",
      "123",
      new Date("2026-10-31T15:30:00Z"),
      applePay,
    );
    expect(applePay).toHaveBeenCalledWith("2026-10-31");
    expect(send).toHaveBeenCalledWith(
      "expenditure: Apple Pay today S$23.40 (3 payments). Anything else, like cash or online? Reply with the amounts, or tap That's all.",
      {
        chatId: "123",
        replyMarkup: {
          inline_keyboard: [
            [{ text: "That's all", callback_data: "exp:done:2026-10-31" }],
          ],
        },
      },
    );
  });

  it("keeps the plain prompt on days without Apple Pay", async () => {
    const store = fakeStore({ claimPrompt: vi.fn().mockResolvedValue(true) });
    const send = vi.fn(async () => {});
    await runExpenditureSchedule(
      store,
      send,
      "123",
      "123",
      new Date("2026-10-31T15:30:00Z"),
      async () => ({ count: 0, cents: 0 }),
    );
    expect(send).toHaveBeenCalledWith("expenditure:", { chatId: "123" });
  });

  it("says a day with no reply kept its Apple Pay total", async () => {
    const store = fakeStore({
      claimMissingNotice: vi.fn().mockResolvedValue(true),
      daysInRange: vi
        .fn()
        .mockResolvedValue([
          { spendDate: "2026-10-30", totalCents: 1840, status: "auto" },
        ]),
    });
    const send = vi.fn(async () => {});
    await runExpenditureSchedule(
      store,
      send,
      "123",
      "123",
      new Date("2026-10-31T15:30:00Z"),
    );
    expect(send).toHaveBeenCalledWith(
      "No reply for 30 October 2026; recorded S$18.40 from Apple Pay.",
      expect.objectContaining({ chatId: "123" }),
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

  it("runs the 7am step once per day, not every minute", async () => {
    const store = fakeStore();
    const run = (iso: string) =>
      runExpenditureSchedule(store, vi.fn(), "123", "123", new Date(iso));
    // 7:00am, 7:01am and 3pm on 2 Nov in Singapore.
    await run("2026-11-01T23:00:00Z");
    await run("2026-11-01T23:01:00Z");
    await run("2026-11-02T07:00:00Z");
    expect(store.autoZero).toHaveBeenCalledTimes(1);
    expect(store.queueReportsForDate).toHaveBeenCalledTimes(1);
    // Reports still go out every minute.
    expect(store.claimReports).toHaveBeenCalledTimes(3);

    // The next morning settles the next day.
    await run("2026-11-02T23:00:00Z");
    expect(store.autoZero).toHaveBeenCalledTimes(2);
    expect(store.autoZero).toHaveBeenLastCalledWith(
      "2026-11-02",
      "123",
      expect.any(Date),
    );
  });

  it("tries the 7am step again after a failure", async () => {
    const store = fakeStore({
      autoZero: vi
        .fn()
        .mockRejectedValueOnce(new Error("database busy"))
        .mockResolvedValue(true),
    });
    const run = () =>
      runExpenditureSchedule(
        store,
        vi.fn(),
        "123",
        "123",
        new Date("2026-11-01T23:00:00Z"),
      );
    await expect(run()).rejects.toThrow("database busy");
    await run();
    await run();
    expect(store.autoZero).toHaveBeenCalledTimes(2);
  });
});
