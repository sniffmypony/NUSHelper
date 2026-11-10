import { Markup, type Context, type Telegraf } from "telegraf";
import { singaporeDateRange } from "../dates.js";
import { formatCalendarAgendaEvent } from "./agenda.js";
import {
  FIXED_CALENDAR_ID,
  FIXED_TIME_ZONE,
  isCalendarConfigured,
} from "./config.js";

export const CALENDAR_NOT_SET_UP =
  "Google Calendar isn't set up for this bot (GOOGLE_CALENDAR_ID is empty).";
import { calendarErrorMessage, getCalendarGateway } from "./google.js";
import { CalendarOperations, type ConfirmResult } from "./operations.js";
import {
  formatCalendarEvent,
  looksLikeCalendarMessage,
  parseCalendarEventMessage,
  type ParsedCalendarEvent,
} from "./parser.js";
import { calendarStore } from "./store.js";
import type { CalendarEventMapping } from "./types.js";

const DATE_ERROR = [
  "I could not understand the date.",
  "",
  "Use DD-MM-YYYY, for example:",
  "22-08-2026",
  "",
  "Full example:",
  "12:00-18:00, Homework, 22-08-2026",
].join("\n");

const EVENT_ERROR = [
  "I could not understand that event.",
  "",
  "Use:",
  "12:00-18:00, Homework, 22-08-2026",
  "",
  "You can also use:",
  "12pm-6pm, Homework, 22-08-2026",
  "1130am-1pm, Tutor, 05-09-2026",
  "1130-1330, Tutor, 05-09-2026",
].join("\n");

function asParsedMapping(mapping: CalendarEventMapping): ParsedCalendarEvent {
  return {
    title: mapping.title,
    startDateTime: mapping.startDateTime,
    endDateTime: mapping.endDateTime,
    calendarId: FIXED_CALENDAR_ID,
    timeZone: FIXED_TIME_ZONE,
    isPast: new Date(mapping.startDateTime).getTime() < Date.now(),
  };
}

function confirmationPreview(
  action: "Create" | "Update",
  event: ParsedCalendarEvent,
): string {
  const formatted = formatCalendarEvent(event);
  return [
    `${action} this calendar event?`,
    "",
    `Title: ${event.title}`,
    `Date: ${formatted.date}`,
    `Time: ${formatted.time}`,
    `Timezone: ${FIXED_TIME_ZONE}`,
    `Calendar: ${FIXED_CALENDAR_ID}`,
    ...(event.isPast ? ["", "Warning: This event is in the past."] : []),
  ].join("\n");
}

function mappingSummary(
  verb: "created" | "updated",
  mapping: CalendarEventMapping,
): string {
  const event = asParsedMapping(mapping);
  const formatted = formatCalendarEvent(event);
  return [
    `Calendar event ${verb} ✅`,
    "",
    `Title: ${event.title}`,
    `Date: ${formatted.date}`,
    `Time: ${formatted.time}`,
    `Timezone: ${FIXED_TIME_ZONE}`,
    `Calendar: ${FIXED_CALENDAR_ID}`,
  ].join("\n");
}

function resultKeyboard(mapping: CalendarEventMapping) {
  const rows = [];
  if (mapping.googleHtmlLink)
    rows.push([
      Markup.button.url("Open in Google Calendar", mapping.googleHtmlLink),
    ]);
  rows.push([
    Markup.button.callback("Delete event", `cal:delete:${mapping.actionToken}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

async function operations(): Promise<CalendarOperations> {
  return new CalendarOperations(calendarStore, await getCalendarGateway());
}

async function removeKeyboard(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch {
    // A missing or already-edited source message does not change the calendar result.
  }
}

async function replyForResult(
  ctx: Context,
  result: ConfirmResult,
  requested: "create" | "update" | "delete",
) {
  if (
    result.status === "created" ||
    result.status === "updated" ||
    result.status === "already-completed"
  ) {
    await removeKeyboard(ctx);
    const verb =
      result.status === "updated" || requested === "update"
        ? "updated"
        : "created";
    return ctx.reply(
      mappingSummary(verb, result.mapping),
      resultKeyboard(result.mapping),
    );
  }
  if (result.status === "deleted") {
    await removeKeyboard(ctx);
    return ctx.reply("Deleted from Google Calendar.");
  }
  if (result.status === "already-deleted") {
    await removeKeyboard(ctx);
    return ctx.reply("This event is already deleted.");
  }
  if (result.status === "expired")
    return ctx.reply("This confirmation has expired. Send the event again.");
  if (result.status === "processing")
    return ctx.reply("This calendar request is already being processed.");
  return ctx.reply("This confirmation is no longer valid.");
}

export async function stageCalendarMessage(
  ctx: Context,
  text: string,
  messageId: number,
  sourceLine: number,
  ownerId: string,
  replyOnInvalid = true,
): Promise<boolean> {
  const parsed = parseCalendarEventMessage(text);
  if (!parsed.ok) {
    if (replyOnInvalid)
      await ctx.reply(parsed.error === "date" ? DATE_ERROR : EVENT_ERROR);
    return false;
  }
  if (!isCalendarConfigured()) {
    await ctx.reply(CALENDAR_NOT_SET_UP);
    return true;
  }

  const chatId = String(ctx.chat?.id ?? "");
  if (!chatId) return false;
  const existing = await calendarStore.findMappingBySource(
    ownerId,
    chatId,
    messageId,
    sourceLine,
  );
  const pending = await (
    await operations()
  ).stageEvent(ownerId, chatId, messageId, sourceLine, parsed.event, existing);
  const isUpdate = pending.kind === "update";
  await ctx.reply(
    confirmationPreview(isUpdate ? "Update" : "Create", parsed.event),
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          isUpdate ? "Update event" : "Create event",
          `cal:${isUpdate ? "update" : "create"}:${pending.operationId}`,
        ),
        Markup.button.callback("Cancel", `cal:cancel:${pending.operationId}`),
      ],
    ]),
  );
  return true;
}

// Sends the standard "Delete this event?" confirmation for a bot-created event.
export async function sendCalendarDeletePrompt(
  ctx: Context,
  ownerId: string,
  actionToken: string,
): Promise<boolean> {
  const pending = await (await operations()).stageDelete(ownerId, actionToken);
  if (!pending) return false;
  await ctx.reply(
    "Delete this event from Google Calendar?",
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "Confirm deletion",
          `cal:confirm-delete:${pending.operationId}`,
        ),
        Markup.button.callback("Keep event", `cal:keep:${pending.operationId}`),
      ],
    ]),
  );
  return true;
}

export async function listCalendarEvents(
  startDate: string,
  days: number,
): Promise<string> {
  const { timeMin, timeMax } = singaporeDateRange(startDate, days);
  const events = await (await getCalendarGateway()).listRange(timeMin, timeMax);
  if (events.length === 0) return "No events in that range.";
  return events
    .slice(0, 40)
    .map((event) => `${formatCalendarAgendaEvent(event)} (id=${event.id})`)
    .join("\n");
}

// Bot-created events reuse the normal delete confirmation; any other event in
// the calendar gets its own Delete/Keep buttons. Nothing is deleted here.
export async function requestCalendarEventDeletion(
  ctx: Context,
  ownerId: string,
  eventId: string,
): Promise<string> {
  const pending =
    "Asked the user to confirm. Nothing is deleted until they press the button.";
  const mapping = await calendarStore.findActiveMappingByGoogleEventId(
    eventId,
    ownerId,
  );
  if (
    mapping &&
    (await sendCalendarDeletePrompt(ctx, ownerId, mapping.actionToken))
  ) {
    return pending;
  }

  if (!/^[A-Za-z0-9_]{1,55}$/.test(eventId)) {
    return "Error: that event id is not valid. Use an id from list_calendar_events.";
  }
  const event = await (await getCalendarGateway()).getAgendaEvent(eventId);
  if (!event) return "Error: no event with that id was found.";
  await ctx.reply(
    `Delete this event from Google Calendar?\n${formatCalendarAgendaEvent(event)}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("Delete", `cal:gdel:${event.id}`),
        Markup.button.callback("Keep", "cal:gkeep"),
      ],
    ]),
  );
  return pending;
}

async function answerCallback(ctx: Context): Promise<void> {
  if ("callbackQuery" in ctx && ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Continue: Telegram may have retried an old callback after its acknowledgement window.
    }
  }
}

function errorType(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

export function registerCalendarHandlers(
  bot: Telegraf<Context>,
  ownerId: string,
): void {
  bot.action(/^cal:create:([0-9a-f-]{36})$/, async (ctx) => {
    await answerCallback(ctx);
    try {
      await replyForResult(
        ctx,
        await (await operations()).confirmCreate(ctx.match[1], ownerId),
        "create",
      );
    } catch (error) {
      console.error(
        `Calendar create operation ${ctx.match[1]} failed (${errorType(error)})`,
      );
      await ctx.reply(calendarErrorMessage(error));
    }
  });

  bot.action(/^cal:update:([0-9a-f-]{36})$/, async (ctx) => {
    await answerCallback(ctx);
    try {
      await replyForResult(
        ctx,
        await (await operations()).confirmUpdate(ctx.match[1], ownerId),
        "update",
      );
    } catch (error) {
      console.error(
        `Calendar update operation ${ctx.match[1]} failed (${errorType(error)})`,
      );
      await ctx.reply(calendarErrorMessage(error));
    }
  });

  bot.action(/^cal:cancel:([0-9a-f-]{36})$/, async (ctx) => {
    await answerCallback(ctx);
    const result = await (await operations()).cancel(ctx.match[1], ownerId);
    if (result === "cancelled") {
      await removeKeyboard(ctx);
      await ctx.reply("Cancelled.");
    } else if (result === "expired") {
      await ctx.reply("This confirmation has expired. Send the event again.");
    } else {
      await ctx.reply("This confirmation is no longer valid.");
    }
  });

  bot.action(/^cal:delete:([0-9a-f-]{36})$/, async (ctx) => {
    await answerCallback(ctx);
    if (!(await sendCalendarDeletePrompt(ctx, ownerId, ctx.match[1]))) {
      await ctx.reply(
        "This event is already deleted or is no longer available.",
      );
    }
  });

  // Events the bot did not create have no mapping; the assistant offers
  // these buttons for them, carrying the Google event id.
  bot.action(/^cal:gdel:([A-Za-z0-9_]{1,55})$/, async (ctx) => {
    await answerCallback(ctx);
    await removeKeyboard(ctx);
    try {
      const gateway = await getCalendarGateway();
      const event = await gateway.getAgendaEvent(ctx.match[1]);
      const result = await gateway.delete(ctx.match[1]);
      await ctx.reply(
        result === "deleted"
          ? `Deleted from Google Calendar: ${event?.title ?? "event"}`
          : "That event was already deleted.",
      );
    } catch (error) {
      console.error(`Calendar event delete failed (${errorType(error)})`);
      await ctx.reply(calendarErrorMessage(error));
    }
  });

  bot.action("cal:gkeep", async (ctx) => {
    await answerCallback(ctx);
    await removeKeyboard(ctx);
    await ctx.reply("Kept the event.");
  });

  bot.action(/^cal:confirm-delete:([0-9a-f-]{36})$/, async (ctx) => {
    await answerCallback(ctx);
    try {
      await replyForResult(
        ctx,
        await (await operations()).confirmDelete(ctx.match[1], ownerId),
        "delete",
      );
    } catch (error) {
      console.error(
        `Calendar delete operation ${ctx.match[1]} failed (${errorType(error)})`,
      );
      await ctx.reply(calendarErrorMessage(error));
    }
  });

  bot.action(/^cal:keep:([0-9a-f-]{36})$/, async (ctx) => {
    await answerCallback(ctx);
    await (await operations()).cancel(ctx.match[1], ownerId);
    await removeKeyboard(ctx);
    await ctx.reply("Kept the event.");
  });

  // Vercel's per-function compiler can resolve a second copy of
  // @telegraf/types. Keep the runtime filters while avoiding cross-copy
  // private generic types at this registration boundary.
  const on = bot.on.bind(bot) as unknown as (
    filter: string,
    handler: (ctx: Context, next: () => Promise<void>) => Promise<void>,
  ) => void;

  on("edited_message", async (ctx) => {
    const message = ctx.editedMessage;
    if (!message || !("text" in message) || message.text.startsWith("/"))
      return;
    await stageCalendarMessage(
      ctx,
      message.text,
      message.message_id,
      0,
      ownerId,
    );
  });

  on("text", async (ctx, next) => {
    const message = ctx.message;
    if (!message || !("text" in message) || message.text.startsWith("/"))
      return;
    // Free text that is not shaped like an event goes to the Canvas assistant.
    if (!looksLikeCalendarMessage(message.text)) return next();
    await stageCalendarMessage(
      ctx,
      message.text,
      message.message_id,
      0,
      ownerId,
    );
  });
}
