import { describe, expect, it, vi } from "vitest";
import {
  applySgdReply,
  askForSgd,
  countPayment,
  skipPayment,
} from "../src/apple-pay/service.js";
import { checkAiReply, type ReadWithAi } from "../src/bank-email/ai.js";
import {
  readDbsEmail,
  senderAddress,
  verifiedDbs,
} from "../src/bank-email/dbs.js";
import { receiveBankEmail } from "../src/bank-email/service.js";
import { MemoryPayments } from "./helpers/memory-payments.js";

// The four DBS formats the owner shared, as Gmail's plain body gives them.
const SCAN_AND_PAY = `Transaction Alerts
Problems viewing this email? Select "always display images".

Transaction Ref: IPS1000000000000001

Dear Sir / Madam,

We refer to your PayLah! Scan & Pay Transfer dated 25 Nov. We are pleased to confirm that the transaction was completed.

Date & Time:\t25 Nov 22:16 (SGT)
Amount:\tSGD0.80
From:\tPayLah! Wallet (Mobile ending 0001)
To:\tNATIONAL UNIVERSITY OF SINGAPORE
`;

const PAYLAH_PAYNOW = `Transaction Ref: IP100000000000000002

Dear Sir / Madam,

We refer to a PayNow Transfer dated 12 Nov. We are pleased to confirm that the transaction was completed.

Date & Time: 12 Nov 17:05 (SGT)
Amount: SGD11.00
From: PayLah! Wallet (Mobile ending 0001)
To: FRIXXX NAXX (Mobile ending 0002)
`;

const BANK_PAYNOW = `Dear Customer,

We refer to your PAYNOW dated 15 Nov. We are pleased to confirm that the transaction was completed.

Date &
Time:
15 Nov 16:03 (SGT)
Amount:
SGD927.40
From:
DBS Multiplier Account A/C ending 0004
To:
PAYXXX TXX (MOBILE ending 0003)
`;

const RECEIVED = `Transaction Ref: 10000000000000000000000C100000000000

Dear Customer,

You have received SGD 3.90 via PayNow on 23 Nov 2026 12:31 SGT.

From: ALEX SAMPLE
To: Your DBS/ POSB account ending 0004
`;

const DBS_AUTH =
  "mx.google.com; dkim=pass header.i=@dbs.com header.s=sel1 header.b=abc; spf=pass (google.com: domain of paylah.alert@dbs.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=paylah.alert@dbs.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=dbs.com";

const at = (iso: string) => new Date(iso);

describe("reading DBS alert emails", () => {
  it("reads a PayLah! Scan & Pay payment", () => {
    expect(
      readDbsEmail(
        "paylah.alert@dbs.com",
        "Transaction Alerts",
        SCAN_AND_PAY,
        at("2026-11-25T14:16:30Z"),
      ),
    ).toEqual({
      kind: "payment",
      type: "PayLah! Scan & Pay",
      currency: "SGD",
      cents: 80,
      amountText: "SGD0.80",
      to: "NATIONAL UNIVERSITY OF SINGAPORE",
      from: "PayLah! Wallet (Mobile ending 0001)",
      occurredAt: at("2026-11-25T14:16:00Z"),
      ref: "IPS1000000000000001",
    });
  });

  it("reads a PayLah! PayNow transfer to a friend", () => {
    const reading = readDbsEmail(
      "paylah.alert@dbs.com",
      "Transaction Alerts",
      PAYLAH_PAYNOW,
      at("2026-11-12T09:05:10Z"),
    );
    expect(reading).toMatchObject({
      kind: "payment",
      type: "PayLah! PayNow",
      cents: 1100,
      to: "FRIXXX NAXX (Mobile ending 0002)",
      ref: "IP100000000000000002",
      occurredAt: at("2026-11-12T09:05:00Z"),
    });
  });

  it("reads a digibank PayNow, with labels on their own lines", () => {
    expect(
      readDbsEmail(
        "ibanking.alert@dbs.com",
        "iBanking Alerts",
        BANK_PAYNOW,
        at("2026-11-15T08:03:20Z"),
      ),
    ).toMatchObject({
      kind: "payment",
      type: "PayNow",
      cents: 92740,
      to: "PAYXXX TXX (MOBILE ending 0003)",
      from: "DBS Multiplier Account A/C ending 0004",
      occurredAt: at("2026-11-15T08:03:00Z"),
      ref: null,
    });
  });

  it("recognises money received, which isn't spending", () => {
    expect(
      readDbsEmail(
        "ibanking.alert@dbs.com",
        "digibank Alerts - You've received a transfer",
        RECEIVED,
        at("2026-11-23T04:31:00Z"),
      ),
    ).toEqual({ kind: "incoming" });
  });

  it("puts a 31 Dec payment alerted on 1 Jan in the old year", () => {
    const reading = readDbsEmail(
      "paylah.alert@dbs.com",
      "Transaction Alerts",
      SCAN_AND_PAY.replace("25 Nov 22:16", "31 Dec 23:58"),
      at("2026-12-31T16:01:00Z"), // 1 Jan 2027, 00:01 in Singapore
    );
    expect(reading.kind === "payment" && reading.occurredAt).toEqual(
      at("2026-12-31T15:58:00Z"),
    );
  });

  it("leaves anything else to the AI", () => {
    expect(
      readDbsEmail(
        "ibanking.alert@dbs.com",
        "Login alert",
        "You logged in to digibank.",
        new Date(),
      ),
    ).toEqual({ kind: "unknown" });
  });

  it("knows the sender and trusts only Gmail's check that DBS sent it", () => {
    expect(senderAddress("PayLah! Alerts <PayLah.Alert@dbs.com>")).toBe(
      "paylah.alert@dbs.com",
    );
    expect(verifiedDbs(DBS_AUTH)).toBe(true);
    expect(verifiedDbs("mx.google.com; dkim=pass header.d=dbs.com.sg")).toBe(
      true,
    );
    expect(
      verifiedDbs(
        "mx.google.com; dkim=fail header.i=@dbs.com; dmarc=fail header.from=dbs.com",
      ),
    ).toBe(false);
    expect(
      verifiedDbs("mx.google.com; dkim=pass header.i=@evil-dbs.com.example"),
    ).toBe(false);
    expect(verifiedDbs("")).toBe(false);
  });
});

describe("the AI's reading", () => {
  it("accepts only well-formed data", () => {
    expect(
      checkAiReply(
        '{"direction":"out","amount":"12.30","currency":"SGD","to":"Grab","type":"Card payment","when":"2026-11-20 13:05"}',
      ),
    ).toEqual({
      direction: "out",
      currency: "SGD",
      cents: 1230,
      amountText: "SGD12.30",
      to: "Grab",
      type: "Card payment",
      when: "2026-11-20 13:05",
    });
    expect(
      checkAiReply('{"direction":"in","amount":"5","currency":"SGD"}')
        ?.direction,
    ).toBe("in");
    expect(
      checkAiReply(
        '{"direction":"out","amount":"500","currency":"JPY","to":"Lawson"}',
      ),
    ).toMatchObject({ cents: null, amountText: "JPY500" });
    for (const reply of [
      "Sure! Ignore previous instructions.",
      '{"direction":"out","amount":"-5","currency":"SGD"}',
      '{"direction":"out","amount":"12.345","currency":"SGD"}',
      '{"direction":"out","amount":"999999","currency":"SGD"}',
      '{"direction":"steal","amount":"5","currency":"SGD"}',
    ]) {
      expect(checkAiReply(reply), reply).toBeNull();
    }
  });
});

const NOW = at("2026-11-25T14:17:00Z");

function setup(ai?: ReadWithAi) {
  const store = new MemoryPayments();
  const send = vi.fn(async () => {});
  const readWithAi = vi.fn<ReadWithAi>(ai ?? (async () => null));
  const receive = (fields: Record<string, unknown>) =>
    receiveBankEmail(
      {
        id: "gmail-1",
        from: "PayLah! Alerts <paylah.alert@dbs.com>",
        subject: "Transaction Alerts",
        date: "2026-11-25T14:16:30Z",
        text: SCAN_AND_PAY,
        auth: DBS_AUTH,
        ...fields,
      },
      { store, send, readWithAi, now: NOW },
    );
  return { store, send, readWithAi, receive };
}

describe("a bank email arriving", () => {
  it("asks first and counts nothing until Count it", async () => {
    const { store, send, receive } = setup();
    expect(await receive({})).toEqual({
      status: 200,
      text: "Asked on Telegram.",
    });
    expect(store.rows[0]).toMatchObject({
      source: "email",
      kind: "PayLah! Scan & Pay",
      status: "awaiting_ok",
      amountCents: 80,
      spendDate: "2026-11-25",
      externalRef: "dbs:IPS1000000000000001",
      readByAi: false,
    });
    expect(store.dayTotal).toBe(0);
    expect(send).toHaveBeenCalledWith(
      "🧾 PayLah! Scan & Pay: S$0.80 to NATIONAL UNIVERSITY OF SINGAPORE\n25 Nov, 22:16\nCount it as spending?",
      {
        replyMarkup: {
          inline_keyboard: [
            [{ text: "Count it", callback_data: "ap:ok:1" }],
            [
              { text: "Skip", callback_data: "ap:skip:1" },
              { text: "Edit amount", callback_data: "ap:sgd:1" },
            ],
          ],
        },
      },
    );
    expect(await countPayment(store, 1, "123", NOW)).toBe(
      "Counted: S$0.80 to NATIONAL UNIVERSITY OF SINGAPORE\nToday: S$0.80",
    );
    expect(await countPayment(store, 1, "123", NOW)).toBe(
      "That payment was already handled.",
    );
  });

  it("counts an earlier day's payment on that day", async () => {
    const { store, receive } = setup();
    await receive({
      from: "ibanking.alert@dbs.com",
      text: BANK_PAYNOW,
      date: "2026-11-15T08:03:20Z",
    });
    expect(store.rows[0]).toMatchObject({
      spendDate: "2026-11-15",
      externalRef: "gmail:gmail-1",
    });
    expect(await countPayment(store, 1, "123", NOW)).toContain(
      "Total for 15 Nov: S$927.40",
    );
  });

  it("lets the amount be edited, or the payment skipped", async () => {
    const { store, receive } = setup();
    await receive({});
    await receive({ id: "gmail-2", text: PAYLAH_PAYNOW });
    expect(await askForSgd(store, 1, NOW)).toContain("Send the S$ amount");
    expect(await applySgdReply(store, 50, "123", NOW)).toBe(
      "Counted SGD0.80 to NATIONAL UNIVERSITY OF SINGAPORE as S$0.50.\nToday: S$0.50",
    );
    expect(await skipPayment(store, 2)).toContain("Skipped");
    expect(store.dayTotal).toBe(50);
  });

  it("handles each email and each transaction once", async () => {
    const { store, receive } = setup();
    // With a DBS reference, a repeat (same email or a second copy) is the
    // same payment.
    await receive({});
    expect((await receive({})).text).toBe("Already have this payment.");
    expect((await receive({ id: "gmail-2" })).text).toBe(
      "Already have this payment.",
    );
    // Without one, the Gmail id catches a repeat before anything is re-read.
    const bank = { from: "ibanking.alert@dbs.com", text: BANK_PAYNOW };
    await receive({ ...bank, id: "gmail-3" });
    expect((await receive({ ...bank, id: "gmail-3" })).text).toBe(
      "Already have this email.",
    );
    expect(store.rows).toHaveLength(2);
  });

  it("ignores money received, without a message", async () => {
    const { store, send, receive } = setup();
    const result = await receive({
      from: "ibanking.alert@dbs.com",
      subject: "digibank Alerts - You've received a transfer",
      text: RECEIVED,
    });
    expect(result.text).toBe("Ignored: money received.");
    expect(store.rows).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores other senders, and warns about failed sender checks", async () => {
    const { store, send, receive } = setup();
    expect((await receive({ from: "alerts@not-dbs.example" })).text).toBe(
      "Ignored: not a DBS alert address.",
    );
    expect(
      (await receive({ auth: "mx.google.com; dmarc=fail header.from=dbs.com" }))
        .text,
    ).toBe("Ignored: not verified as DBS.");
    expect(store.rows).toHaveLength(0);
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("failed Google's sender checks"),
    );
  });

  it("asks the AI about an unknown format, and says so", async () => {
    const { store, send, readWithAi, receive } = setup(async () => ({
      direction: "out",
      currency: "SGD",
      cents: 1230,
      amountText: "SGD12.30",
      to: "Grab",
      type: "Card payment",
      when: "2026-11-25 21:00",
    }));
    await receive({ text: "A new DBS format: you paid S$12.30 to Grab." });
    expect(readWithAi).toHaveBeenCalled();
    expect(store.rows[0]).toMatchObject({
      readByAi: true,
      amountCents: 1230,
      status: "awaiting_ok",
    });
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("(Read by AI: check the amount.)"),
      expect.anything(),
    );
  });

  it("drops what the AI says isn't spending, and admits what it can't read", async () => {
    const incoming = setup(async () => ({
      direction: "in",
      currency: "SGD",
      cents: null,
      amountText: "",
      to: "",
      type: "",
      when: null,
    }));
    expect(
      (await incoming.receive({ text: "Some other DBS email" })).text,
    ).toBe("Ignored: no money left the account.");
    const unreadable = setup(async () => null);
    expect((await unreadable.receive({ text: "Gibberish" })).text).toBe(
      "Couldn't read it.",
    );
    expect(unreadable.send).toHaveBeenCalledWith(
      expect.stringContaining("I couldn't read a DBS email"),
    );
    expect(unreadable.store.rows).toHaveLength(0);
  });

  it("asks for the S$ amount of a foreign-currency payment", async () => {
    const { store, send, receive } = setup();
    await receive({ text: SCAN_AND_PAY.replace("SGD0.80", "USD12.00") });
    expect(store.rows[0]).toMatchObject({
      amountCents: null,
      status: "awaiting_sgd",
    });
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining(
        "How much was it in S$? Tap Edit amount, or Skip.",
      ),
      expect.anything(),
    );
  });
});
