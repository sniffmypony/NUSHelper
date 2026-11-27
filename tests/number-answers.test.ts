import { describe, expect, it, vi } from "vitest";

// The latest assistant_messages row the store reads, set per test.
let latest: { role: string; content: string; createdAt: Date } | undefined;
vi.mock("../src/db/client.js", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => (latest ? [latest] : []),
  };
  return { db: chain };
});

import {
  ANSWER_WINDOW_MS,
  DrizzleAssistantStore,
  asksQuestion,
} from "../src/assistant/store.js";

const NOW = new Date("2026-11-21T05:01:00Z");
const store = new DrizzleAssistantStore();

describe("a bare number right after the assistant asks something", () => {
  it("recognises a question near the end of a reply", () => {
    expect(
      asksQuestion(
        "Sure — what time do you want the reminder? (24-hour time, e.g. 1500 for 3pm)",
      ),
    ).toBe(true);
    expect(asksQuestion("Which one?\n1. L10.pdf\n2. L10 (annotated).pdf")).toBe(
      true,
    );
    expect(asksQuestion("Reminder set for 16:00 today.")).toBe(false);
    expect(
      asksQuestion("Sent. https://canvas.nus.edu.sg/files?download=1&x=2"),
    ).toBe(false);
  });

  it("treats it as the answer only if the latest message is a recent assistant question", async () => {
    latest = {
      role: "assistant",
      content: "Sure — what time do you want the reminder? (24-hour time)",
      createdAt: new Date(NOW.getTime() - 60_000),
    };
    expect(await store.awaitsAnswer("1", NOW)).toBe(true);

    latest = {
      ...latest,
      createdAt: new Date(NOW.getTime() - ANSWER_WINDOW_MS - 1),
    };
    expect(await store.awaitsAnswer("1", NOW)).toBe(false);

    latest = {
      role: "assistant",
      content: "Reminder set for 16:00 today.",
      createdAt: new Date(NOW.getTime() - 60_000),
    };
    expect(await store.awaitsAnswer("1", NOW)).toBe(false);

    latest = undefined;
    expect(await store.awaitsAnswer("1", NOW)).toBe(false);
  });
});

describe("which conversation a number belongs to", () => {
  it("uses the topic, as the assistant stores its questions", async () => {
    const { conversationOf } = await import("../src/topic-context.js");
    const inTopic = {
      chat: { id: 123456789 },
      msg: { is_topic_message: true, message_thread_id: 270579 },
    };
    const inChat = { chat: { id: 123456789 }, msg: {} };
    expect(conversationOf(inTopic as never)).toBe("123456789:270579");
    expect(conversationOf(inChat as never)).toBe("123456789");
  });
});
