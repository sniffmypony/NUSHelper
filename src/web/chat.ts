import type { AssistantTurn } from "../assistant/agent.js";
import type { ChatCard } from "./chat-cards.js";
import type { ChatMessage, ChatStore } from "./chat-store.js";

// One website chat message, start to finish: save it, ask the assistant
// (the same one as on Telegram), save the reply. Progress is sent to the
// page as it happens, as newline-separated JSON events.

export type ChatEvent =
  | { type: "user"; message: ChatMessageView }
  | { type: "status"; text: string }
  | { type: "draft"; text: string }
  | { type: "done"; message: ChatMessageView; title: string };

export interface ChatMessageView {
  id: number;
  role: "user" | "assistant";
  content: string;
  cards: ChatCard[];
  failed: boolean;
  createdAt: string;
}

export function messageView(message: ChatMessage): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    cards: message.cards,
    failed: message.failed,
    createdAt: message.createdAt.toISOString(),
  };
}

export interface ChatUpload {
  // A photo as a data URL (the page shrinks it first), or a file's bytes.
  image?: string;
  file?: { name: string; mimeType: string; bytes: Buffer };
}

export interface AssistInput extends ChatUpload {
  history: AssistantTurn[];
  text: string;
  onDraft: (text: string) => void;
  onTool: (name: string) => void;
}

export interface AssistOutput {
  reply: string;
  toolContext: string;
  cards: ChatCard[];
}

export type Assist = (input: AssistInput) => Promise<AssistOutput>;

export const NEW_CHAT_TITLE = "New chat";

// Messages sent back to the model with each new one (as on Telegram, where
// the last week is kept).
export const HISTORY_MESSAGES = 20;
const TITLE_LENGTH = 60;
// The draft is sent at most this often.
const DRAFT_EVERY_MS = 150;

// Readable names for the tools, shown while they run.
const TOOL_STATUS: Record<string, string> = {
  list_modules: "Checking Canvas modules",
  list_upcoming_assignments: "Checking Canvas deadlines",
  search_files: "Searching Canvas files",
  read_files: "Reading files",
  send_files: "Sending files to Telegram",
  list_calendar_events: "Reading Google Calendar",
  expenditure_report: "Adding up spending",
  expenditure_breakdown: "Adding up spending",
};

export function chatTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return NEW_CHAT_TITLE;
  return line.length > TITLE_LENGTH
    ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`
    : line;
}

export function uploadLabel(upload: ChatUpload): string {
  if (upload.image) return "[Photo]";
  if (upload.file) return `[File: ${upload.file.name}]`;
  return "";
}

export async function sendChatMessage(options: {
  store: ChatStore;
  assist: Assist;
  errorMessage: (error: unknown) => string;
  chatId: number;
  title: string;
  text: string;
  upload: ChatUpload;
  emit: (event: ChatEvent) => void;
}): Promise<void> {
  const { store, chatId, text, upload, emit } = options;

  // Photos and files are never stored; the message notes that one was sent.
  const label = uploadLabel(upload);
  const userMessage = await store.add(chatId, {
    role: "user",
    content: label ? `${label}${text ? ` ${text}` : ""}` : text,
  });
  let title = options.title;
  if (title === NEW_CHAT_TITLE) {
    title = chatTitle(text || label.replace(/^\[|\]$/g, ""));
    await store.update(chatId, { title });
  }
  emit({ type: "user", message: messageView(userMessage) });
  emit({ type: "status", text: "Thinking" });

  // Earlier failed replies are left out: they'd only confuse the model.
  const history = (await store.recent(chatId, userMessage.id, HISTORY_MESSAGES))
    .filter((message) => !message.failed)
    .map((message) => ({
      role: message.role,
      content: message.content,
      toolContext: message.toolContext,
    }));

  let lastDraft = 0;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (pending === null) return;
    emit({ type: "draft", text: pending });
    pending = null;
    lastDraft = Date.now();
  };

  let reply: ChatMessage;
  try {
    const output = await options.assist({
      history,
      text,
      ...upload,
      onDraft: (draft) => {
        pending = draft;
        if (timer) return;
        timer = setTimeout(
          flush,
          Math.max(0, DRAFT_EVERY_MS - (Date.now() - lastDraft)),
        );
      },
      onTool: (name) => {
        emit({ type: "status", text: TOOL_STATUS[name] ?? "Working" });
      },
    });
    reply = await store.add(chatId, {
      role: "assistant",
      content: output.reply,
      toolContext: output.toolContext,
      cards: output.cards,
    });
  } catch (error) {
    reply = await store.add(chatId, {
      role: "assistant",
      content: options.errorMessage(error),
      failed: true,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  emit({ type: "done", message: messageView(reply), title });
}
