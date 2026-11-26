import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE, todayInSingapore } from "../dates.js";
import { formatCurrency } from "../expenditure.js";
import type { SendTelegramMessageOptions } from "../telegram.js";
import {
  cleanField,
  describePayment,
  parseApplePayAmount,
} from "./payments.js";
import type { ApplePayPayment, ApplePayStore } from "./store.js";

// What happens when the iPhone reports an Apple Pay payment, and the
// Telegram side of it (Undo, the S$ amount of a foreign payment).

// The same payment sent twice within this long is counted once.
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
// A leaked key can't flood the records.
export const MAX_PAYMENTS_PER_DAY = 100;
// How long a plain amount on Telegram counts as a foreign payment's S$ amount.
export const SGD_REPLY_WINDOW_MS = 30 * 60_000;

export type Send = (
  text: string,
  options?: SendTelegramMessageOptions,
) => Promise<void>;

export interface ReceiveDeps {
  store: ApplePayStore;
  send: Send;
  ownerId: string;
  now: Date;
}

// The reply to the phone: an HTTP status and one line for its notification.
export type Received = { status: number; text: string };

export function undoKeyboard(id: number) {
  return {
    inline_keyboard: [[{ text: "Undo", callback_data: `ap:undo:${id}` }]],
  };
}

export function sgdKeyboard(id: number) {
  return {
    inline_keyboard: [
      [
        { text: "Enter S$ amount", callback_data: `ap:sgd:${id}` },
        { text: "Skip", callback_data: `ap:skip:${id}` },
      ],
    ],
  };
}

export async function receivePayment(
  body: unknown,
  deps: ReceiveDeps,
): Promise<Received> {
  const fields = (body ?? {}) as Record<string, unknown>;
  const amountText = cleanField(
    typeof fields.amount === "number" ? String(fields.amount) : fields.amount,
    40,
  );
  const merchant = cleanField(fields.merchant, 120);
  const card = cleanField(fields.card, 80);
  const amount = parseApplePayAmount(amountText);
  if (!amount) {
    return {
      status: 400,
      text: amountText
        ? `NUSHelper couldn't read the amount "${amountText}".`
        : "NUSHelper got no amount.",
    };
  }

  const { store, send, ownerId, now } = deps;
  const spendDate = DateTime.fromJSDate(now)
    .setZone(SINGAPORE_TIME_ZONE)
    .toISODate()!;
  if ((await store.countOn(spendDate)) >= MAX_PAYMENTS_PER_DAY) {
    return { status: 429, text: "NUSHelper: too many payments today." };
  }
  const duplicate = await store.recentDuplicate(
    { amountText, merchant, card },
    new Date(now.getTime() - DUPLICATE_WINDOW_MS),
  );
  if (duplicate) {
    return { status: 200, text: "NUSHelper already has this payment." };
  }

  const { payment, dayTotalCents } = await store.record(
    {
      receivedAt: now,
      spendDate,
      amountCents: amount.cents,
      amountText,
      currency: amount.currency,
      merchant,
      card,
      sgdRequestedUntil:
        amount.cents === null
          ? new Date(now.getTime() + SGD_REPLY_WINDOW_MS)
          : null,
    },
    ownerId,
  );

  const what = describePayment(payment);
  // The payment is saved either way; a failed Telegram message only means
  // no Undo button this time (the website has one too).
  try {
    if (dayTotalCents !== null) {
      await send(
        `💳 Apple Pay: ${what}\nToday: ${formatCurrency(dayTotalCents)}`,
        {
          replyMarkup: undoKeyboard(payment.id),
        },
      );
    } else {
      await send(
        `💳 Apple Pay: ${what}\nHow much was that in S$? Send the amount (e.g. 12.40) in the next 30 minutes, or tap a button.`,
        { replyMarkup: sgdKeyboard(payment.id) },
      );
    }
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Apple Pay Telegram message failed (${type})`);
  }

  return dayTotalCents !== null
    ? {
        status: 200,
        text: `Logged ${what}. Today: ${formatCurrency(dayTotalCents)}`,
      }
    : {
        status: 200,
        text: `Logged ${what}. Send the S$ amount on Telegram.`,
      };
}

// ---- Telegram buttons and replies -------------------------------------------

export async function undoPayment(
  store: ApplePayStore,
  id: number,
  ownerId: string,
  now = new Date(),
): Promise<string> {
  const result = await store.undo(id, ownerId);
  if (!result) return "That payment was already undone.";
  return `Undone: ${describePayment(result.payment)}\n${dayLine(result.payment.spendDate, result.dayTotalCents, todayInSingapore(now))}`;
}

export async function skipPayment(
  store: ApplePayStore,
  id: number,
): Promise<string> {
  const payment = await store.skip(id);
  return payment
    ? `Skipped: ${describePayment(payment)} isn't counted.`
    : "That payment was already handled.";
}

export async function askForSgd(
  store: ApplePayStore,
  id: number,
  now: Date,
): Promise<string> {
  const payment = await store.requestSgd(
    id,
    new Date(now.getTime() + SGD_REPLY_WINDOW_MS),
  );
  return payment
    ? `Send the S$ amount for ${describePayment(payment)} in the next 30 minutes.`
    : "That payment was already handled.";
}

// A plain amount on Telegram while a foreign payment waits for its S$
// amount. Null when no payment is waiting (the amount is then ordinary
// spending, as before).
export async function applySgdReply(
  store: ApplePayStore,
  cents: number,
  ownerId: string,
  now: Date,
): Promise<string | null> {
  const waiting: ApplePayPayment | null = await store.awaitingSgd(now);
  if (!waiting) return null;
  const result = await store.convert(waiting.id, cents, ownerId);
  if (!result) return null;
  const where = waiting.merchant
    ? ` ${waiting.source === "email" ? "to" : "at"} ${waiting.merchant}`
    : "";
  return `Counted ${waiting.amountText}${where} as ${formatCurrency(cents)}.\n${dayLine(result.payment.spendDate, result.dayTotalCents, todayInSingapore(now))}`;
}

// "Count it" on a bank payment that was waiting for an answer.
export async function countPayment(
  store: ApplePayStore,
  id: number,
  ownerId: string,
  now = new Date(),
): Promise<string> {
  const result = await store.confirm(id, ownerId);
  if (!result) return "That payment was already handled.";
  return `Counted: ${describePayment(result.payment)}\n${dayLine(result.payment.spendDate, result.dayTotalCents, todayInSingapore(now))}`;
}

// "Today: S$23.40", or "Total for 15 Nov: S$927.40" for an earlier day.
export function dayLine(
  spendDate: string,
  cents: number,
  today = todayInSingapore(),
): string {
  const label =
    spendDate === today
      ? "Today"
      : `Total for ${DateTime.fromISO(spendDate, { zone: SINGAPORE_TIME_ZONE }).toFormat("d LLL")}`;
  return `${label}: ${formatCurrency(cents)}`;
}

// The 11:30pm message (and the 1am reminder) when payments were recorded
// automatically that day (Apple Pay, or bank emails you counted): only the
// rest needs answering. Bank payments still waiting for an answer are
// mentioned too.
export function nightlyPrompt(summary: {
  count: number;
  cents: number;
  waiting?: number;
}): string {
  const lines = [
    summary.count > 0
      ? `expenditure: Recorded automatically today ${formatCurrency(summary.cents)} (${summary.count} payment${summary.count === 1 ? "" : "s"}). Anything else, like cash or online? Reply with the amounts, or tap That's all.`
      : "expenditure:",
  ];
  if (summary.waiting) {
    lines.push(
      `(${summary.waiting} bank payment${summary.waiting === 1 ? " is" : "s are"} still waiting for Count it or Skip above.)`,
    );
  }
  return lines.join("\n");
}

export function thatsAllKeyboard(date: string) {
  return {
    inline_keyboard: [
      [{ text: "That's all", callback_data: `exp:done:${date}` }],
    ],
  };
}
