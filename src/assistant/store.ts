import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  assistantMessages,
  assistantUpdateClaims,
  telegramFileCache,
} from "../db/schema.js";
import type { AssistantTurn } from "./agent.js";

const HISTORY_LIMIT = 8;
const HISTORY_WINDOW_MS = 6 * 60 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AssistantStore {
  claimUpdate(updateId: number): Promise<boolean>;
  recentTurns(chatId: string, now: Date): Promise<AssistantTurn[]>;
  appendTurn(
    chatId: string,
    userText: string,
    reply: string,
    toolContext: string,
  ): Promise<void>;
}

export class DrizzleAssistantStore implements AssistantStore {
  async claimUpdate(updateId: number): Promise<boolean> {
    const claimed = await db
      .insert(assistantUpdateClaims)
      .values({ updateId })
      .onConflictDoNothing({ target: assistantUpdateClaims.updateId })
      .returning({ updateId: assistantUpdateClaims.updateId });
    if (claimed.length > 0) {
      await db
        .delete(assistantUpdateClaims)
        .where(
          lt(
            assistantUpdateClaims.claimedAt,
            new Date(Date.now() - RETENTION_MS),
          ),
        );
    }
    return claimed.length > 0;
  }

  async recentTurns(chatId: string, now: Date): Promise<AssistantTurn[]> {
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(
        and(
          eq(assistantMessages.chatId, chatId),
          gt(
            assistantMessages.createdAt,
            new Date(now.getTime() - HISTORY_WINDOW_MS),
          ),
        ),
      )
      .orderBy(desc(assistantMessages.id))
      .limit(HISTORY_LIMIT);

    const turns = rows.reverse().map((row) => ({
      role: row.role as AssistantTurn["role"],
      content: row.content,
      toolContext: row.toolContext,
    }));
    // The model expects history to start with a user message.
    while (turns[0]?.role === "assistant") turns.shift();
    return turns;
  }

  async appendTurn(
    chatId: string,
    userText: string,
    reply: string,
    toolContext: string,
  ): Promise<void> {
    await db.insert(assistantMessages).values([
      { chatId, role: "user", content: userText },
      {
        chatId,
        role: "assistant",
        content: reply,
        toolContext: toolContext || null,
      },
    ]);
    await db
      .delete(assistantMessages)
      .where(
        and(
          eq(assistantMessages.chatId, chatId),
          lt(assistantMessages.createdAt, new Date(Date.now() - RETENTION_MS)),
        ),
      );
  }
}

export const assistantStore = new DrizzleAssistantStore();

export interface CachedTelegramFile {
  canvasFileId: number;
  canvasUpdatedAt: string;
  telegramFileId: string;
}

export interface TelegramFileCache {
  // Keyed by Canvas file id; callers compare canvasUpdatedAt themselves.
  get(canvasFileIds: number[]): Promise<Map<number, CachedTelegramFile>>;
  set(entries: CachedTelegramFile[]): Promise<void>;
}

export class DrizzleTelegramFileCache implements TelegramFileCache {
  async get(canvasFileIds: number[]): Promise<Map<number, CachedTelegramFile>> {
    if (canvasFileIds.length === 0) return new Map();
    const rows = await db
      .select()
      .from(telegramFileCache)
      .where(inArray(telegramFileCache.canvasFileId, canvasFileIds));
    return new Map(rows.map((row) => [row.canvasFileId, row]));
  }

  async set(entries: CachedTelegramFile[]): Promise<void> {
    for (const entry of entries) {
      await db
        .insert(telegramFileCache)
        .values({ ...entry, cachedAt: new Date() })
        .onConflictDoUpdate({
          target: telegramFileCache.canvasFileId,
          set: {
            canvasUpdatedAt: entry.canvasUpdatedAt,
            telegramFileId: entry.telegramFileId,
            cachedAt: new Date(),
          },
        });
    }
  }
}

export const telegramFileCacheStore = new DrizzleTelegramFileCache();
