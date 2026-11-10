import OpenAI from "openai";
import { waitUntil } from "@vercel/functions";
import type { Context, Telegraf } from "telegraf";
import { CanvasAuthError, CanvasClient } from "../canvas/client.js";
import { isCalendarConfigured } from "../calendar/config.js";
import { canvasConfig, isCanvasConfigured, llmConfig } from "../env.js";
import {
  runAssistant,
  type Attachment,
  type CreateCompletion,
  type ReplyFormat,
} from "./agent.js";
import {
  RICH_MESSAGE_CHUNK_SIZE,
  protectCurrency,
  splitTelegramMessage,
  toPlainText,
} from "./format.js";
import {
  assistantStore,
  telegramFileCacheStore,
  type AssistantStore,
  type TelegramFileCache,
} from "./store.js";
import type { OutgoingDocument } from "./file-sender.js";
import type { BotActions } from "./bot-tools.js";
import { undoKeyboard } from "./keyboards.js";
import { AssistantToolbox, MAX_IMAGES_PER_REQUEST } from "./tools.js";
import { describeDocument, documentKind, readDocument } from "./documents.js";

const MODEL_TIMEOUT_MS = 45_000;
const CHAT_ACTION_INTERVAL_MS = 4_500;

type ChatAction = "typing" | "upload_document";

export interface AssistantTelegram {
  sendMessage(
    chatId: number,
    text: string,
    extra?: { reply_markup: ReturnType<typeof undoKeyboard> },
  ): Promise<unknown>;
  sendChatAction(chatId: number, action: ChatAction): Promise<unknown>;
  // A string is a Telegram file id or a URL Telegram fetches itself.
  sendDocument(chatId: number, document: TelegramInputFile): Promise<unknown>;
  sendMediaGroup(
    chatId: number,
    media: Array<{ type: "document"; media: TelegramInputFile }>,
  ): Promise<unknown>;
  // Bot API 10.1 rich message: Markdown with $...$ / $$...$$ LaTeX.
  sendRichMessage(
    chatId: number,
    markdown: string,
    extra?: { reply_markup: ReturnType<typeof undoKeyboard> },
  ): Promise<unknown>;
  downloadFile(fileId: string): Promise<Buffer>;
}

type TelegramInputFile = string | { source: Buffer; filename: string };

// Telegraf predates rich messages, so sendRichMessage goes through its raw
// API call. The file link contains the bot token: it is fetched, never logged.
export function telegramFor(ctx: Context): AssistantTelegram {
  const api = ctx.telegram as unknown as Omit<
    AssistantTelegram,
    "sendRichMessage" | "downloadFile"
  > & {
    callApi(method: string, payload: object): Promise<unknown>;
    getFileLink(fileId: string): Promise<URL>;
  };
  return {
    sendMessage: (chatId, text, extra) => api.sendMessage(chatId, text, extra),
    sendChatAction: (chatId, action) => api.sendChatAction(chatId, action),
    sendDocument: (chatId, document) => api.sendDocument(chatId, document),
    sendMediaGroup: (chatId, media) => api.sendMediaGroup(chatId, media),
    sendRichMessage: (chatId, markdown, extra) =>
      api.callApi("sendRichMessage", {
        chat_id: chatId,
        rich_message: { markdown },
        ...extra,
      }),
    downloadFile: async (fileId) => {
      const response = await fetch(await api.getFileLink(fileId), {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(
          `Telegram file download failed: HTTP ${response.status}`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const description = (error as { description?: unknown })?.description;
  // Telegram's descriptions name the parse problem and offset, not the text.
  return typeof description === "string"
    ? `${name}: ${description.slice(0, 160)}`
    : name;
}

// Sends the reply, Markdown as rich messages so LaTeX renders. If Telegram
// rejects a rich message (bad Markdown, an older API), the rest is sent as
// plain text so the user always gets an answer.
export async function sendReply(
  telegram: AssistantTelegram,
  chatId: number,
  reply: string,
  format: ReplyFormat,
  keyboard: ReturnType<typeof undoKeyboard>,
): Promise<void> {
  const extraFor = (last: boolean) =>
    keyboard && last ? { reply_markup: keyboard } : undefined;

  if (format === "markdown") {
    const chunks = splitTelegramMessage(
      protectCurrency(reply),
      RICH_MESSAGE_CHUNK_SIZE,
    );
    for (const [index, chunk] of chunks.entries()) {
      try {
        await telegram.sendRichMessage(
          chatId,
          chunk,
          extraFor(index === chunks.length - 1),
        );
      } catch (error) {
        console.error(
          `Rich message rejected; sending plain text (${describeError(error)})`,
        );
        const rest = toPlainText(chunks.slice(index).join("\n"));
        return sendPlain(telegram, chatId, rest, extraFor);
      }
    }
    return;
  }
  return sendPlain(telegram, chatId, reply, extraFor);
}

async function sendPlain(
  telegram: AssistantTelegram,
  chatId: number,
  text: string,
  extraFor: (
    last: boolean,
  ) => { reply_markup: ReturnType<typeof undoKeyboard> } | undefined,
): Promise<void> {
  const chunks = splitTelegramMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    await telegram.sendMessage(
      chatId,
      chunk,
      extraFor(index === chunks.length - 1),
    );
  }
}

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
// Bots can only download files up to 20 MB from Telegram.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type IncomingImage =
  | { kind: "image"; fileId: string; mimeType: string }
  | { kind: "unsupported"; reason: string };

// A photo, or an image sent as a file (which keeps full resolution). Other
// documents are not for the assistant and return null.
export function imageFromMessage(message: unknown): IncomingImage | null {
  const value = message as {
    photo?: Array<{ file_id: string; file_size?: number }>;
    document?: { file_id: string; mime_type?: string; file_size?: number };
  };
  const tooBig = (size?: number) => (size ?? 0) > MAX_IMAGE_BYTES;

  if (value.photo?.length) {
    const largest = value.photo[value.photo.length - 1];
    return tooBig(largest.file_size)
      ? {
          kind: "unsupported",
          reason:
            "That image is over 20 MB, which is more than bots can download.",
        }
      : { kind: "image", fileId: largest.file_id, mimeType: "image/jpeg" };
  }

  const document = value.document;
  if (!document?.mime_type?.startsWith("image/")) return null;
  if (!SUPPORTED_IMAGE_TYPES.has(document.mime_type)) {
    return {
      kind: "unsupported",
      reason:
        "I can read JPG, PNG, WebP or GIF images. Try sending it as a photo instead.",
    };
  }
  if (tooBig(document.file_size)) {
    return {
      kind: "unsupported",
      reason: "That image is over 20 MB, which is more than bots can download.",
    };
  }
  return {
    kind: "image",
    fileId: document.file_id,
    mimeType: document.mime_type,
  };
}

export type IncomingAttachment =
  | { kind: "image"; fileId: string; mimeType: string }
  | { kind: "file"; fileId: string; name: string; mimeType: string };

// A photo or image (see imageFromMessage), or a document the assistant can
// read: PDF, PowerPoint, Word, text or code.
export function attachmentFromMessage(
  message: unknown,
): IncomingAttachment | { kind: "unsupported"; reason: string } | null {
  const image = imageFromMessage(message);
  if (image) return image;

  const document = (
    message as {
      document?: {
        file_id: string;
        file_name?: string;
        mime_type?: string;
        file_size?: number;
      };
    }
  ).document;
  if (!document) return null;
  const name = document.file_name ?? "file";
  const mimeType = document.mime_type ?? "";
  if (documentKind(name, mimeType) === "unsupported") {
    return {
      kind: "unsupported",
      reason:
        "I can read PDF, PowerPoint (.pptx), Word (.docx), text and code files, and images.",
    };
  }
  if ((document.file_size ?? 0) > MAX_IMAGE_BYTES) {
    return {
      kind: "unsupported",
      reason: "That file is over 20 MB, which is more than bots can download.",
    };
  }
  return { kind: "file", fileId: document.file_id, name, mimeType };
}

function inputFile(document: OutgoingDocument): TelegramInputFile {
  const { source } = document;
  if (source.kind === "cached") return source.fileId;
  if (source.kind === "url") return source.url;
  return { source: source.bytes, filename: document.filename };
}

function documentFileId(message: unknown): string | undefined {
  return (message as { document?: { file_id?: string } } | undefined)?.document
    ?.file_id;
}

export interface AssistantDependencies {
  store: AssistantStore;
  fileCache?: TelegramFileCache;
  // Lets the webhook answer Telegram immediately while the reply is produced.
  runInBackground: (work: Promise<unknown>) => void;
  createCompletion?: CreateCompletion;
  canvas?: CanvasClient;
  model?: string;
  now?: () => Date;
  // The bot's own task, to-do, reminder and calendar commands for this message.
  actionsFor?: (ctx: Context) => BotActions;
}

export const defaultAssistantDependencies: AssistantDependencies = {
  store: assistantStore,
  fileCache: telegramFileCacheStore,
  runInBackground: (work) => waitUntil(work),
};

class AssistantConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantConfigError";
  }
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export function assistantErrorMessage(error: unknown): string {
  if (error instanceof CanvasAuthError) {
    return "Canvas rejected the API token; it has probably expired. Create a new token in Canvas (Account > Settings > New access token) and update CANVAS_API_TOKEN in Vercel.";
  }
  if (error instanceof AssistantConfigError) {
    return "The Canvas assistant is not configured yet (missing environment variables).";
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return "The AI service took too long to respond. Please try again.";
  }
  if (error instanceof OpenAI.APIError) {
    return `The AI service returned an error${error.status ? ` (HTTP ${error.status})` : ""}. Please try again later.`;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Canvas took too long to respond. Please try again.";
  }
  return "Something went wrong while answering that. Please try again.";
}

function resolveClients(deps: AssistantDependencies): {
  createCompletion: CreateCompletion;
  canvas: CanvasClient | undefined;
  model: string;
} {
  let llm: { apiKey: string; baseURL: string; model: string } | undefined;
  let canvas = deps.canvas;
  try {
    if (!deps.createCompletion || !deps.model) llm = llmConfig();
    // Canvas is optional; without it the Canvas tools are not offered.
    if (!canvas && isCanvasConfigured()) {
      const config = canvasConfig();
      canvas = new CanvasClient(config.baseUrl, config.token);
    }
  } catch (error) {
    throw new AssistantConfigError(
      error instanceof Error ? error.message : "Missing configuration",
    );
  }

  let createCompletion = deps.createCompletion;
  if (!createCompletion) {
    const client = new OpenAI({
      apiKey: llm!.apiKey,
      baseURL: llm!.baseURL,
      timeout: MODEL_TIMEOUT_MS,
      maxRetries: 1,
    });
    createCompletion = (body) => client.chat.completions.create(body);
  }
  return { createCompletion, canvas, model: deps.model ?? llm!.model };
}

function startChatAction(telegram: AssistantTelegram, chatId: number) {
  let action: ChatAction = "typing";
  const send = () => {
    telegram.sendChatAction(chatId, action).catch(() => {
      // Chat actions are cosmetic.
    });
  };
  send();
  const timer = setInterval(send, CHAT_ACTION_INTERVAL_MS);
  return {
    set(next: ChatAction) {
      if (next === action) return;
      action = next;
      send();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

export async function answerAssistantMessage(
  telegram: AssistantTelegram,
  chatId: number,
  text: string,
  deps: AssistantDependencies,
  actions?: BotActions,
  attached?: IncomingAttachment,
): Promise<void> {
  const chatAction = startChatAction(telegram, chatId);
  const started = Date.now();
  try {
    const { createCompletion, canvas, model } = resolveClients(deps);
    const now = deps.now?.() ?? new Date();
    const toolbox = new AssistantToolbox(
      canvas,
      {
        setUploading: () => chatAction.set("upload_document"),
        sendDocuments: async (documents) => {
          try {
            if (documents.length === 1) {
              const message = await telegram.sendDocument(
                chatId,
                inputFile(documents[0]),
              );
              return [documentFileId(message)];
            }
            const messages = await telegram.sendMediaGroup(
              chatId,
              documents.map((document) => ({
                type: "document",
                media: inputFile(document),
              })),
            );
            return Array.isArray(messages) ? messages.map(documentFileId) : [];
          } finally {
            chatAction.set("typing");
          }
        },
      },
      deps.now,
      actions,
      deps.fileCache,
    );

    const history = await deps.store.recentTurns(String(chatId), now);
    const bytes = attached
      ? await telegram.downloadFile(attached.fileId)
      : undefined;
    const imageUrl =
      attached?.kind === "image" && bytes
        ? `data:${attached.mimeType};base64,${bytes.toString("base64")}`
        : undefined;
    let attachment: Attachment | undefined;
    if (attached?.kind === "file" && bytes) {
      const content = await readDocument(attached.name, bytes, {
        mimeType: attached.mimeType,
      });
      const images = content.images.slice(0, MAX_IMAGES_PER_REQUEST);
      attachment = {
        text: describeDocument({ ...content, images }),
        images,
      };
    }
    const result = await runAssistant({
      create: createCompletion,
      model,
      history,
      userText: text,
      image: imageUrl,
      features: { canvas: Boolean(canvas), calendar: isCalendarConfigured() },
      attachment,
      takeImages: () => toolbox.takeImages(),
      execute: (name, args) => toolbox.execute(name, args),
      now,
    });

    chatAction.stop();
    // Anything the assistant added gets an Undo button on the last message.
    await sendReply(
      telegram,
      chatId,
      result.reply,
      result.format,
      undoKeyboard(toolbox.undo),
    );
    // Durations and tool names only; never message text or file names.
    console.log(
      `Assistant timing: total=${Date.now() - started}ms model=${result.timings.modelMs}ms/${result.timings.modelCalls} calls tools=${
        result.timings.tools.map((t) => `${t.name}:${t.ms}ms`).join(",") ||
        "none"
      }`,
    );
    try {
      // Images and files are not kept; history notes that one was sent.
      const label =
        attached?.kind === "image"
          ? "[Photo]"
          : attached
            ? `[File: ${attached.name}]`
            : "";
      await deps.store.appendTurn(
        String(chatId),
        label ? `${label}${text ? ` ${text}` : ""}` : text,
        result.reply,
        result.toolContext,
      );
    } catch (error) {
      console.error(`Failed to save assistant history (${errorType(error)})`);
    }
  } catch (error) {
    console.error(`Canvas assistant failed (${errorType(error)})`);
    chatAction.stop();
    try {
      await telegram.sendMessage(chatId, assistantErrorMessage(error));
    } catch (replyError) {
      console.error(
        `Failed to send the assistant error message (${errorType(replyError)})`,
      );
    }
  } finally {
    chatAction.stop();
  }
}

export async function handleAssistantText(
  ctx: Context,
  text: string,
  deps: AssistantDependencies = defaultAssistantDependencies,
  attached?: IncomingAttachment,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || (!text.trim() && !attached)) return;

  // Telegram re-delivers an update if it thinks the webhook failed. The claim
  // makes every retry a no-op once the first delivery has started.
  if (!(await deps.store.claimUpdate(ctx.update.update_id))) return;

  deps.runInBackground(
    answerAssistantMessage(
      telegramFor(ctx),
      chatId,
      text.trim(),
      deps,
      deps.actionsFor?.(ctx),
      attached,
    ),
  );
}

export function registerAssistantHandlers(
  bot: Telegraf,
  deps: AssistantDependencies = defaultAssistantDependencies,
): void {
  // See registerCalendarHandlers for why the filter type is widened here.
  const on = bot.on.bind(bot) as unknown as (
    filter: string,
    handler: (ctx: Context) => Promise<void>,
  ) => void;

  on("text", async (ctx) => {
    const message = ctx.message;
    if (!message || !("text" in message) || message.text.startsWith("/"))
      return;
    // A reply to a file or photo (sent by the bot or the user) brings that
    // file along, so "solve Q2" can be asked right under the PDF.
    const replied = (message as { reply_to_message?: unknown })
      .reply_to_message;
    const attached = replied ? attachmentFromMessage(replied) : null;
    if (attached?.kind === "unsupported") {
      await ctx.reply(attached.reason);
      return;
    }
    await handleAssistantText(ctx, message.text, deps, attached ?? undefined);
  });

  // Photos, images sent as files, and readable documents; the caption is
  // the question.
  const onAttachment = async (ctx: Context) => {
    const attached = attachmentFromMessage(ctx.message);
    if (!attached) return;
    if (attached.kind === "unsupported") {
      await ctx.reply(attached.reason);
      return;
    }
    const caption = (ctx.message as { caption?: string }).caption ?? "";
    await handleAssistantText(ctx, caption, deps, attached);
  };
  on("photo", onAttachment);
  on("document", onAttachment);
}
