import type { Context, Telegraf } from "telegraf";
import { QUIET } from "../telegram-quiet.js";
import { assistantStore } from "../assistant/store.js";
import { parseExpenditureAmounts } from "../expenditure.js";
import { acknowledge, callbackId, setButtons } from "../telegram-buttons.js";
import {
  applySgdReply,
  askForSgd,
  countPayment,
  skipPayment,
  undoPayment,
} from "./service.js";
import { applePayStore } from "./store.js";
import { conversationOf } from "../topic-context.js";

// Telegram's side of Apple Pay: the buttons on each payment message, and a
// plain amount sent while a foreign payment waits for its S$ amount.
// Registered before the expenditure handlers, so that amount isn't taken as
// ordinary spending.
export function registerApplePayHandlers(bot: Telegraf, ownerId: string): void {
  bot.use(async (ctx: Context, next) => {
    const message = ctx.message;
    if (!message || !("text" in message)) return next();
    const cents = parseExpenditureAmounts(message.text);
    if (cents === null) return next();
    const now = new Date();
    // An answer to the assistant's own question goes to the assistant.
    if (await assistantStore.awaitsAnswer(conversationOf(ctx), now)) {
      return next();
    }
    const reply = await applySgdReply(applePayStore, cents, ownerId, now);
    if (reply === null) return next();
    await ctx.reply(reply, QUIET);
  });

  bot.action(/^ap:(undo|skip|sgd|ok):(\d{1,10})$/, async (ctx) => {
    await acknowledge(ctx);
    const [, verb, rawId] = ctx.match;
    const id = callbackId(rawId);
    if (id === null) return;
    if (verb === "undo") {
      const text = await undoPayment(applePayStore, id, ownerId);
      await setButtons(ctx, []);
      await ctx.reply(text, QUIET);
      return;
    }
    if (verb === "ok") {
      const text = await countPayment(applePayStore, id, ownerId);
      await setButtons(ctx, []);
      await ctx.reply(text, QUIET);
      return;
    }
    if (verb === "skip") {
      const text = await skipPayment(applePayStore, id);
      await setButtons(ctx, []);
      await ctx.reply(text, QUIET);
      return;
    }
    await ctx.reply(await askForSgd(applePayStore, id, new Date()), QUIET);
  });
}
