import { describe, expect, it, vi } from "vitest";
import {
  applyCard,
  CardError,
  parseCards,
  type CardExecutors,
  type ChatCard,
} from "../src/web/chat-cards.js";
import {
  chatRoute,
  parseUpload,
  type ChatDependencies,
} from "../src/web/chat-routes.js";
import type {
  ChatMessage,
  ChatStore,
  ChatSummary,
  NewChatMessage,
} from "../src/web/chat-store.js";
import {
  chatTitle,
  NEW_CHAT_TITLE,
  type Assist,
  type ChatEvent,
} from "../src/web/chat.js";

class MemoryChats implements ChatStore {
  chats = new Map<number, ChatSummary>();
  rows: Array<ChatMessage & { chatId: number }> = [];
  private nextId = 1;

  async list(query?: string) {
    return [...this.chats.values()].filter(
      (chat) =>
        !query ||
        chat.title.includes(query) ||
        this.rows.some(
          (m) => m.chatId === chat.id && m.content.includes(query),
        ),
    );
  }
  async create() {
    const chat = {
      id: this.nextId++,
      title: NEW_CHAT_TITLE,
      pinned: false,
      updatedAt: new Date(),
    };
    this.chats.set(chat.id, chat);
    return chat;
  }
  async get(id: number) {
    return this.chats.get(id) ?? null;
  }
  async update(id: number, change: { title?: string; pinned?: boolean }) {
    const chat = this.chats.get(id);
    if (!chat) return false;
    Object.assign(chat, change);
    return true;
  }
  async remove(id: number) {
    this.rows = this.rows.filter((m) => m.chatId !== id);
    return this.chats.delete(id);
  }
  async messages(chatId: number) {
    return this.rows.filter((m) => m.chatId === chatId);
  }
  async recent(chatId: number, beforeId: number, limit: number) {
    return this.rows
      .filter((m) => m.chatId === chatId && m.id < beforeId)
      .slice(-limit);
  }
  async add(chatId: number, message: NewChatMessage) {
    const row = {
      chatId,
      id: this.nextId++,
      role: message.role,
      content: message.content,
      toolContext: message.toolContext ?? null,
      cards: message.cards ?? [],
      failed: message.failed ?? false,
      createdAt: new Date("2026-11-24T02:00:00Z"),
    };
    this.rows.push(row);
    return row;
  }
  async message(chatId: number, messageId: number) {
    return (
      this.rows.find((m) => m.chatId === chatId && m.id === messageId) ?? null
    );
  }
  async setCards(messageId: number, cards: ChatCard[]) {
    const row = this.rows.find((m) => m.id === messageId);
    if (row) row.cards = cards;
  }
}

function executors(): CardExecutors & {
  performDelete: ReturnType<typeof vi.fn>;
} {
  return {
    performDelete: vi.fn(async () => "Deleted to-do: buy milk"),
    addCalendarEvent: vi.fn(async () => ({ ok: true, message: "Added" })),
    deleteCalendarEvent: vi.fn(async () => ({
      ok: true,
      message: "Event deleted.",
    })),
  };
}

function setup(assist?: Assist) {
  const store = new MemoryChats();
  const deps: ChatDependencies = {
    store,
    assist:
      assist ??
      (async (input) => {
        input.onTool("search_files");
        input.onDraft("Hel");
        input.onDraft("Hello");
        return {
          reply: "Hello there",
          toolContext: "[search_files]\nnothing",
          cards: [],
        };
      }),
    cards: executors(),
    errorMessage: () => "The AI service returned an error.",
  };
  const call = (
    method: string,
    route: string,
    body?: unknown,
    search?: string,
  ) => chatRoute(method, route, body, deps, search);
  const send = async (chatId: number, body: unknown) => {
    const response = await call("POST", `chats/${chatId}/messages`, body);
    if (!response || !("stream" in response)) return { response, events: [] };
    const events: ChatEvent[] = [];
    await response.stream((event) => events.push(event));
    return { response, events };
  };
  return { store, deps, call, send };
}

describe("website chats", () => {
  it("names a new chat after its first message", () => {
    expect(chatTitle("  what's   due this week?  ")).toBe(
      "what's due this week?",
    );
    expect(chatTitle("x".repeat(100))).toHaveLength(60);
    expect(chatTitle("")).toBe(NEW_CHAT_TITLE);
  });

  it("saves both sides of a conversation and reports progress", async () => {
    const { call, send, store } = setup();
    const created = await call("POST", "chats");
    const chat = (created as { body: { chat: ChatSummary } }).body.chat;

    const { events } = await send(chat.id, { text: "Find lecture 11" });
    expect(events.map((e) => e.type)).toEqual([
      "user",
      "status",
      "status",
      "done",
    ]);
    expect(events[2]).toEqual({
      type: "status",
      text: "Searching Canvas files",
    });
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.message.content).toBe("Hello there");
    expect(done.title).toBe("Find lecture 11");
    expect(store.chats.get(chat.id)?.title).toBe("Find lecture 11");
    expect(store.rows.map((m) => [m.role, m.content])).toEqual([
      ["user", "Find lecture 11"],
      ["assistant", "Hello there"],
    ]);
  });

  it("sends the chat's earlier messages as history, without failed replies", async () => {
    const assist = vi.fn<Assist>(async () => ({
      reply: "ok",
      toolContext: "",
      cards: [],
    }));
    const { call, send, store } = setup(assist);
    const { body } = (await call("POST", "chats")) as {
      body: { chat: ChatSummary };
    };
    await store.add(body.chat.id, { role: "user", content: "first" });
    await store.add(body.chat.id, {
      role: "assistant",
      content: "reply",
      toolContext: "[list_todos]\n1. milk",
    });
    await store.add(body.chat.id, {
      role: "assistant",
      content: "The AI service returned an error.",
      failed: true,
    });
    await send(body.chat.id, { text: "second" });
    expect(assist.mock.calls[0][0].history).toEqual([
      { role: "user", content: "first", toolContext: null },
      {
        role: "assistant",
        content: "reply",
        toolContext: "[list_todos]\n1. milk",
      },
    ]);
  });

  it("saves a failure as a reply the page can show", async () => {
    const { call, send, store } = setup(async () => {
      throw new Error("boom");
    });
    const { body } = (await call("POST", "chats")) as {
      body: { chat: ChatSummary };
    };
    const { events } = await send(body.chat.id, { text: "hi" });
    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.message).toMatchObject({
      failed: true,
      content: "The AI service returned an error.",
    });
    expect(store.rows.at(-1)?.failed).toBe(true);
  });

  it("never stores an upload, only a note that one was sent", async () => {
    const assist = vi.fn<Assist>(async () => ({
      reply: "A cat",
      toolContext: "",
      cards: [],
    }));
    const { call, send, store } = setup(assist);
    const { body } = (await call("POST", "chats")) as {
      body: { chat: ChatSummary };
    };
    const image = `data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`;
    await send(body.chat.id, { text: "what is this", image });
    expect(assist.mock.calls[0][0].image).toBe(image);
    expect(store.rows[0].content).toBe("[Photo] what is this");
    expect(JSON.stringify(store.rows)).not.toContain("base64");
  });

  it("checks uploads", () => {
    expect(parseUpload({})).toEqual({});
    expect(parseUpload({ image: "data:image/svg+xml;base64,PHN2Zz4=" })).toBe(
      "That photo couldn't be read.",
    );
    expect(
      parseUpload({
        file: { name: "virus.exe", mimeType: "", data: "AAAA" },
      }),
    ).toContain("can't be read");
    expect(
      parseUpload({
        file: {
          name: "big.pdf",
          mimeType: "application/pdf",
          data: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"),
        },
      }),
    ).toContain("at most 3 MB");
    const ok = parseUpload({
      file: {
        name: "notes.pdf",
        mimeType: "application/pdf",
        data: "JVBERi0=",
      },
    });
    expect(ok).toMatchObject({ file: { name: "notes.pdf" } });
    expect(parseUpload({ image: "data:image/png;base64,AA==", file: {} })).toBe(
      "Send one photo or one file at a time.",
    );
  });

  it("refuses empty or overlong messages and unknown chats", async () => {
    const { call } = setup();
    const { body } = (await call("POST", "chats")) as {
      body: { chat: ChatSummary };
    };
    expect(
      (await call("POST", `chats/${body.chat.id}/messages`, { text: " " }))
        ?.status,
    ).toBe(400);
    expect(
      (
        await call("POST", `chats/${body.chat.id}/messages`, {
          text: "x".repeat(8001),
        })
      )?.status,
    ).toBe(400);
    expect(
      (await call("POST", "chats/999/messages", { text: "hi" }))?.status,
    ).toBe(404);
  });

  it("renames, pins, searches and deletes chats", async () => {
    const { call, store } = setup();
    const { body } = (await call("POST", "chats")) as {
      body: { chat: ChatSummary };
    };
    const id = body.chat.id;
    expect(
      (await call("PATCH", `chats/${id}`, { title: "  CS2040S  " }))?.status,
    ).toBe(200);
    expect(store.chats.get(id)?.title).toBe("CS2040S");
    expect(
      (await call("PATCH", `chats/${id}`, { pinned: "yes" }))?.status,
    ).toBe(400);
    await call("PATCH", `chats/${id}`, { pinned: true });
    expect(store.chats.get(id)?.pinned).toBe(true);
    const found = (await call("GET", "chats", undefined, "2040")) as {
      body: { chats: ChatSummary[] };
    };
    expect(found.body.chats.map((c) => c.id)).toEqual([id]);
    expect((await call("DELETE", `chats/${id}`))?.status).toBe(200);
    expect((await call("GET", `chats/${id}`))?.status).toBe(404);
  });
});

describe("chat cards", () => {
  const deleteCard: ChatCard = {
    type: "delete",
    kind: "todo",
    id: 5,
    label: "Delete to-do: buy milk?",
    state: "pending",
  };

  it("does nothing until Confirm, and only once", async () => {
    const run = executors();
    const cancelled = await applyCard(deleteCard, "cancel", run);
    expect(cancelled).toMatchObject({ state: "cancelled", result: "Kept." });
    expect(run.performDelete).not.toHaveBeenCalled();
    await expect(applyCard(cancelled, "confirm", run)).rejects.toBeInstanceOf(
      CardError,
    );

    const done = await applyCard(deleteCard, "confirm", run);
    expect(run.performDelete).toHaveBeenCalledWith("todo", 5);
    expect(done).toMatchObject({ state: "done" });
    await expect(applyCard(done, "confirm", run)).rejects.toBeInstanceOf(
      CardError,
    );
  });

  it("lets a failed card be tried again", async () => {
    const run = executors();
    run.addCalendarEvent = vi.fn(async () => ({ ok: false, message: "No" }));
    const card: ChatCard = {
      type: "calendar-create",
      line: "14:00-15:00, Lab, 27-11-2026",
      label: "Lab",
      state: "pending",
    };
    const failed = await applyCard(card, "confirm", run);
    expect(failed.state).toBe("failed");
    run.addCalendarEvent = vi.fn(async () => ({ ok: true, message: "Added" }));
    expect((await applyCard(failed, "confirm", run)).state).toBe("done");
  });

  it("presses the stored card, not one the browser describes", async () => {
    const { call, store, deps } = setup();
    const { body } = (await call("POST", "chats")) as {
      body: { chat: ChatSummary };
    };
    const reply = await store.add(body.chat.id, {
      role: "assistant",
      content: "Confirm below.",
      cards: [deleteCard],
    });
    const route = `chats/${body.chat.id}/messages/${reply.id}/cards/0`;
    const pressed = await call("POST", route, {
      action: "confirm",
      kind: "task",
      id: 99,
    });
    expect(pressed?.status).toBe(200);
    expect(deps.cards.performDelete).toHaveBeenCalledWith("todo", 5);
    expect(store.rows.at(-1)?.cards[0].state).toBe("done");
    expect((await call("POST", route, { action: "confirm" }))?.status).toBe(
      409,
    );
    expect(
      (
        await call(
          "POST",
          `chats/${body.chat.id}/messages/${reply.id}/cards/3`,
          {
            action: "confirm",
          },
        )
      )?.status,
    ).toBe(404);
  });

  it("drops malformed cards read back from the database", () => {
    expect(
      parseCards([
        deleteCard,
        { type: "delete", kind: "user", id: 1, label: "x", state: "pending" },
        { type: "calendar-delete", label: "x", state: "pending" },
        "nonsense",
      ]),
    ).toEqual([deleteCard]);
  });
});
