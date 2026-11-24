import { and, asc, desc, eq, exists, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { webChatMessages, webChats } from "../db/schema.js";
import { parseCards, type ChatCard } from "./chat-cards.js";

export { NEW_CHAT_TITLE } from "./chat.js";

// Saved website chats. Every query runs on its own (the bot has a single
// pooled database connection; see src/settings/runtime.ts).

export interface ChatSummary {
  id: number;
  title: string;
  pinned: boolean;
  updatedAt: Date;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  toolContext: string | null;
  cards: ChatCard[];
  failed: boolean;
  createdAt: Date;
}

export interface NewChatMessage {
  role: "user" | "assistant";
  content: string;
  toolContext?: string | null;
  cards?: ChatCard[];
  failed?: boolean;
}

export interface ChatStore {
  list(query?: string): Promise<ChatSummary[]>;
  create(): Promise<ChatSummary>;
  get(id: number): Promise<ChatSummary | null>;
  update(
    id: number,
    change: { title?: string; pinned?: boolean },
  ): Promise<boolean>;
  remove(id: number): Promise<boolean>;
  messages(chatId: number): Promise<ChatMessage[]>;
  // The last `limit` messages before `beforeId`, oldest first.
  recent(
    chatId: number,
    beforeId: number,
    limit: number,
  ): Promise<ChatMessage[]>;
  // Adds a message and marks the chat as just used.
  add(chatId: number, message: NewChatMessage): Promise<ChatMessage>;
  message(chatId: number, messageId: number): Promise<ChatMessage | null>;
  setCards(messageId: number, cards: ChatCard[]): Promise<void>;
}

const LIST_LIMIT = 200;

const summary = {
  id: webChats.id,
  title: webChats.title,
  pinned: webChats.pinned,
  updatedAt: webChats.updatedAt,
};

function toMessage(row: typeof webChatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    toolContext: row.toolContext,
    cards: parseCards(row.cards),
    failed: row.failed,
    createdAt: row.createdAt,
  };
}

// % and _ are wildcards in LIKE; a search for them means the characters.
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const chatStore: ChatStore = {
  async list(query) {
    const search = query?.trim();
    const pattern = search ? likePattern(search) : null;
    return db
      .select(summary)
      .from(webChats)
      .where(
        pattern
          ? or(
              ilike(webChats.title, pattern),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(webChatMessages)
                  .where(
                    and(
                      eq(webChatMessages.chatId, webChats.id),
                      ilike(webChatMessages.content, pattern),
                    ),
                  ),
              ),
            )
          : undefined,
      )
      .orderBy(desc(webChats.pinned), desc(webChats.updatedAt))
      .limit(LIST_LIMIT);
  },

  async create() {
    const [row] = await db.insert(webChats).values({}).returning(summary);
    return row;
  },

  async get(id) {
    const [row] = await db
      .select(summary)
      .from(webChats)
      .where(eq(webChats.id, id))
      .limit(1);
    return row ?? null;
  },

  async update(id, change) {
    const rows = await db
      .update(webChats)
      .set(change)
      .where(eq(webChats.id, id))
      .returning({ id: webChats.id });
    return rows.length > 0;
  },

  async remove(id) {
    const rows = await db
      .delete(webChats)
      .where(eq(webChats.id, id))
      .returning({ id: webChats.id });
    return rows.length > 0;
  },

  async messages(chatId) {
    const rows = await db
      .select()
      .from(webChatMessages)
      .where(eq(webChatMessages.chatId, chatId))
      .orderBy(asc(webChatMessages.id));
    return rows.map(toMessage);
  },

  async recent(chatId, beforeId, limit) {
    const rows = await db
      .select()
      .from(webChatMessages)
      .where(
        and(
          eq(webChatMessages.chatId, chatId),
          lt(webChatMessages.id, beforeId),
        ),
      )
      .orderBy(desc(webChatMessages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  },

  async add(chatId, message) {
    const [row] = await db
      .insert(webChatMessages)
      .values({
        chatId,
        role: message.role,
        content: message.content,
        toolContext: message.toolContext ?? null,
        cards: message.cards ?? [],
        failed: message.failed ?? false,
      })
      .returning();
    await db
      .update(webChats)
      .set({ updatedAt: row.createdAt })
      .where(eq(webChats.id, chatId));
    return toMessage(row);
  },

  async message(chatId, messageId) {
    const [row] = await db
      .select()
      .from(webChatMessages)
      .where(
        and(
          eq(webChatMessages.chatId, chatId),
          eq(webChatMessages.id, messageId),
        ),
      )
      .limit(1);
    return row ? toMessage(row) : null;
  },

  async setCards(messageId, cards) {
    await db
      .update(webChatMessages)
      .set({ cards })
      .where(eq(webChatMessages.id, messageId));
  },
};
