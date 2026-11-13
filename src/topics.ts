import { and, eq } from "drizzle-orm";
import type { Telegraf } from "telegraf";
import { db } from "./db/client.js";
import { chatTopics } from "./db/schema.js";
import { telegramOwnerId } from "./env.js";
import {
  TelegramDeliveryError,
  sendTelegramMessage,
  type SendTelegramMessageOptions,
} from "./telegram.js";

export { conversationKey, threadIdOf } from "./topic-context.js";

// With Threaded mode on, the private chat with the bot has topics. Replies
// always go to the topic the user wrote in (Telegraf does that). Messages the
// bot sends by itself go to the topic for their category. If topics are off,
// not set up, or one was deleted, everything goes to the chat itself, exactly
// as before topics existed.

export const TOPIC_CATEGORIES = [
  "planner",
  "study",
  "canvas",
  "expenditure",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const TOPIC_NAMES: Record<TopicCategory, string> = {
  planner: "Planner",
  study: "Study",
  canvas: "Canvas files",
  expenditure: "Expenditure",
};

const TOPIC_INTROS: Record<TopicCategory, string> = {
  planner:
    "Planner: reminders, the morning brief, the weekly digest and the nightly check-in arrive here. Use it for tasks, to-dos, reminders and calendar events.",
  study:
    "Study: ask maths, computer science and other study questions here. Photos and files work too.",
  canvas:
    "Canvas files: ask for lecture slides, tutorials and other module files here.",
  expenditure:
    "Expenditure: the nightly prompt and the weekly and monthly reports arrive here. Send amounts here to log spending.",
};

export interface TopicStore {
  all(chatId: string): Promise<Partial<Record<TopicCategory, number>>>;
  save(
    chatId: string,
    category: TopicCategory,
    threadId: number,
  ): Promise<void>;
  remove(chatId: string, category: TopicCategory): Promise<void>;
}

function isCategory(value: string): value is TopicCategory {
  return (TOPIC_CATEGORIES as readonly string[]).includes(value);
}

export class DrizzleTopicStore implements TopicStore {
  async all(chatId: string): Promise<Partial<Record<TopicCategory, number>>> {
    const rows = await db
      .select()
      .from(chatTopics)
      .where(eq(chatTopics.chatId, chatId));
    const topics: Partial<Record<TopicCategory, number>> = {};
    for (const row of rows) {
      if (isCategory(row.category)) topics[row.category] = row.threadId;
    }
    return topics;
  }

  async save(
    chatId: string,
    category: TopicCategory,
    threadId: number,
  ): Promise<void> {
    await db
      .insert(chatTopics)
      .values({ chatId, category, threadId })
      .onConflictDoUpdate({
        target: [chatTopics.chatId, chatTopics.category],
        set: { threadId, createdAt: new Date() },
      });
  }

  async remove(chatId: string, category: TopicCategory): Promise<void> {
    await db
      .delete(chatTopics)
      .where(
        and(eq(chatTopics.chatId, chatId), eq(chatTopics.category, category)),
      );
  }
}

export const topicStore: TopicStore = new DrizzleTopicStore();

// Telegram's wording when a saved topic no longer exists or is closed.
export function isMissingTopicError(error: unknown): boolean {
  return (
    error instanceof TelegramDeliveryError &&
    error.status === 400 &&
    /thread not found|topic.{0,20}(closed|deleted|not found)/i.test(
      error.description ?? error.message,
    )
  );
}

export type TopicSender = (
  text: string,
  options?: SendTelegramMessageOptions,
) => Promise<void>;

// Sends a message the bot started by itself to its category's topic. Never
// fails because of topics: any topic problem falls back to the chat itself.
export async function sendToTopic(
  category: TopicCategory,
  text: string,
  options: SendTelegramMessageOptions = {},
  store: TopicStore = topicStore,
  send: TopicSender = sendTelegramMessage,
): Promise<void> {
  const chatId = String(options.chatId ?? telegramOwnerId());
  let threadId: number | undefined;
  try {
    threadId = (await store.all(chatId))[category];
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Topic lookup failed; sending to the chat itself (${type})`);
  }
  if (!threadId) return send(text, options);

  try {
    await send(text, { ...options, threadId });
  } catch (error) {
    if (!isMissingTopicError(error)) throw error;
    console.error(`Topic for ${category} is gone; sending to the chat itself`);
    try {
      await store.remove(chatId, category);
    } catch {
      // The next send will try the topic and fall back again.
    }
    await send(text, options);
  }
}

export const sendTo =
  (category: TopicCategory): TopicSender =>
  (text, options) =>
    sendToTopic(category, text, options);

type RawApi = { callApi(method: string, payload: object): Promise<unknown> };

export type TopicSetupResult =
  | { kind: "off" }
  | { kind: "ready"; created: TopicCategory[]; existing: TopicCategory[] };

// Creates any topic that is not saved yet. Safe to run again at any time.
export async function setUpTopics(
  api: RawApi,
  chatId: number,
  store: TopicStore = topicStore,
): Promise<TopicSetupResult> {
  const me = (await api.callApi("getMe", {})) as {
    has_topics_enabled?: boolean;
  };
  if (!me.has_topics_enabled) return { kind: "off" };

  const saved = await store.all(String(chatId));
  const created: TopicCategory[] = [];
  const existing: TopicCategory[] = [];
  for (const category of TOPIC_CATEGORIES) {
    if (saved[category]) {
      existing.push(category);
      continue;
    }
    const topic = (await api.callApi("createForumTopic", {
      chat_id: chatId,
      name: TOPIC_NAMES[category],
    })) as { message_thread_id?: number };
    if (!topic.message_thread_id) {
      throw new Error("Telegram did not return a topic id");
    }
    await store.save(String(chatId), category, topic.message_thread_id);
    created.push(category);
    await api.callApi("sendMessage", {
      chat_id: chatId,
      message_thread_id: topic.message_thread_id,
      text: TOPIC_INTROS[category],
    });
  }
  return { kind: "ready", created, existing };
}

const names = (categories: TopicCategory[]) =>
  categories.map((category) => TOPIC_NAMES[category]).join(", ");

export function describeTopicSetup(result: TopicSetupResult): string {
  if (result.kind === "off") {
    return "Topics are off for this bot. In @BotFather, tap Open, choose this bot, turn on Threaded mode in its settings, then send /topics again.";
  }
  const lines: string[] = [];
  if (result.created.length > 0) {
    lines.push(`Created: ${names(result.created)}.`);
  }
  if (result.existing.length > 0) {
    lines.push(`Already set up: ${names(result.existing)}.`);
  }
  lines.push(
    "I reply in whichever topic you write in. Reminders, briefs and check-ins go to Planner; the expenditure prompt and reports go to Expenditure.",
    "If you delete a topic, its messages go to the main chat until you send /topics again.",
  );
  return lines.join("\n");
}

export function registerTopicCommands(bot: Telegraf): void {
  bot.command("topics", async (ctx) => {
    try {
      const result = await setUpTopics(
        ctx.telegram as unknown as RawApi,
        ctx.chat.id,
      );
      await ctx.reply(describeTopicSetup(result));
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      const description = (error as { description?: unknown })?.description;
      console.error(
        `Topic setup failed (${type}${typeof description === "string" ? `: ${description.slice(0, 160)}` : ""})`,
      );
      await ctx.reply(
        "I couldn't set up the topics just now. Check that Threaded mode is on in @BotFather, then send /topics again.",
      );
    }
  });
}
