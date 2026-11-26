import { DateTime } from "luxon";
import { cleanField } from "../apple-pay/payments.js";
import type { Send } from "../apple-pay/service.js";
import type { ApplePayStore } from "../apple-pay/store.js";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import { formatCurrency } from "../expenditure.js";
import type { ReadWithAi } from "./ai.js";
import {
  DBS_SENDERS,
  readDbsEmail,
  senderAddress,
  verifiedDbs,
} from "./dbs.js";

// A DBS alert email sent by the owner's Google Apps Script. Money leaving an
// account becomes a waiting payment and a Telegram question (Count it /
// Skip / Edit amount); nothing is counted until the owner answers. Money
// arriving is ignored.

export interface BankEmailDeps {
  store: ApplePayStore;
  send: Send;
  readWithAi: ReadWithAi;
  now: Date;
}

export type Handled = { status: number; text: string };

export function askKeyboard(id: number) {
  return {
    inline_keyboard: [
      [{ text: "Count it", callback_data: `ap:ok:${id}` }],
      [
        { text: "Skip", callback_data: `ap:skip:${id}` },
        { text: "Edit amount", callback_data: `ap:sgd:${id}` },
      ],
    ],
  };
}

const zone = { zone: SINGAPORE_TIME_ZONE };

function whenText(date: Date): string {
  return DateTime.fromJSDate(date)
    .setZone(SINGAPORE_TIME_ZONE)
    .toFormat("d LLL, HH:mm");
}

export async function receiveBankEmail(
  body: unknown,
  deps: BankEmailDeps,
): Promise<Handled> {
  const fields = (body ?? {}) as Record<string, unknown>;
  const messageId = cleanField(fields.id, 100);
  const from = cleanField(fields.from, 200);
  const subject = cleanField(fields.subject, 300);
  const auth =
    typeof fields.auth === "string" ? fields.auth.slice(0, 4000) : "";
  const text =
    typeof fields.text === "string" ? fields.text.slice(0, 20_000) : "";
  const dateValue =
    typeof fields.date === "string" ? new Date(fields.date) : null;
  const emailDate =
    dateValue && !Number.isNaN(dateValue.getTime()) ? dateValue : deps.now;
  if (!messageId || !text) return { status: 400, text: "Missing email." };

  const sender = senderAddress(from);
  if (!DBS_SENDERS.includes(sender)) {
    return { status: 200, text: "Ignored: not a DBS alert address." };
  }
  // Gmail's own record of whether DBS really sent it.
  if (!verifiedDbs(auth)) {
    console.log(`Bank email failed sender checks (${sender})`);
    try {
      await deps.send(
        `⚠️ An email that looked like a DBS alert failed Google's sender checks, so it was ignored: “${subject || "(no subject)"}”.`,
      );
    } catch {
      // The warning is a courtesy.
    }
    return { status: 200, text: "Ignored: not verified as DBS." };
  }
  if (await deps.store.findByRef(`gmail:${messageId}`)) {
    return { status: 200, text: "Already have this email." };
  }

  const reading = readDbsEmail(sender, subject, text, emailDate);
  if (reading.kind === "incoming") {
    return { status: 200, text: "Ignored: money received." };
  }

  let payment: {
    type: string;
    currency: string;
    cents: number | null;
    amountText: string;
    to: string;
    occurredAt: Date;
    ref: string | null;
    byAi: boolean;
  };
  if (reading.kind === "payment") {
    payment = {
      ...reading,
      occurredAt: reading.occurredAt ?? emailDate,
      byAi: false,
    };
  } else {
    const ai = await deps.readWithAi(subject, text);
    if (ai && ai.direction !== "out") {
      return { status: 200, text: "Ignored: no money left the account." };
    }
    if (!ai) {
      try {
        await deps.send(
          `🧾 I couldn't read a DBS email: “${subject || "(no subject)"}”. If it was spending, add it yourself.`,
        );
      } catch {
        // Still answered to the script below.
      }
      return { status: 200, text: "Couldn't read it." };
    }
    const when = ai.when
      ? DateTime.fromFormat(ai.when, "yyyy-MM-dd HH:mm", zone)
      : null;
    payment = {
      type: ai.type,
      currency: ai.currency,
      cents: ai.cents,
      amountText: ai.amountText,
      to: ai.to,
      occurredAt: when?.isValid ? when.toJSDate() : emailDate,
      ref: null,
      byAi: true,
    };
  }

  // One row per transaction: the bank's reference when there is one.
  const externalRef = payment.ref ? `dbs:${payment.ref}` : `gmail:${messageId}`;
  if (await deps.store.findByRef(externalRef)) {
    return { status: 200, text: "Already have this payment." };
  }

  const spendDate = DateTime.fromJSDate(payment.occurredAt)
    .setZone(SINGAPORE_TIME_ZONE)
    .toISODate()!;
  const { payment: saved } = await deps.store.record(
    {
      receivedAt: deps.now,
      spendDate,
      amountCents: payment.cents,
      amountText: payment.amountText,
      currency: payment.currency,
      merchant: payment.to,
      card: "",
      sgdRequestedUntil: null,
      source: "email",
      kind: payment.type,
      externalRef,
      readByAi: payment.byAi,
      askFirst: true,
    },
    "",
  );

  const amount =
    payment.cents !== null ? formatCurrency(payment.cents) : payment.amountText;
  const to = payment.to ? ` to ${payment.to}` : "";
  const aiNote = payment.byAi ? "\n(Read by AI: check the amount.)" : "";
  const question =
    payment.cents !== null
      ? "Count it as spending?"
      : "How much was it in S$? Tap Edit amount, or Skip.";
  try {
    await deps.send(
      `🧾 ${payment.type}: ${amount}${to}\n${whenText(payment.occurredAt)}${aiNote}\n${question}`,
      { replyMarkup: askKeyboard(saved.id) },
    );
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Bank email Telegram message failed (${type})`);
  }
  return { status: 200, text: "Asked on Telegram." };
}
