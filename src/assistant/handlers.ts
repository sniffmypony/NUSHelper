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
  assistantSettingsStore,
  assistantStore,
  telegramFileCacheStore,
  type AssistantSettings,
  type AssistantStore,
  type StoredAttachment,
  type TelegramFileCache,
} from "./store.js";
import type { OutgoingDocument } from "./file-sender.js";
import type { BotActions } from "./bot-tools.js";
import {
  undoKeyboard,
  withThinkHarder,
  type InlineKeyboard,
} from "./keyboards.js";
import { AssistantToolbox, MAX_IMAGES_PER_REQUEST } from "./tools.js";
import { describeDocument, documentKind, readDocument } from "./documents.js";
import {
  ASSISTANT_BUDGET_MS,
  EFFORT_HELP,
  attemptLimitMs,
  chooseEffort,
  describeEffortSetting,
  fallbackChain,
  fallbackNote,
  isEffortSetting,
  isStudyRequest,
  type Effort,
  type EffortSetting,
} from "./effort.js";
import { ModelTimeoutError, streamCompletion } from "./model-client.js";

const CHAT_ACTION_INTERVAL_MS = 4_500;
const PROGRESS_NOTE_MS = 20_000;
export const PROGRESS_NOTE = "Working on it — this one needs more thought…";
// Less than this left is not worth another attempt.
const MIN_ATTEMPT_MS = 10_000;
// Tools that only look things up. A timed-out attempt that ran only these is
// safe to repeat at a lower effort; anything else might be done twice.
const READ_ONLY_TOOLS = new Set([
  "list_modules",
  "list_upcoming_assignments",
  "search_files",
  "read_files",
  "list_tasks",
  "list_todos",
  "list_reminders",
  "list_calendar_events",
  "expenditure_report",
  "expenditure_breakdown",
]);

type ChatAction = "typing" | "upload_document";

export interface AssistantTelegram {
  sendMessage(
    chatId: number,
    text: string,
    extra?: { reply_markup: InlineKeyboard | undefined },
  ): Promise<unknown>;
  // Removes the progress note once the answer is sent.
  deleteMessage?(chatId: number, messageId: number): Promise<unknown>;
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
    extra?: { reply_markup: InlineKeyboard | undefined },
  ): Promise<unknown>;
  downloadFile(fileId: string): Promise<Buffer>;
}

type TelegramInputFile = string | { source: Buffer; filename: string };

// Telegraf predates rich messages, so sendRichMessage goes through its raw
// API call. The file link contains the bot token: it is fetched, never logged.
export function telegramFor(ctx: Context): AssistantTelegram {
  const api = ctx.telegram as unknown as Omit<
    AssistantTelegram,
    "sendRichMessage" | "downloadFile" | "deleteMessage"
  > & {
    deleteMessage(chatId: number, messageId: number): Promise<unknown>;
    callApi(method: string, payload: object): Promise<unknown>;
    getFileLink(fileId: string): Promise<URL>;
  };
  return {
    sendMessage: (chatId, text, extra) => api.sendMessage(chatId, text, extra),
    deleteMessage: (chatId, messageId) => api.deleteMessage(chatId, messageId),
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
  keyboard: InlineKeyboard | undefined,
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
  ) => { reply_markup: InlineKeyboard | undefined } | undefined,
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

export type IncomingAttachment = StoredAttachment;

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
  // The /effort setting and saved questions for "Think harder". Without it,
  // effort is always auto and no Think harder button is shown.
  settings?: AssistantSettings;
  // Total time one message may take, and when the progress note appears.
  budgetMs?: number;
  progressNoteMs?: number;
}

export const defaultAssistantDependencies: AssistantDependencies = {
  store: assistantStore,
  fileCache: telegramFileCacheStore,
  settings: assistantSettingsStore,
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
  if (error instanceof ModelTimeoutError) {
    return "The AI took too long to answer, even with less thinking. Try again, or ask one part at a time.";
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
    // Time limits come from each attempt's signal and the stream's idle
    // timeout. The retry covers brief connection failures and 5xx errors; a
    // timed-out attempt is never repeated at the same effort.
    const client = new OpenAI({
      apiKey: llm!.apiKey,
      baseURL: llm!.baseURL,
      timeout: ASSISTANT_BUDGET_MS,
      maxRetries: 1,
    });
    createCompletion = (body, options) =>
      streamCompletion(client, body, options);
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
  // "Think harder" asks for a set effort instead of the /effort setting.
  options: { effort?: Effort } = {},
): Promise<void> {
  const chatAction = startChatAction(telegram, chatId);
  const progress = startProgressNote(
    telegram,
    chatId,
    deps.progressNoteMs ?? PROGRESS_NOTE_MS,
  );
  const started = Date.now();
  const budgetMs = deps.budgetMs ?? ASSISTANT_BUDGET_MS;
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
    const study = isStudyRequest(text, Boolean(attached));
    const start =
      options.effort ??
      chooseEffort(
        await effortSetting(deps.settings, chatId),
        text,
        Boolean(attached),
      );

    // Each level gets a time limit; one that runs out falls back to the next
    // lower level, unless the attempt already did something (added a to-do,
    // sent a file) that repeating would do twice.
    let changedSomething = false;
    const execute = (name: string, args: string) => {
      if (!READ_ONLY_TOOLS.has(name)) changedSomething = true;
      return toolbox.execute(name, args);
    };
    let result: Awaited<ReturnType<typeof runAssistant>> | undefined;
    let used: Effort = start;
    for (const level of fallbackChain(start)) {
      const remaining = budgetMs - (Date.now() - started);
      const limit = attemptLimitMs(start, level, remaining);
      if (limit < MIN_ATTEMPT_MS) throw new ModelTimeoutError();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limit);
      const attemptStarted = Date.now();
      try {
        result = await runAssistant({
          create: createCompletion,
          model,
          history,
          userText: text,
          image: imageUrl,
          features: {
            canvas: Boolean(canvas),
            calendar: isCalendarConfigured(),
          },
          attachment,
          takeImages: () => toolbox.takeImages(),
          execute,
          now,
          effort: level,
          signal: controller.signal,
        });
        used = level;
        break;
      } catch (error) {
        if (
          !(error instanceof ModelTimeoutError) ||
          changedSomething ||
          level === "low"
        ) {
          throw error;
        }
        console.log(
          `Assistant ${level} effort ran out of time after ${Date.now() - attemptStarted}ms; trying less effort`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
    if (!result) throw new ModelTimeoutError();

    const reply =
      used === start
        ? result.reply
        : `${result.format === "markdown" ? fallbackNote(used, start) : fallbackNote(used, start).replace(/_/g, "")}\n\n${result.reply}`;
    // A study answer that wasn't at high effort can be asked again harder.
    // If high itself ran out of time, the button would only fail again.
    const requestId =
      study && start !== "high" && result.format === "markdown"
        ? await saveRequest(deps.settings, chatId, text, attached)
        : undefined;

    chatAction.stop();
    progress.stop();
    // Anything the assistant added gets an Undo button on the last message.
    await sendReply(
      telegram,
      chatId,
      reply,
      result.format,
      withThinkHarder(undoKeyboard(toolbox.undo), requestId),
    );
    await progress.remove();
    // Durations, effort and tool names only; never message text or file names.
    console.log(
      `Assistant timing: total=${Date.now() - started}ms effort=${used}${used === start ? "" : ` (from ${start})`} model=${result.timings.modelMs}ms/${result.timings.modelCalls} calls tools=${
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
    console.error(
      `Canvas assistant failed (${errorType(error)}) after ${Date.now() - started}ms`,
    );
    chatAction.stop();
    progress.stop();
    try {
      await telegram.sendMessage(chatId, assistantErrorMessage(error));
    } catch (replyError) {
      console.error(
        `Failed to send the assistant error message (${errorType(replyError)})`,
      );
    }
    await progress.remove();
  } finally {
    chatAction.stop();
    progress.stop();
  }
}

async function effortSetting(
  settings: AssistantSettings | undefined,
  chatId: number,
): Promise<EffortSetting> {
  try {
    return (await settings?.effort(String(chatId))) ?? "auto";
  } catch (error) {
    // The setting is a preference; auto still answers well.
    console.error(`Failed to read the effort setting (${errorType(error)})`);
    return "auto";
  }
}

async function saveRequest(
  settings: AssistantSettings | undefined,
  chatId: number,
  text: string,
  attachment: IncomingAttachment | undefined,
): Promise<number | undefined> {
  if (!settings) return undefined;
  try {
    return await settings.saveRequest(String(chatId), { text, attachment });
  } catch (error) {
    // Without it there is just no Think harder button.
    console.error(`Failed to save the request (${errorType(error)})`);
    return undefined;
  }
}

function messageIdOf(message: unknown): number | undefined {
  const id = (message as { message_id?: unknown } | undefined)?.message_id;
  return typeof id === "number" ? id : undefined;
}

// After a while, a short note says the answer is still coming; it is
// deleted once the answer (or an error) has been sent.
function startProgressNote(
  telegram: AssistantTelegram,
  chatId: number,
  delayMs: number,
) {
  let sent: Promise<number | undefined> | undefined;
  const timer = setTimeout(() => {
    sent = telegram
      .sendMessage(chatId, PROGRESS_NOTE)
      .then(messageIdOf)
      .catch(() => undefined);
  }, delayMs);
  return {
    stop() {
      clearTimeout(timer);
    },
    async remove() {
      const messageId = await sent;
      if (messageId === undefined || !telegram.deleteMessage) return;
      try {
        await telegram.deleteMessage(chatId, messageId);
      } catch {
        // Leaving the note behind is harmless.
      }
    },
  };
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

  bot.command("effort", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const settings = deps.settings;
    if (!settings) {
      await ctx.reply("Thinking effort can't be changed on this bot.");
      return;
    }
    const argument = ctx.message.text.split(/\s+/)[1]?.toLowerCase() ?? "";
    try {
      if (!argument) {
        const current = await settings.effort(chatId);
        await ctx.reply(`${describeEffortSetting(current)}\n\n${EFFORT_HELP}`);
        return;
      }
      if (!isEffortSetting(argument)) {
        await ctx.reply(EFFORT_HELP);
        return;
      }
      await settings.setEffort(chatId, argument);
      await ctx.reply(
        argument === "high"
          ? `${describeEffortSetting(argument)} Replies can take a few minutes; if one runs out of time, I answer with less thinking.`
          : describeEffortSetting(argument),
      );
    } catch (error) {
      console.error(`Effort setting failed (${errorType(error)})`);
      await ctx.reply("Couldn't save that setting just now. Please try again.");
    }
  });

  // Re-runs a saved study question at high effort.
  bot.action(/^ai:think:(\d{1,10})$/, async (ctx) => {
    try {
      await ctx.answerCbQuery("Thinking harder…");
    } catch {
      // Telegram may retry an old callback after its acknowledgement window.
    }
    const chatId = ctx.chat?.id;
    const id = Number(ctx.match[1]);
    if (!chatId || !deps.settings || !Number.isSafeInteger(id)) return;
    if (!(await deps.store.claimUpdate(ctx.update.update_id))) return;

    // One press per answer: the button goes, other buttons stay.
    const keyboard = (
      ctx.callbackQuery as { message?: { reply_markup?: InlineKeyboard } }
    ).message?.reply_markup;
    const rows = (keyboard?.inline_keyboard ?? []).filter(
      (row) => !row.some((button) => button.callback_data === ctx.match[0]),
    );
    try {
      await ctx.editMessageReplyMarkup(
        rows.length > 0 ? { inline_keyboard: rows } : undefined,
      );
    } catch {
      // The message may be too old to edit.
    }

    const request = await deps.settings.findRequest(String(chatId), id);
    if (!request) {
      await ctx.reply(
        "That question is too old to ask again. Please send it again.",
      );
      return;
    }
    deps.runInBackground(
      answerAssistantMessage(
        telegramFor(ctx),
        chatId,
        request.text,
        deps,
        deps.actionsFor?.(ctx),
        request.attachment,
        { effort: "high" },
      ),
    );
  });

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
