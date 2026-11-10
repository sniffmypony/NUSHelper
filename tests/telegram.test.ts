import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "../src/telegram.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_OWNER_ID;
});

describe("Telegram delivery options", () => {
  it("supports silent messages and inline keyboards", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456:test-token";
    process.env.TELEGRAM_OWNER_ID = "123456789";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage("Done", {
      silent: true,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "✅", callback_data: "morning:done:2026-10-14" }],
        ],
      },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      chat_id: "123456789",
      text: "Done",
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅", callback_data: "morning:done:2026-10-14" }],
        ],
      },
    });
  });
});
