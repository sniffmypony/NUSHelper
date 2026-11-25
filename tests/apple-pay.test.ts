import { describe, expect, it, vi } from "vitest";
import {
  cleanField,
  hashApplePayKey,
  keyMatches,
  newApplePayKey,
  parseApplePayAmount,
  readSuppliedKey,
} from "../src/apple-pay/payments.js";
import {
  MAX_PAYMENTS_PER_DAY,
  applySgdReply,
  nightlyPrompt,
  receivePayment,
  skipPayment,
  undoPayment,
} from "../src/apple-pay/service.js";
import type {
  ApplePayPayment,
  ApplePayStore,
  NewPayment,
} from "../src/apple-pay/store.js";

describe("reading the amount the phone sends", () => {
  it("counts Singapore dollars in the usual forms", () => {
    for (const text of [
      "S$5.40",
      "SGD 5.40",
      "5.40 SGD",
      "$5.40",
      "5.40",
      "5,40",
      "S$ 5.4",
    ]) {
      expect(parseApplePayAmount(text), text).toEqual({
        currency: "SGD",
        cents: 540,
      });
    }
    expect(parseApplePayAmount("S$1,234.50")).toEqual({
      currency: "SGD",
      cents: 123450,
    });
    expect(parseApplePayAmount("S$12")).toEqual({
      currency: "SGD",
      cents: 1200,
    });
  });

  it("never guesses a conversion for other currencies", () => {
    expect(parseApplePayAmount("¥500")).toEqual({
      currency: "JPY",
      cents: null,
    });
    expect(parseApplePayAmount("JPY 500")).toEqual({
      currency: "JPY",
      cents: null,
    });
    expect(parseApplePayAmount("US$12.30")).toEqual({
      currency: "USD",
      cents: null,
    });
    expect(parseApplePayAmount("RM 8.90")).toEqual({
      currency: "MYR",
      cents: null,
    });
    expect(parseApplePayAmount("€3,50")).toEqual({
      currency: "EUR",
      cents: null,
    });
  });

  it("refuses what isn't an amount", () => {
    for (const text of ["", "free", "-5.40", "5.405", "S$", "1e5", "(5.40)"]) {
      expect(parseApplePayAmount(text), text).toBeNull();
    }
    expect(parseApplePayAmount("S$1000000")).toBeNull();
  });

  it("keeps the phone's text fields short and on one line", () => {
    expect(cleanField("Star\nbucks\t  Raffles", 50)).toBe("Star bucks Raffles");
    expect(cleanField("x".repeat(200), 120)).toHaveLength(120);
    expect(cleanField(42, 10)).toBe("");
  });
});

describe("the shortcut's key", () => {
  const key = newApplePayKey();
  const hash = hashApplePayKey(key);
  const read = (headers: Record<string, string | undefined>) =>
    readSuppliedKey(headers);

  it("matches only the key whose hash is stored", () => {
    expect(key).toMatch(/^ap_[\w-]{32}$/);
    expect(keyMatches(read({ authorization: `Bearer ${key}` }).key, hash)).toBe(
      true,
    );
    expect(
      keyMatches(read({ authorization: `Bearer ${key}x` }).key, hash),
    ).toBe(false);
    expect(
      keyMatches(read({ authorization: `Bearer ${key}` }).key, undefined),
    ).toBe(false);
    expect(keyMatches(null, hash)).toBe(false);
  });

  it("forgives how a phone mangles it", () => {
    for (const headers of [
      { authorisation: `Bearer ${key}` },
      { authorization: key },
      { authorization: `bearer ${key}` },
      { authorization: `Bearer\u00a0${key}` },
      { authorization: `"Bearer ${key}"` },
      { authorization: `Bearer ${key}\u200b` },
      { "x-nushelper-key": key },
    ]) {
      const supplied = read(headers);
      expect(keyMatches(supplied.key, hash), JSON.stringify(headers)).toBe(
        true,
      );
      expect(supplied.looksRight).toBe(true);
    }
  });

  it("says what arrived, without the key itself", () => {
    expect(read({})).toEqual({
      key: null,
      header: null,
      hadBearer: false,
      length: 0,
      looksRight: false,
    });
    const cut = read({ authorization: `Bearer ${key.slice(0, 20)}` });
    expect(cut).toMatchObject({
      header: "authorization",
      hadBearer: true,
      length: 20,
      looksRight: false,
    });
  });
});

class MemoryApplePay implements ApplePayStore {
  rows: ApplePayPayment[] = [];
  dayTotal = 0;
  async recentDuplicate(
    p: Pick<NewPayment, "amountText" | "merchant" | "card">,
    since: Date,
  ) {
    return (
      this.rows.find(
        (r) =>
          r.amountText === p.amountText &&
          r.merchant === p.merchant &&
          r.card === p.card &&
          r.receivedAt >= since,
      ) ?? null
    );
  }
  async countOn(spendDate: string) {
    return this.rows.filter((r) => r.spendDate === spendDate).length;
  }
  async record(value: NewPayment) {
    const payment: ApplePayPayment = {
      ...value,
      id: this.rows.length + 1,
      status: value.amountCents === null ? "awaiting_sgd" : "counted",
      createdAt: value.receivedAt,
    };
    this.rows.push(payment);
    if (value.amountCents === null) return { payment, dayTotalCents: null };
    this.dayTotal += value.amountCents;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async convert(id: number, cents: number) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "awaiting_sgd",
    );
    if (!payment) return null;
    Object.assign(payment, { status: "counted", amountCents: cents });
    this.dayTotal += cents;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async undo(id: number) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "counted",
    );
    if (!payment) return null;
    payment.status = "undone";
    this.dayTotal -= payment.amountCents ?? 0;
    return { payment, dayTotalCents: this.dayTotal };
  }
  async skip(id: number) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "awaiting_sgd",
    );
    if (payment) payment.status = "skipped";
    return payment ?? null;
  }
  async requestSgd(id: number, until: Date) {
    const payment = this.rows.find(
      (r) => r.id === id && r.status === "awaiting_sgd",
    );
    if (payment) payment.sgdRequestedUntil = until;
    return payment ?? null;
  }
  async awaitingSgd(now: Date) {
    return (
      this.rows.find(
        (r) =>
          r.status === "awaiting_sgd" &&
          r.sgdRequestedUntil !== null &&
          r.sgdRequestedUntil > now,
      ) ?? null
    );
  }
  async daySummary() {
    return { count: 0, cents: 0 };
  }
  async inRange() {
    return this.rows;
  }
  async latest() {
    return this.rows.at(-1) ?? null;
  }
}

const NOW = new Date("2026-11-25T04:31:00Z"); // 12:31 in Singapore

function setup() {
  const store = new MemoryApplePay();
  const send = vi.fn(async () => {});
  const receive = (body: unknown, now = NOW) =>
    receivePayment(body, { store, send, ownerId: "123", now });
  return { store, send, receive };
}

describe("receiving a payment", () => {
  it("adds an S$ payment to today straight away, with Undo on Telegram", async () => {
    const { store, send, receive } = setup();
    const reply = await receive({
      amount: "S$5.40",
      merchant: "Starbucks",
      card: "DBS Visa",
    });
    expect(reply).toEqual({
      status: 200,
      text: "Logged S$5.40 at Starbucks (DBS Visa). Today: S$5.40",
    });
    expect(store.rows[0]).toMatchObject({
      spendDate: "2026-11-25",
      amountCents: 540,
      currency: "SGD",
      status: "counted",
    });
    expect(send).toHaveBeenCalledWith(
      "💳 Apple Pay: S$5.40 at Starbucks (DBS Visa)\nToday: S$5.40",
      {
        replyMarkup: {
          inline_keyboard: [[{ text: "Undo", callback_data: "ap:undo:1" }]],
        },
      },
    );
  });

  it("counts a payment after midnight for the new day", async () => {
    const { store, receive } = setup();
    await receive(
      { amount: "3.20", merchant: "7-Eleven", card: "" },
      new Date("2026-11-25T16:15:00Z"),
    );
    expect(store.rows[0].spendDate).toBe("2026-11-26");
  });

  it("asks for the S$ amount of a foreign payment instead of guessing", async () => {
    const { store, send, receive } = setup();
    const reply = await receive({
      amount: "¥500",
      merchant: "Lawson",
      card: "Visa",
    });
    expect(reply.text).toBe(
      "Logged ¥500 at Lawson (Visa). Send the S$ amount on Telegram.",
    );
    expect(store.rows[0]).toMatchObject({
      amountCents: null,
      status: "awaiting_sgd",
      currency: "JPY",
    });
    expect(store.rows[0].sgdRequestedUntil).toEqual(
      new Date(NOW.getTime() + 30 * 60_000),
    );
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("How much was that in S$?"),
      {
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "Enter S$ amount", callback_data: "ap:sgd:1" },
              { text: "Skip", callback_data: "ap:skip:1" },
            ],
          ],
        },
      },
    );
    // A plain amount on Telegram within 30 minutes is its S$ amount.
    const counted = await applySgdReply(
      store,
      412,
      "123",
      new Date(NOW.getTime() + 60_000),
    );
    expect(counted).toBe("Counted ¥500 at Lawson as S$4.12.\nToday: S$4.12");
    expect(await applySgdReply(store, 100, "123", NOW)).toBeNull();
  });

  it("counts the same payment sent twice only once", async () => {
    const { store, receive } = setup();
    const body = { amount: "S$5.40", merchant: "Starbucks", card: "DBS Visa" };
    await receive(body);
    const again = await receive(body, new Date(NOW.getTime() + 30_000));
    expect(again).toEqual({
      status: 200,
      text: "NUSHelper already has this payment.",
    });
    expect(store.rows).toHaveLength(1);
    // The same coffee later is a new payment.
    await receive(body, new Date(NOW.getTime() + 10 * 60_000));
    expect(store.rows).toHaveLength(2);
  });

  it("refuses unreadable amounts and too many payments in a day", async () => {
    const { store, receive } = setup();
    expect((await receive({ amount: "free" })).status).toBe(400);
    expect((await receive({})).status).toBe(400);
    for (let i = 0; i < MAX_PAYMENTS_PER_DAY; i++) {
      await receive({ amount: "1.00", merchant: `Shop ${i}`, card: "" });
    }
    expect(
      (await receive({ amount: "1.00", merchant: "One more" })).status,
    ).toBe(429);
    expect(store.rows).toHaveLength(MAX_PAYMENTS_PER_DAY);
  });

  it("still saves the payment when Telegram can't be reached", async () => {
    const { store, send, receive } = setup();
    send.mockRejectedValueOnce(new Error("Telegram down"));
    expect((await receive({ amount: "S$2" })).status).toBe(200);
    expect(store.rows).toHaveLength(1);
  });
});

describe("Undo and Skip", () => {
  it("takes an undone payment off the day, once", async () => {
    const { store, receive } = setup();
    await receive({ amount: "S$5.40", merchant: "Starbucks" });
    await receive({ amount: "S$3.00", merchant: "Kopi" });
    expect(await undoPayment(store, 1, "123")).toBe(
      "Undone: S$5.40 at Starbucks\nToday: S$3.00",
    );
    expect(await undoPayment(store, 1, "123")).toBe(
      "That payment was already undone.",
    );
  });

  it("skips a foreign payment so it isn't counted", async () => {
    const { store, receive } = setup();
    await receive({ amount: "€3,50", merchant: "Café" });
    expect(await skipPayment(store, 1)).toBe(
      "Skipped: €3,50 at Café isn't counted.",
    );
    expect(await applySgdReply(store, 500, "123", NOW)).toBeNull();
  });
});

describe("the 11:30pm message", () => {
  it("shows Apple Pay's total and asks only for the rest", () => {
    expect(nightlyPrompt({ count: 1, cents: 540 })).toBe(
      "expenditure: Apple Pay today S$5.40 (1 payment). Anything else, like cash or online? Reply with the amounts, or tap That's all.",
    );
  });
});
