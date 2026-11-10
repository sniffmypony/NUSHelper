import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  assistantMessages,
  assistantRequests,
  assistantSettings,
  assistantUpdateClaims,
  telegramFileCache,
} from "../db/schema.js";
import type { AssistantTurn } from "./agent.js";
import { isEffortSetting, type EffortSetting } from "./effort.js";

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

export type StoredAttachment =
  | { kind: "image"; fileId: string; mimeType: string }
  | { kind: "file"; fileId: string; name: string; mimeType: string };

export interface StoredRequest {
  text: string;
  attachment?: StoredAttachment;
}

// The /effort setting and the questions "Think harder" can re-run.
export interface AssistantSettings {
  effort(chatId: string): Promise<EffortSetting>;
  setEffort(chatId: string, effort: EffortSetting): Promise<void>;
  saveRequest(chatId: string, request: StoredRequest): Promise<number>;
  findRequest(chatId: string, id: number): Promise<StoredRequest | null>;
}

export class DrizzleAssistantSettings implements AssistantSettings {
  async effort(chatId: string): Promise<EffortSetting> {
    const [row] = await db
      .select({ effort: assistantSettings.effort })
      .from(assistantSettings)
      .where(eq(assistantSettings.chatId, chatId));
    return row && isEffortSetting(row.effort) ? row.effort : "auto";
  }

  async setEffort(chatId: string, effort: EffortSetting): Promise<void> {
    await db
      .insert(assistantSettings)
      .values({ chatId, effort, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: assistantSettings.chatId,
        set: { effort, updatedAt: new Date() },
      });
  }

  async saveRequest(chatId: string, request: StoredRequest): Promise<number> {
    const { attachment } = request;
    const [row] = await db
      .insert(assistantRequests)
      .values({
        chatId,
        text: request.text,
        attachmentKind: attachment?.kind ?? null,
        attachmentFileId: attachment?.fileId ?? null,
        attachmentName: attachment?.kind === "file" ? attachment.name : null,
        attachmentMimeType: attachment?.mimeType ?? null,
      })
      .returning({ id: assistantRequests.id });
    await db
      .delete(assistantRequests)
      .where(
        lt(assistantRequests.createdAt, new Date(Date.now() - RETENTION_MS)),
      );
    return row.id;
  }

  async findRequest(chatId: string, id: number): Promise<StoredRequest | null> {
    const [row] = await db
      .select()
      .from(assistantRequests)
      .where(
        and(eq(assistantRequests.id, id), eq(assistantRequests.chatId, chatId)),
      );
    if (!row) return null;
    const fileId = row.attachmentFileId;
    const mimeType = row.attachmentMimeType ?? "";
    const attachment: StoredAttachment | undefined =
      fileId && row.attachmentKind === "image"
        ? { kind: "image", fileId, mimeType }
        : fileId && row.attachmentKind === "file"
          ? {
              kind: "file",
              fileId,
              name: row.attachmentName ?? "file",
              mimeType,
            }
          : undefined;
    return { text: row.text, attachment };
  }
}

export const assistantSettingsStore = new DrizzleAssistantSettings();

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
