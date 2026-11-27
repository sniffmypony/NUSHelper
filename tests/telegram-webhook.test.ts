import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_UPDATES,
  registerWebhook,
  webhookStatus,
  webhookUrlFor,
} from "../src/telegram-webhook.js";

// A stand-in for Telegram's Bot API: records each call, answers `reply`.
function fakeTelegram(reply: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(reply), { status }),
  );
}

describe("the Telegram webhook", () => {
  it("is the site's /api/webhook", () => {
    expect(webhookUrlFor("https://site.example/")).toBe(
      "https://site.example/api/webhook",
    );
  });

  it("registers with the secret and only the updates the bot handles", async () => {
    const telegram = fakeTelegram({ ok: true, result: true });
    await registerWebhook(
      "123:token",
      "https://site.example/api/webhook",
      "secret-hex",
      telegram,
    );
    const [url, init] = telegram.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:token/setWebhook");
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://site.example/api/webhook",
      secret_token: "secret-hex",
      allowed_updates: ALLOWED_UPDATES,
    });
  });

  it("refuses anything but an https /api/webhook address", async () => {
    const telegram = fakeTelegram({ ok: true });
    await expect(
      registerWebhook("t", "http://site.example/api/webhook", "s", telegram),
    ).rejects.toThrow("https://<your site>/api/webhook");
    expect(telegram).not.toHaveBeenCalled();
  });

  it("passes on Telegram's reason, and never the address with the token", async () => {
    await expect(
      registerWebhook(
        "123:token",
        "https://site.example/api/webhook",
        "s",
        fakeTelegram({ ok: false, description: "Unauthorized" }, 401),
      ),
    ).rejects.toThrow("Unauthorized");
    const offline = vi.fn(async () => {
      throw new TypeError(
        "fetch failed: https://api.telegram.org/bot123:token",
      );
    });
    await expect(
      registerWebhook(
        "123:token",
        "https://site.example/api/webhook",
        "s",
        offline,
      ),
    ).rejects.toThrow(/^Couldn't reach Telegram\.$/);
  });

  it("reports whether updates reach this site", async () => {
    const expected = "https://site.example/api/webhook";
    expect(
      await webhookStatus(
        "t",
        expected,
        fakeTelegram({
          ok: true,
          result: {
            url: expected,
            pending_update_count: 2,
            last_error_date: 1795700000,
            last_error_message: "Wrong response from the webhook: 500",
          },
        }),
      ),
    ).toEqual({
      expectedUrl: expected,
      url: expected,
      connected: true,
      pendingUpdates: 2,
      lastError: "Wrong response from the webhook: 500",
      lastErrorAt: new Date(1795700000 * 1000).toISOString(),
    });
    const elsewhere = await webhookStatus(
      "t",
      expected,
      fakeTelegram({
        ok: true,
        result: { url: "https://old.example/api/webhook" },
      }),
    );
    expect(elsewhere.connected).toBe(false);
    const none = await webhookStatus(
      "t",
      expected,
      fakeTelegram({ ok: true, result: { url: "" } }),
    );
    expect(none).toMatchObject({ url: "", connected: false });
  });
});
