import { documentKind } from "../assistant/documents.js";
import { applyCard, CardError, type CardExecutors } from "./chat-cards.js";
import type { ChatStore } from "./chat-store.js";
import {
  messageView,
  sendChatMessage,
  type Assist,
  type ChatEvent,
  type ChatUpload,
} from "./chat.js";

// The website's chat API, called by the router after sign-in.

export interface ChatDependencies {
  store: ChatStore;
  assist: Assist;
  cards: CardExecutors;
  errorMessage: (error: unknown) => string;
}

export type ChatResponse =
  | { status: number; body: unknown }
  | {
      status: 200;
      stream: (emit: (event: ChatEvent) => void) => Promise<void>;
    };

const MAX_TEXT = 8000;
const MAX_TITLE = 120;
// A request body may be at most 4.5 MB on Vercel; base64 adds a third.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const IMAGE_DATA_URL =
  /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const bad = (error: string) => ({ status: 400, body: { error } });
const notFound = { status: 404, body: { error: "That chat is gone." } };

function field(body: unknown, name: string): unknown {
  return (body as Record<string, unknown> | null)?.[name];
}

function id(raw: string): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : null;
}

// What was uploaded with a message, or an error to show.
export function parseUpload(body: unknown): ChatUpload | string {
  const image = field(body, "image");
  const file = field(body, "file") as Record<string, unknown> | undefined;
  if (image !== undefined && file !== undefined) {
    return "Send one photo or one file at a time.";
  }
  if (image !== undefined) {
    if (typeof image !== "string" || !IMAGE_DATA_URL.test(image)) {
      return "That photo couldn't be read.";
    }
    if ((image.length * 3) / 4 > MAX_UPLOAD_BYTES) {
      return "That photo is too large.";
    }
    return { image };
  }
  if (file !== undefined) {
    const name = file?.name;
    const mimeType = file?.mimeType ?? "";
    const data = file?.data;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 200 ||
      typeof mimeType !== "string" ||
      mimeType.length > 100 ||
      typeof data !== "string" ||
      !BASE64.test(data)
    ) {
      return "That file couldn't be read.";
    }
    if (documentKind(name, mimeType) === "unsupported") {
      return "That kind of file can't be read. Try a PDF, PowerPoint, Word, text or image file.";
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return "Files can be at most 3 MB here. Send larger ones to the bot on Telegram.";
    }
    return { file: { name: name.trim(), mimeType, bytes } };
  }
  return {};
}

export async function chatRoute(
  method: string,
  route: string,
  body: unknown,
  deps: ChatDependencies,
  search?: string,
): Promise<ChatResponse | null> {
  if (route === "chats") {
    if (method === "GET") {
      const chats = await deps.store.list(search?.slice(0, 200));
      return { status: 200, body: { chats } };
    }
    if (method === "POST") {
      return { status: 200, body: { chat: await deps.store.create() } };
    }
    return null;
  }

  const chatMatch = /^chats\/(\d{1,10})(?:\/(.*))?$/.exec(route);
  if (!chatMatch) return null;
  const chatId = id(chatMatch[1]);
  if (chatId === null) return notFound;
  const rest = chatMatch[2] ?? "";

  if (rest === "") {
    if (method === "GET") {
      const chat = await deps.store.get(chatId);
      if (!chat) return notFound;
      const messages = await deps.store.messages(chatId);
      return {
        status: 200,
        body: { chat, messages: messages.map(messageView) },
      };
    }
    if (method === "PATCH") {
      const change: { title?: string; pinned?: boolean } = {};
      const title = field(body, "title");
      const pinned = field(body, "pinned");
      if (title !== undefined) {
        if (typeof title !== "string" || !title.trim()) {
          return bad("Give the chat a name.");
        }
        change.title = title.trim().slice(0, MAX_TITLE);
      }
      if (pinned !== undefined) {
        if (typeof pinned !== "boolean") return bad("Pin must be on or off.");
        change.pinned = pinned;
      }
      if (Object.keys(change).length === 0) return bad("Nothing to change.");
      return (await deps.store.update(chatId, change))
        ? { status: 200, body: { ok: true } }
        : notFound;
    }
    if (method === "DELETE") {
      return (await deps.store.remove(chatId))
        ? { status: 200, body: { ok: true } }
        : notFound;
    }
    return null;
  }

  if (rest === "messages" && method === "POST") {
    const rawText = field(body, "text") ?? "";
    if (typeof rawText !== "string" || rawText.length > MAX_TEXT) {
      return bad(`Messages can be up to ${MAX_TEXT} characters.`);
    }
    const text = rawText.trim();
    const upload = parseUpload(body);
    if (typeof upload === "string") return bad(upload);
    if (!text && !upload.image && !upload.file) return bad("Type a message.");
    const chat = await deps.store.get(chatId);
    if (!chat) return notFound;
    return {
      status: 200,
      stream: (emit) =>
        sendChatMessage({
          store: deps.store,
          assist: deps.assist,
          errorMessage: deps.errorMessage,
          chatId,
          title: chat.title,
          text,
          upload,
          emit,
        }),
    };
  }

  const cardMatch = /^messages\/(\d{1,10})\/cards\/(\d{1,2})$/.exec(rest);
  if (cardMatch && method === "POST") {
    const action = field(body, "action");
    if (action !== "confirm" && action !== "cancel") {
      return bad("Choose confirm or cancel.");
    }
    const messageId = id(cardMatch[1]);
    const index = Number(cardMatch[2]);
    const message =
      messageId === null ? null : await deps.store.message(chatId, messageId);
    const card = message?.cards[index];
    if (!message || !card) {
      return { status: 404, body: { error: "That card is gone." } };
    }
    try {
      const updated = await applyCard(card, action, deps.cards);
      const cards = message.cards.map((c, i) => (i === index ? updated : c));
      await deps.store.setCards(message.id, cards);
      return { status: 200, body: { card: updated } };
    } catch (error) {
      if (error instanceof CardError) {
        return { status: 409, body: { error: error.message } };
      }
      throw error;
    }
  }

  return null;
}
