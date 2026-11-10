import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/assistant/store.js", () => ({
  assistantStore: {},
  telegramFileCacheStore: {},
  assistantSettingsStore: {},
}));

import {
  answerAssistantMessage,
  imageFromMessage,
  sendReply,
  type AssistantTelegram,
} from "../src/assistant/handlers.js";
import { NO_CAPTION_TEXT, runAssistant } from "../src/assistant/agent.js";
import { protectCurrency, toPlainText } from "../src/assistant/format.js";
import type { CanvasClient } from "../src/canvas/client.js";

function telegramFake() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    sendMediaGroup: vi.fn().mockResolvedValue([]),
    sendRichMessage: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from("png-bytes")),
  } satisfies AssistantTelegram;
}

function textReply(content: string): ChatCompletion {
  return {
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  } as unknown as ChatCompletion;
}

describe("rich Markdown replies", () => {
  it("sends model Markdown with LaTeX as a rich message", async () => {
    const telegram = telegramFake();
    await sendReply(
      telegram,
      1,
      "So $x = 1$ or $x = 3$.",
      "markdown",
      undefined,
    );
    expect(telegram.sendRichMessage).toHaveBeenCalledWith(
      1,
      "So $x = 1$ or $x = 3$.",
      undefined,
    );
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to plain text when Telegram rejects the rich message", async () => {
    const telegram = telegramFake();
    telegram.sendRichMessage.mockRejectedValueOnce(
      Object.assign(new Error("400"), {
        description: "Bad Request: can't parse rich message",
      }),
    );
    const keyboard = {
      inline_keyboard: [[{ text: "Undo", callback_data: "ai:undo:todo:1" }]],
    };
    await sendReply(telegram, 1, "**Answer:** $x = 1$", "markdown", keyboard);
    expect(telegram.sendMessage).toHaveBeenCalledWith(1, "Answer: $x = 1$", {
      reply_markup: keyboard,
    });
  });

  it("sends the bot's own texts as plain messages", async () => {
    const telegram = telegramFake();
    await sendReply(telegram, 1, "Expenditure: S$9.80", "plain", undefined);
    expect(telegram.sendRichMessage).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      1,
      "Expenditure: S$9.80",
      undefined,
    );
  });

  it("stops amounts like S$9.80 from becoming formulas", () => {
    expect(protectCurrency("Lunch S$9.80 and dinner S$12, so $x^2$")).toBe(
      "Lunch S＄9.80 and dinner S＄12, so $x^2$",
    );
  });

  it("strips Markdown markers for the plain fallback", () => {
    expect(toPlainText("## Due\n**Project** — __Wed__")).toBe(
      "Due\nProject — Wed",
    );
  });

  it("marks model replies as Markdown and bot texts as plain", async () => {
    const model = await runAssistant({
      create: vi.fn().mockResolvedValue(textReply("$2^n$ subsets")),
      model: "m",
      history: [],
      userText: "how many subsets",
      execute: vi.fn(),
    });
    expect(model.format).toBe("markdown");

    const falseClaim = await runAssistant({
      create: vi.fn().mockResolvedValue(textReply("Sent L10.pdf.")),
      model: "m",
      history: [],
      userText: "send l10",
      execute: vi.fn(),
    });
    expect(falseClaim.format).toBe("plain");
  });
});

describe("photos", () => {
  it("takes the largest size of a photo", () => {
    expect(
      imageFromMessage({
        photo: [
          { file_id: "small", file_size: 1000 },
          { file_id: "large", file_size: 90000 },
        ],
      }),
    ).toEqual({ kind: "image", fileId: "large", mimeType: "image/jpeg" });
  });

  it("accepts image files and explains unsupported ones", () => {
    expect(
      imageFromMessage({
        document: { file_id: "f", mime_type: "image/png", file_size: 10 },
      }),
    ).toEqual({ kind: "image", fileId: "f", mimeType: "image/png" });
    expect(
      imageFromMessage({ document: { file_id: "f", mime_type: "image/heic" } }),
    ).toMatchObject({ kind: "unsupported" });
    expect(
      imageFromMessage({
        photo: [{ file_id: "big", file_size: 25 * 1024 * 1024 }],
      }),
    ).toMatchObject({
      kind: "unsupported",
      reason: expect.stringMatching(/20 MB/),
    });
    expect(
      imageFromMessage({
        document: { file_id: "f", mime_type: "application/pdf" },
      }),
    ).toBeNull();
    expect(imageFromMessage({ text: "hi" })).toBeNull();
  });

  it("sends the photo and caption to the model together", async () => {
    const create = vi.fn().mockResolvedValue(textReply("$x = 3$"));
    await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "",
      image: "data:image/png;base64,AAAA",
      execute: vi.fn(),
    });
    expect(create.mock.calls[0][0].messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: NO_CAPTION_TEXT },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
  });

  it("downloads the photo, answers, and records it in history", async () => {
    const telegram = telegramFake();
    const store = {
      claimUpdate: vi.fn(),
      recentTurns: vi.fn().mockResolvedValue([]),
      appendTurn: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi.fn().mockResolvedValue(textReply("Roots: $x=1, 3$"));
    await answerAssistantMessage(
      telegram,
      42,
      "just part b",
      {
        store,
        runInBackground: vi.fn(),
        createCompletion: create,
        canvas: {} as CanvasClient,
        model: "m",
      },
      undefined,
      { kind: "image", fileId: "photo-1", mimeType: "image/jpeg" },
    );
    expect(telegram.downloadFile).toHaveBeenCalledWith("photo-1");
    const userMessage = create.mock.calls[0][0].messages.at(-1);
    expect(userMessage.content[1].image_url.url).toBe(
      `data:image/jpeg;base64,${Buffer.from("png-bytes").toString("base64")}`,
    );
    expect(telegram.sendRichMessage).toHaveBeenCalledWith(
      42,
      "Roots: $x=1, 3$",
      undefined,
    );
    expect(store.appendTurn).toHaveBeenCalledWith(
      "42",
      "[Photo] just part b",
      "Roots: $x=1, 3$",
      "",
    );
  });
});
