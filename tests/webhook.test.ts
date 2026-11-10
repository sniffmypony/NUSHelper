import type { VercelRequest, VercelResponse } from "@vercel/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  ensureCalendarReadable: vi.fn(),
  handleUpdate: vi.fn(),
  withVercelOidcToken: vi.fn(),
}));

vi.mock("../src/bot.js", () => ({
  bot: { handleUpdate: fakes.handleUpdate },
}));

vi.mock("../src/calendar/google.js", () => ({
  ensureCalendarReadable: fakes.ensureCalendarReadable,
}));

vi.mock("../src/calendar/request-context.js", () => ({
  withVercelOidcToken: fakes.withVercelOidcToken,
}));

import handler from "../api/webhook.js";
import {
  WEBHOOK_SECRET_HEADER,
  isValidWebhookSecret,
  webhookSecretFor,
} from "../src/webhook-secret.js";

const TOKEN = "123456:test-token";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;

function telegramRequest(secret?: string): VercelRequest {
  return {
    method: "POST",
    body: { update_id: 1 },
    headers: {
      "x-vercel-oidc-token": "test-token",
      ...(secret === undefined ? {} : { [WEBHOOK_SECRET_HEADER]: secret }),
    },
  } as unknown as VercelRequest;
}

function mockResponse() {
  const response = {
    writableEnded: false,
    status: vi.fn(),
    send: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.send.mockReturnValue(response);
  return response;
}

describe("Telegram webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.ensureCalendarReadable.mockResolvedValue(undefined);
    fakes.withVercelOidcToken.mockImplementation(
      async (_token: unknown, callback: () => Promise<unknown>) => callback(),
    );
  });

  it("keeps the HTTP response open until the full Telegram update completes", async () => {
    let finishUpdate!: () => void;
    fakes.handleUpdate.mockReturnValue(
      new Promise<void>((resolve) => {
        finishUpdate = resolve;
      }),
    );
    const request = telegramRequest(webhookSecretFor(TOKEN));
    const response = mockResponse();

    const pending = handler(request, response as unknown as VercelResponse);
    await vi.waitFor(() => expect(fakes.handleUpdate).toHaveBeenCalledOnce());

    expect(fakes.handleUpdate).toHaveBeenCalledWith(request.body);
    expect(response.send).not.toHaveBeenCalled();

    finishUpdate();
    await pending;

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith("ok");
  });
});

describe("webhook secret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.withVercelOidcToken.mockImplementation(
      async (_token: unknown, callback: () => Promise<unknown>) => callback(),
    );
  });

  it.each([
    ["missing", undefined],
    ["wrong", "not-the-secret"],
    ["for another bot", webhookSecretFor("999:other-token")],
  ])("rejects a request whose secret is %s", async (_label, secret) => {
    const response = mockResponse();
    await handler(
      telegramRequest(secret),
      response as unknown as VercelResponse,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(fakes.handleUpdate).not.toHaveBeenCalled();
  });

  it("accepts Telegram's secret", async () => {
    fakes.handleUpdate.mockResolvedValue(undefined);
    const response = mockResponse();
    await handler(
      telegramRequest(webhookSecretFor(TOKEN)),
      response as unknown as VercelResponse,
    );
    expect(fakes.handleUpdate).toHaveBeenCalledOnce();
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("derives a stable secret in Telegram's allowed characters", () => {
    const secret = webhookSecretFor(TOKEN);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(webhookSecretFor(TOKEN)).toBe(secret);
    expect(webhookSecretFor("other")).not.toBe(secret);
    expect(isValidWebhookSecret([secret], TOKEN)).toBe(true);
  });
});
