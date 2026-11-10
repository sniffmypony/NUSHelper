import { Telegraf, type Context } from "telegraf";
import { db } from "./db/client.js";
import { morningAcknowledgements } from "./db/schema.js";
import { isValidIsoDate, todayInSingapore } from "./dates.js";
import { telegramBotToken, telegramOwnerId } from "./env.js";
import * as actions from "./bot-actions.js";
import {
  listCalendarEvents,
  registerCalendarHandlers,
  requestCalendarEventDeletion,
  stageCalendarMessage,
} from "./calendar/handlers.js";
import { looksLikeCalendarMessage } from "./calendar/parser.js";
import {
  defaultAssistantDependencies,
  registerAssistantHandlers,
} from "./assistant/handlers.js";
import {
  registerAssistantButtons,
  requestDeletion,
} from "./assistant/buttons.js";
import { isPrivateOwner } from "./security.js";
import {
  parseReminderCommandLine,
  parseTodoCommandLine,
  splitMessageLines,
  type ParsedReminderCommand,
} from "./message-lines.js";
import { sendTelegramMessage } from "./telegram.js";
import { splitTelegramMessage } from "./assistant/format.js";
import {
  formatCurrency,
  formatLongDate,
  formatMonthlyReport,
  isDateEditable,
  parseExpenditureAmounts,
  parseExpenditureBreakdownCommand,
  parseMonthlyExpenditureQuery,
  shouldSendReportsNow,
} from "./expenditure.js";
import { expenditureStore } from "./expenditure-store.js";
import {
  expenditureConfirmation,
  expenditureKeyboard,
  processCompletedExpenditureDay,
} from "./expenditure-service.js";

const ownerIdValue = telegramOwnerId();
const OWNER_ID = Number(ownerIdValue);
if (
  !/^\d+$/.test(ownerIdValue) ||
  !Number.isSafeInteger(OWNER_ID) ||
  OWNER_ID <= 0
) {
  throw new Error(
    "TELEGRAM_OWNER_ID must be a positive numeric Telegram user ID",
  );
}

export const bot = new Telegraf(telegramBotToken());

// Gatekeeper for every command, message, edit, and callback. Other users are
// ignored silently so the bot does not confirm its existence to strangers.
bot.use(async (ctx, next) => {
  if (!isPrivateOwner(ctx.from?.id, ctx.chat?.type, OWNER_ID)) return;
  return next();
});

function parseTaskId(
  messageText: string,
  command: "done" | "remove",
): number | null {
  const rawId = messageText
    .replace(new RegExp(`^/${command}(@\\w+)?`), "")
    .trim();
  if (!/^\d+$/.test(rawId)) return null;

  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

async function addTodo(ctx: Context, description: string): Promise<void> {
  await ctx.reply((await actions.addTodo(description)).message);
}

async function addReminder(
  ctx: Context,
  command: ParsedReminderCommand,
  sourceMessageId: number,
  sourceLine: number,
): Promise<boolean> {
  if (!ctx.chat) return false;
  const confirmation = await actions.addReminder(command, {
    ownerId: ownerIdValue,
    chatId: String(ctx.chat.id),
    sourceMessageId,
    sourceLine,
  });
  if (!confirmation) return false;
  await ctx.reply(confirmation.message);
  return true;
}

function looksLikeExpenditureAttempt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  if (parseExpenditureAmounts(trimmed) !== null) return true;
  if (/^\d{1,4}(?::\d{2})?\s*-\s*\d/.test(trimmed)) return false;
  return /^(?:S\$|\$|[-+]?\d)/i.test(trimmed);
}

// Applies amounts through the open input session and sends the usual dated
// confirmation with Add/Remove buttons. Returns the confirmation text, or null
// when nothing was recorded silently (expired session or a Telegram retry).
async function applyExpenditure(
  ctx: Context,
  sourceMessageId: number,
  amountCents: number,
  now: Date,
): Promise<string | null> {
  const result = await expenditureStore.applyInput(
    ownerIdValue,
    String(ctx.chat?.id ?? ""),
    sourceMessageId,
    amountCents,
    now,
  );
  if (result.kind === "inactive" || result.kind === "duplicate") return null;
  if (result.kind === "negative") {
    const message = `Cannot remove ${formatCurrency(amountCents)} from ${formatLongDate(result.spendDate)} because the total is only ${formatCurrency(result.totalCents)}.`;
    await ctx.reply(message);
    return message;
  }

  const confirmation = expenditureConfirmation(
    result.spendDate,
    result.totalCents,
  );
  await ctx.reply(confirmation, {
    reply_markup: expenditureKeyboard(result.spendDate),
  });
  if (shouldSendReportsNow(result.spendDate, now)) {
    await processCompletedExpenditureDay(
      result.spendDate,
      sendTelegramMessage,
      expenditureStore,
      now,
    );
  }
  return confirmation;
}

// An active expenditure session consumes numeric-style replies. Outside one, a
// message of only amounts (e.g. "5 7 13.2") is added to today's total, the
// same as pressing Add amount on today's entry. Anything else continues
// through the existing handlers.
bot.use(async (ctx, next) => {
  const message = ctx.message;
  if (!message || !("text" in message) || !ctx.chat) return next();

  const now = new Date();
  const chatId = String(ctx.chat.id);
  const session = await expenditureStore.getActiveSession(
    ownerIdValue,
    chatId,
    now,
  );
  const amountCents = parseExpenditureAmounts(message.text);
  if (!session) {
    if (amountCents === null) return next();
    await expenditureStore.openEditSession(
      ownerIdValue,
      chatId,
      todayInSingapore(now),
      "add",
      now,
    );
  } else if (!looksLikeExpenditureAttempt(message.text)) {
    return next();
  }

  if (amountCents === null) {
    await ctx.reply(
      "Invalid expenditure. Send only non-negative amounts with up to two decimal places, separated by spaces, commas, or new lines.",
    );
    return;
  }
  await applyExpenditure(ctx, message.message_id, amountCents, now);
});

// Telegram treats only the first command entity as a command. Intercept
// multi-line messages first so every non-empty line can be validated in order.
bot.use(async (ctx, next) => {
  const newMessage = ctx.message;
  const editedMessage = ctx.editedMessage;
  const message =
    newMessage && "text" in newMessage
      ? newMessage
      : editedMessage && "text" in editedMessage
        ? editedMessage
        : null;

  if (!message || !/\r?\n/.test(message.text)) return next();

  const isEdited = Boolean(editedMessage);
  const lines = splitMessageLines(message.text);
  // A multi-line message with no command or calendar line is a question for
  // the Canvas assistant rather than a batch of invalid lines.
  if (
    !isEdited &&
    lines.every(
      (line) =>
        !line.text.startsWith("/") && !looksLikeCalendarMessage(line.text),
    )
  ) {
    return next();
  }

  const rejected: number[] = [];
  for (const line of lines) {
    const todo = isEdited ? null : parseTodoCommandLine(line.text);
    if (todo) {
      await addTodo(ctx, todo);
      continue;
    }

    const reminder = isEdited ? null : parseReminderCommandLine(line.text);
    if (
      reminder &&
      (await addReminder(ctx, reminder, message.message_id, line.sourceLine))
    ) {
      continue;
    }

    if (
      !line.text.startsWith("/") &&
      (await stageCalendarMessage(
        ctx,
        line.text,
        message.message_id,
        line.sourceLine,
        ownerIdValue,
        false,
      ))
    ) {
      continue;
    }

    rejected.push(line.lineNumber);
  }

  if (rejected.length > 0) {
    await ctx.reply(
      `Skipped invalid ${rejected.length === 1 ? "line" : "lines"}: ${rejected.join(", ")}.`,
    );
  }
});

bot.command("task", async (ctx) => {
  const input = ctx.message.text.replace(/^\/task(@\w+)?/, "").trim();
  if (!input) {
    return ctx.reply(
      "Usage: /task <description> #MODULE @YYYY-MM-DD\ne.g. /task Finish ER diagram #CS2102 @2026-08-25",
    );
  }
  return ctx.reply((await actions.addTask(input)).message);
});

bot.command("remove", async (ctx) => {
  const id = parseTaskId(ctx.message.text, "remove");
  if (id === null) return ctx.reply("Usage: /remove <positive numeric id>");
  return ctx.reply(await actions.removeTask(id));
});

bot.command("done", async (ctx) => {
  const id = parseTaskId(ctx.message.text, "done");
  if (id === null) return ctx.reply("Usage: /done <positive numeric id>");
  return ctx.reply(await actions.completeTask(id));
});

bot.command("list", async (ctx) => ctx.reply(await actions.listOpenTasks()));

bot.command("todo", async (ctx) => {
  const description = parseTodoCommandLine(ctx.message.text);
  if (!description) return ctx.reply("Usage: /todo <description>");
  return addTodo(ctx, description);
});

bot.command("remind", async (ctx) => {
  const command = parseReminderCommandLine(ctx.message.text);
  if (!command) {
    return ctx.reply(
      "Usage: /remind HHMM <description>\ne.g. /remind 1800 do tutorial",
    );
  }
  if (!(await addReminder(ctx, command, ctx.message.message_id, 0))) {
    return ctx.reply(
      "That time has already passed today. Please choose a later Singapore time.",
    );
  }
});

bot.command("todos", async (ctx) => ctx.reply(await actions.listTodayTodos()));

bot.command("help", (ctx) => {
  return ctx.reply(
    [
      "📋 Tasks — long-term, shows in the weekly Monday digest",
      "/task <description> #MODULE @YYYY-MM-DD — add",
      "/list — show open tasks",
      "/done <id> — mark complete",
      "/remove <id> — delete",
      "",
      "✅ Today's to-dos — cleared nightly at ~11pm",
      "/todo <description> — add",
      "/todos — show today's list",
      "",
      "⏰ Same-day reminders (Singapore time)",
      "/remind HHMM <description> — e.g. /remind 1800 do tutorial",
      "",
      "💰 Expenditure (Singapore time)",
      "Reply to the 11:30pm expenditure: prompt with amounts separated by spaces, commas, or new lines.",
      "Send only amounts (e.g. 5 3.9) at any other time to add them to today's total.",
      "Use Add amount / Remove amount on a dated confirmation to correct it within 365 days.",
      "Weekly reports arrive after Sunday's entry; month-end reports arrive after the final day's entry.",
      "<full month> <year> expenditure — e.g. june 2027 expenditure",
      "/expenditure DD-MM-YYYY DD-MM-YYYY — spending on each day of a date range",
      "",
      "📅 Google Calendar",
      "Send: 12:00-18:00, Homework, 22-08-2026",
      "Only DD-MM-YYYY is accepted.",
      "You can send multiple /todo, /remind, or calendar lines in one message.",
      "Invalid lines are skipped; valid later lines still run.",
      "You will be asked to confirm before anything is created or changed.",
      "",
      "🎓 Canvas assistant — any other message",
      "e.g. what's due this week? / send me the lecture 5 slides for CS2103T",
      "/effort — how hard it thinks: auto (default), low, medium or high",
      "Study answers have a Think harder button to ask again at high effort.",
      "",
      "/help — show this message",
    ].join("\n"),
  );
});

bot.command("start", (ctx) =>
  ctx.reply("Task bot ready. Send /help to see what I can do."),
);

bot.action(/^morning:done:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  const acknowledgementDate = ctx.match[1];
  await ctx.answerCbQuery();
  if (!isValidIsoDate(acknowledgementDate)) return;

  const callbackMessage = (
    ctx.callbackQuery as unknown as { message?: { message_id?: number } }
  ).message;
  const messageId = callbackMessage?.message_id ?? null;
  const inserted = await db
    .insert(morningAcknowledgements)
    .values({ ownerId: ownerIdValue, acknowledgementDate, messageId })
    .onConflictDoNothing({
      target: [
        morningAcknowledgements.ownerId,
        morningAcknowledgements.acknowledgementDate,
      ],
    })
    .returning({ id: morningAcknowledgements.id });

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {
    // A retried callback may arrive after the button was already removed.
  }

  if (inserted.length > 0) {
    await sendTelegramMessage("Done", { silent: true, chatId: OWNER_ID });
  }
});

bot.action(/^exp:(add|remove):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  const mode = ctx.match[1] as "add" | "remove";
  const spendDate = ctx.match[2];
  await ctx.answerCbQuery();
  if (!isValidIsoDate(spendDate)) return;
  if (!isDateEditable(spendDate)) {
    await ctx.reply(
      "That expenditure entry is more than 365 days old and can no longer be edited.",
    );
    return;
  }
  await expenditureStore.openEditSession(
    ownerIdValue,
    ownerIdValue,
    spendDate,
    mode,
    new Date(),
  );
  await ctx.reply(
    `${mode === "add" ? "Add to" : "Remove from"} ${formatLongDate(spendDate)}: send the amount(s) within 15 minutes.`,
  );
});

bot.command("expenditure", async (ctx) => {
  const period = parseExpenditureBreakdownCommand(ctx.message.text);
  if (!period) {
    return ctx.reply(
      "Usage: /expenditure DD-MM-YYYY DD-MM-YYYY\ne.g. /expenditure 03-12-2026 15-12-2026",
    );
  }
  const report = await actions.expenditureBreakdown(period.start, period.end);
  for (const chunk of splitTelegramMessage(report)) await ctx.reply(chunk);
});

bot.hears(/^\s*[a-z]+\s+\d{4}\s+expenditure\s*$/i, async (ctx) => {
  const text = (ctx.message as { text?: string } | undefined)?.text;
  if (!text) return;
  const query = parseMonthlyExpenditureQuery(text);
  if (!query) {
    await ctx.reply(
      "Use a full English month and four-digit year, e.g. june 2027 expenditure.",
    );
    return;
  }
  const days = await expenditureStore.daysInRange(query.start, query.end);
  if (days.length === 0) {
    await ctx.reply(`No expenditure data is stored for ${query.label}.`);
    return;
  }
  await ctx.reply(formatMonthlyReport(days, query, false, true));
});

registerCalendarHandlers(bot, ownerIdValue);
// Must stay last: it receives free text no earlier handler claimed. The
// assistant runs the same command code as the slash commands above.
registerAssistantHandlers(bot, {
  ...defaultAssistantDependencies,
  actionsFor: (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    const messageId = ctx.message?.message_id ?? 0;
    // Each reminder or calendar event from one message needs its own source line.
    let reminderLine = 0;
    let calendarLine = 0;
    // Expenditure adjustments are keyed by source message: one entry per message.
    let expenditureLogged = false;
    return {
      addTask: async (input) => {
        const result = await actions.addTask(input);
        return {
          message: result.message,
          undo: result.id
            ? { kind: "task", id: result.id, label: `task #${result.id}` }
            : undefined,
        };
      },
      listTasks: actions.listOpenTasks,
      completeTask: actions.completeTask,
      addTodo: async (description) => {
        const result = await actions.addTodo(description);
        return {
          message: result.message,
          undo: { kind: "todo", id: result.id!, label: `to-do #${result.id}` },
        };
      },
      listTodos: actions.listTodayTodos,
      addReminder: async (command) => {
        const result = await actions.addReminder(command, {
          ownerId: ownerIdValue,
          chatId,
          sourceMessageId: messageId,
          sourceLine: reminderLine++,
        });
        if (!result) return null;
        return {
          message: result.message,
          undo: {
            kind: "rem",
            id: result.id!,
            label: `reminder #${result.id}`,
          },
        };
      },
      listReminders: () => actions.listPendingReminders(ownerIdValue),
      stageCalendarEvent: (text) =>
        stageCalendarMessage(
          ctx,
          text,
          messageId,
          calendarLine++,
          ownerIdValue,
          false,
        ),
      listCalendarEvents: (startDate, days) =>
        listCalendarEvents(startDate || todayInSingapore(), days),
      requestDeletion: (kind, id) =>
        requestDeletion(ctx, ownerIdValue, kind, id),
      requestCalendarDeletion: (eventId) =>
        requestCalendarEventDeletion(ctx, ownerIdValue, eventId),
      logExpenditure: async (amountCents, date, mode) => {
        if (expenditureLogged) {
          return "Error: only one expenditure entry can be made per message. Combine the amounts into one call.";
        }
        const now = new Date();
        const spendDate = date ?? todayInSingapore(now);
        if (!isDateEditable(spendDate, now)) {
          return "Error: that day can't be edited (it is in the future or more than 365 days ago).";
        }
        expenditureLogged = true;
        await expenditureStore.openEditSession(
          ownerIdValue,
          chatId,
          spendDate,
          mode,
          now,
        );
        try {
          const confirmation = await applyExpenditure(
            ctx,
            messageId,
            amountCents,
            now,
          );
          return confirmation
            ? `${confirmation} (sent to the user with Add/Remove buttons)`
            : "Error: nothing was recorded.";
        } finally {
          // Never leave an entry window open: the next number message would land on this date.
          await expenditureStore.closeSession(ownerIdValue);
        }
      },
      expenditureReport: (period, date) =>
        actions.expenditureReport(period, date),
      expenditureBreakdown: actions.expenditureBreakdown,
    };
  },
});
registerAssistantButtons(bot, ownerIdValue);

bot.catch(async (error, ctx) => {
  const errorType = error instanceof Error ? error.name : typeof error;
  console.error(
    `Failed to handle Telegram update ${ctx.update.update_id} (${errorType})`,
  );
  if (ctx.from?.id !== OWNER_ID) return;

  try {
    await ctx.reply(
      "Something went wrong while processing that command. Please try again.",
    );
  } catch (replyError) {
    const replyErrorType =
      replyError instanceof Error ? replyError.name : typeof replyError;
    console.error(
      `Failed to send the command error message (${replyErrorType})`,
    );
  }
});
