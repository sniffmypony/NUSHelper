import { Telegram } from "telegraf";
import { QUIET } from "../telegram-quiet.js";
import { runAssistant, type Attachment } from "../assistant/agent.js";
import { describeDocument, readDocument } from "../assistant/documents.js";
import {
  ASSISTANT_BUDGET_MS,
  chooseEffort,
  fallbackNote,
} from "../assistant/effort.js";
import {
  documentFileId,
  effortSetting,
  FALLBACK_MODEL_NOTE,
  inputFile,
  READ_ONLY_TOOLS,
  resolveClients,
  runWithFallbacks,
} from "../assistant/handlers.js";
import {
  assistantSettingsStore,
  telegramFileCacheStore,
} from "../assistant/store.js";
import {
  AssistantToolbox,
  MAX_IMAGES_PER_REQUEST,
} from "../assistant/tools.js";
import { keepUserSpelling } from "../assistant/user-spelling.js";
import { isCalendarConfigured } from "../calendar/config.js";
import { telegramBotToken, telegramOwnerId } from "../env.js";
import { calendarActions } from "./calendar-actions.js";
import { webBotActions, undoCards } from "./chat-actions.js";
import type { ChatCard } from "./chat-cards.js";
import type { Assist } from "./chat.js";

// The Telegram assistant, answering on the website. Canvas files it sends
// go to the owner's Telegram chat (they can be far larger than a website
// reply may be).

const SENT_TO_TELEGRAM = "_Files are sent to your Telegram chat._";

export const webAssist: Assist = async (input) => {
  const started = Date.now();
  const ownerId = telegramOwnerId();
  const { createCompletion, canvas, model, fallbackModel } = resolveClients({});
  const telegram = new Telegram(telegramBotToken());
  const chatId = Number(ownerId);
  const cards: ChatCard[] = [];
  const actions = webBotActions(ownerId, calendarActions, cards);
  const toolbox = new AssistantToolbox(
    canvas,
    {
      setUploading: () => {},
      sendDocuments: async (documents) => {
        if (documents.length === 1) {
          const message = await telegram.sendDocument(
            chatId,
            inputFile(documents[0]),
            QUIET,
          );
          return [documentFileId(message)];
        }
        const messages = await telegram.sendMediaGroup(
          chatId,
          documents.map((document) => ({
            type: "document" as const,
            media: inputFile(document),
          })),
          QUIET,
        );
        return Array.isArray(messages) ? messages.map(documentFileId) : [];
      },
    },
    undefined,
    actions,
    telegramFileCacheStore,
  );

  let attachment: Attachment | undefined;
  if (input.file) {
    const content = await readDocument(input.file.name, input.file.bytes, {
      mimeType: input.file.mimeType,
    });
    const images = content.images.slice(0, MAX_IMAGES_PER_REQUEST);
    attachment = { text: describeDocument({ ...content, images }), images };
  }
  const hasUpload = Boolean(input.image || input.file);
  const start = chooseEffort(
    await effortSetting(assistantSettingsStore, chatId),
    input.text,
    hasUpload,
  );

  let changedSomething = false;
  const now = new Date();
  const { result, used, activeModel } = await runWithFallbacks({
    model,
    fallbackModel,
    start,
    budgetMs: ASSISTANT_BUDGET_MS,
    started,
    changedSomething: () => changedSomething,
    attempt: ({ model: attemptModel, effort, signal }) =>
      runAssistant({
        create: createCompletion,
        model: attemptModel,
        history: input.history,
        userText: input.text,
        image: input.image,
        features: { canvas: Boolean(canvas), calendar: isCalendarConfigured() },
        attachment,
        takeImages: () => toolbox.takeImages(),
        execute: (name, args) => {
          if (!READ_ONLY_TOOLS.has(name)) changedSomething = true;
          return toolbox.execute(
            name,
            keepUserSpelling(name, args, input.text),
          );
        },
        now,
        effort,
        signal,
        onDraft: input.onDraft,
        onTool: input.onTool,
      }),
  });

  const filesSent = /\[send_files\]\nSent /.test(result.toolContext);
  const notes = [
    ...(activeModel !== model ? [FALLBACK_MODEL_NOTE] : []),
    ...(used !== start ? [fallbackNote(used, start)] : []),
  ];
  const reply = [
    ...notes,
    result.reply,
    ...(filesSent ? [SENT_TO_TELEGRAM] : []),
  ].join("\n\n");
  console.log(
    `Website assistant: total=${Date.now() - started}ms effort=${used} model=${result.timings.modelMs}ms/${result.timings.modelCalls} calls tools=${
      result.timings.tools.map((t) => t.name).join(",") || "none"
    }`,
  );
  return {
    reply,
    toolContext: result.toolContext,
    cards: [...cards, ...undoCards(toolbox.undo)],
  };
};
