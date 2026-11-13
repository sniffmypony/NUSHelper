import type { Context } from "telegraf";

// Kept apart from topics.ts so code that only needs to know where a message
// came from does not pull in the database.

// The topic a message or button press came from, if any.
export function threadIdOf(ctx: Context): number | undefined {
  const message = ctx.msg as
    { is_topic_message?: boolean; message_thread_id?: number } | undefined;
  return message?.is_topic_message ? message.message_thread_id : undefined;
}

// The assistant remembers each topic's conversation separately. The chat
// itself keeps the key it always had, so earlier history stays attached.
export function conversationKey(chatId: number, threadId?: number): string {
  return threadId ? `${chatId}:${threadId}` : String(chatId);
}
