import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));
vi.mock("../src/assistant/store.js", () => ({
  assistantStore: {},
  telegramFileCacheStore: {},
  assistantSettingsStore: {},
}));

import { telegramFor } from "../src/assistant/handlers.js";
import { TelegramDeliveryError } from "../src/telegram.js";
import {
  conversationKey,
  describeTopicSetup,
  isMissingTopicError,
  sendToTopic,
  setUpTopics,
  threadIdOf,
  type TopicCategory,
  type TopicStore,
} from "../src/topics.js";

function fakeStore(
  saved: Partial<Record<TopicCategory, number>> = {},
): TopicStore & { saved: Partial<Record<TopicCategory, number>> } {
  return {
    saved,
    all: vi.fn(async () => ({ ...saved })),
    save: vi.fn(
      async (_chatId: string, category: TopicCategory, threadId: number) => {
        saved[category] = threadId;
      },
    ),
    remove: vi.fn(async (_chatId: string, category: TopicCategory) => {
      delete saved[category];
    }),
  };
}

const missingTopic = () =>
  new TelegramDeliveryError(
    "Telegram sendMessage failed: Bad Request: message thread not found",
    400,
    "Bad Request: message thread not found",
  );

describe("sending the bot's own messages to a topic", () => {
  it("sends to the category's topic when one is saved", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendToTopic(
      "planner",
      "Good morning",
      { chatId: "42", silent: true },
      fakeStore({ planner: 7 }),
      send,
    );
    expect(send).toHaveBeenCalledWith("Good morning", {
      chatId: "42",
      silent: true,
      threadId: 7,
    });
  });

  it("sends to the chat itself when no topic is saved", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendToTopic(
      "expenditure",
      "expenditure:",
      { chatId: "42" },
      fakeStore({ planner: 7 }),
      send,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("expenditure:", { chatId: "42" });
  });

  it("falls back to the chat and forgets a topic that was deleted", async () => {
    const store = fakeStore({ planner: 7 });
    const send = vi
      .fn()
      .mockRejectedValueOnce(missingTopic())
      .mockResolvedValue(undefined);
    await sendToTopic("planner", "do tutorial", { chatId: "42" }, store, send);
    expect(send).toHaveBeenLastCalledWith("do tutorial", { chatId: "42" });
    expect(store.remove).toHaveBeenCalledWith("42", "planner");
  });

  it("still delivers when the topic table cannot be read", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const store = fakeStore();
    vi.mocked(store.all).mockRejectedValue(new Error("relation missing"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendToTopic("planner", "do tutorial", { chatId: "42" }, store, send);
    expect(send).toHaveBeenCalledWith("do tutorial", { chatId: "42" });
    logged.mockRestore();
  });

  it("does not hide other delivery failures", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new TelegramDeliveryError("rate limited", 429));
    await expect(
      sendToTopic(
        "planner",
        "x",
        { chatId: "42" },
        fakeStore({ planner: 7 }),
        send,
      ),
    ).rejects.toThrow("rate limited");
    expect(send).toHaveBeenCalledTimes(1);
    expect(isMissingTopicError(missingTopic())).toBe(true);
    expect(isMissingTopicError(new Error("thread not found"))).toBe(false);
  });
});

describe("/topics", () => {
  it("explains what to do when Threaded mode is off", async () => {
    const api = { callApi: vi.fn().mockResolvedValue({}) };
    const result = await setUpTopics(api, 42, fakeStore());
    expect(result).toEqual({ kind: "off" });
    expect(api.callApi).toHaveBeenCalledTimes(1);
    expect(describeTopicSetup(result)).toMatch(/Threaded mode/);
  });

  it("creates only the missing topics and introduces each one", async () => {
    const store = fakeStore({ planner: 7 });
    let nextThread = 100;
    const api = {
      callApi: vi.fn(async (method: string) => {
        if (method === "getMe") return { has_topics_enabled: true };
        if (method === "createForumTopic") {
          return { message_thread_id: nextThread++ };
        }
        return {};
      }),
    };
    const result = await setUpTopics(api, 42, store);
    expect(result).toEqual({
      kind: "ready",
      created: ["study", "canvas", "expenditure"],
      existing: ["planner"],
    });
    expect(store.saved).toEqual({
      planner: 7,
      study: 100,
      canvas: 101,
      expenditure: 102,
    });
    expect(api.callApi).toHaveBeenCalledWith("createForumTopic", {
      chat_id: 42,
      name: "Canvas files",
    });
    expect(api.callApi).toHaveBeenCalledWith(
      "sendMessage",
      expect.objectContaining({ chat_id: 42, message_thread_id: 102 }),
    );
    expect(describeTopicSetup(result)).toContain(
      "Created: Study, Canvas files, Expenditure.",
    );
  });
});

describe("replying in the topic the user wrote in", () => {
  const ctxWith = (message: object) => {
    const telegram = {
      sendMessage: vi.fn(),
      sendChatAction: vi.fn(),
      sendDocument: vi.fn(),
      sendMediaGroup: vi.fn(),
      deleteMessage: vi.fn(),
      callApi: vi.fn(),
    };
    return { ctx: { msg: message, telegram } as never, telegram };
  };

  it("reads the topic from a message, and keeps the old memory key without one", () => {
    const { ctx } = ctxWith({ is_topic_message: true, message_thread_id: 7 });
    expect(threadIdOf(ctx)).toBe(7);
    expect(threadIdOf(ctxWith({ message_thread_id: 7 }).ctx)).toBeUndefined();
    expect(conversationKey(42)).toBe("42");
    expect(conversationKey(42, 7)).toBe("42:7");
  });

  it("adds the topic to everything the assistant sends", async () => {
    const { ctx, telegram } = ctxWith({
      is_topic_message: true,
      message_thread_id: 7,
    });
    const api = telegramFor(ctx);
    await api.sendMessage(42, "hi", { reply_markup: undefined });
    await api.sendChatAction(42, "typing");
    await api.sendDocument(42, "file-id");
    await api.sendRichMessage(42, "**hi**");
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, "hi", {
      reply_markup: undefined,
      message_thread_id: 7,
    });
    expect(telegram.sendChatAction).toHaveBeenCalledWith(42, "typing", {
      message_thread_id: 7,
    });
    expect(telegram.sendDocument).toHaveBeenCalledWith(42, "file-id", {
      message_thread_id: 7,
    });
    expect(telegram.callApi).toHaveBeenCalledWith("sendRichMessage", {
      chat_id: 42,
      rich_message: { markdown: "**hi**" },
      message_thread_id: 7,
    });
  });

  it("sends exactly as before when there is no topic", async () => {
    const { ctx, telegram } = ctxWith({});
    const api = telegramFor(ctx);
    await api.sendMessage(42, "hi");
    await api.sendChatAction(42, "typing");
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, "hi", undefined);
    expect(telegram.sendChatAction).toHaveBeenCalledWith(42, "typing");
  });
});
