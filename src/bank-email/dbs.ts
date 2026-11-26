import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";

// DBS alert emails (PayLah! and digibank), read without AI. Formats seen:
//
//   PayLah! Scan & Pay   "We refer to your PayLah! Scan & Pay Transfer dated
//                         25 Nov. … the transaction was completed."
//   PayLah! PayNow       "We refer to a PayNow Transfer dated 12 Nov. …"
//   digibank PayNow      "We refer to your PAYNOW dated 15 Nov. …"
//       each followed by Date & Time / Amount / From / To (and sometimes a
//       Transaction Ref)
//   Money received       "You have received SGD 3.90 via PayNow on 23 Nov
//                         2026 12:31 SGT." (ignored: not spending)

export const DBS_SENDERS = ["paylah.alert@dbs.com", "ibanking.alert@dbs.com"];

export type DbsReading =
  | { kind: "incoming" }
  | {
      kind: "payment";
      type: string; // e.g. "PayLah! Scan & Pay", "PayNow"
      currency: string;
      // Cents for SGD; null for other currencies (asked, never converted).
      cents: number | null;
      amountText: string; // e.g. "SGD927.40"
      to: string;
      from: string;
      // When it happened (Singapore time), or null if the email has no time.
      occurredAt: Date | null;
      ref: string | null;
    }
  | { kind: "unknown" };

// Email text as Gmail's plain body gives it: tabs, odd spaces, labels and
// values sometimes on separate lines.
function normalise(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[\t\u00A0\u2000-\u200A\u202F]+/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/ +/g, " ");
}

function field(text: string, label: RegExp): string | null {
  const match = label.exec(text);
  if (!match) return null;
  const value = match[1].replace(/\s+/g, " ").trim();
  return value || null;
}

function tidyType(raw: string, sender: string): string {
  if (/scan\s*&\s*pay/i.test(raw)) return "PayLah! Scan & Pay";
  if (/paynow/i.test(raw)) {
    return sender.startsWith("paylah") ? "PayLah! PayNow" : "PayNow";
  }
  const cleaned = raw
    .replace(/\btransfer\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Payment").slice(0, 40);
}

export function cents(amount: string): number | null {
  const plain = amount.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(plain)) return null;
  const [whole, fraction = ""] = plain.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

// "25 Nov" + "22:16", in the year the email arrived (a December payment
// alerted on 1 January belongs to the year before).
export function occurredAt(
  day: string,
  time: string,
  year: number | null,
  emailDate: Date,
): Date | null {
  const received = DateTime.fromJSDate(emailDate).setZone(SINGAPORE_TIME_ZONE);
  const build = (y: number) =>
    DateTime.fromFormat(`${day} ${y} ${time}`, "d LLL yyyy H:mm", {
      zone: SINGAPORE_TIME_ZONE,
      locale: "en-SG",
    });
  let when = build(year ?? received.year);
  if (!when.isValid) return null;
  if (!year && when > received.plus({ days: 2 })) {
    when = build(received.year - 1);
  }
  return when.toJSDate();
}

export function readDbsEmail(
  sender: string,
  subject: string,
  body: string,
  emailDate: Date,
): DbsReading {
  const text = normalise(`${subject}\n${body}`);

  if (/\byou have received\b|\byou'?ve received\b/i.test(text)) {
    return { kind: "incoming" };
  }

  const reference = /We refer to (?:your|a)\s+(.+?)\s+dated\s/i.exec(text);
  const completed = /transaction was completed/i.test(text);
  const amount = /Amount:\s*([A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (!reference || !completed || !amount) return { kind: "unknown" };

  const currency = amount[1].toUpperCase();
  const value = cents(amount[2]);
  if (value === null || value === 0) return { kind: "unknown" };

  const when =
    /Date\s*&\s*Time:\s*(\d{1,2}\s+[A-Za-z]{3})(?:\s+(\d{4}))?\s+(\d{1,2}:\d{2})/i.exec(
      text,
    );
  // From/To come after the amount; the first match after it is the one.
  const after = text.slice(amount.index);
  return {
    kind: "payment",
    type: tidyType(reference[1], sender),
    currency,
    cents: currency === "SGD" ? value : null,
    amountText: `${currency}${amount[2]}`,
    to: (field(after, /\bTo:\s*([^\n]+)/i) ?? "").slice(0, 120),
    from: (field(after, /\bFrom:\s*([^\n]+)/i) ?? "").slice(0, 120),
    occurredAt: when
      ? occurredAt(
          when[1],
          when[3],
          when[2] ? Number(when[2]) : null,
          emailDate,
        )
      : null,
    ref: field(text, /Transaction Ref:\s*([A-Za-z0-9-]{6,64})/i),
  };
}

// The sender's address from "PayLah! Alerts <paylah.alert@dbs.com>".
export function senderAddress(from: string): string {
  const angle = /<([^>]+)>/.exec(from);
  return (angle ? angle[1] : from).trim().toLowerCase();
}

// Gmail's own check that the email really came from DBS (its
// Authentication-Results header): DMARC pass for dbs.com, or a DKIM
// signature from a dbs.com domain.
export function verifiedDbs(authenticationResults: string): boolean {
  const auth = authenticationResults.replace(/\s+/g, " ");
  return (
    /dmarc=pass\b[^;]*header\.from=(?:[\w-]+\.)*dbs\.com(?:\.sg)?\b/i.test(
      auth,
    ) ||
    /dkim=pass\b[^;]*header\.(?:d|i)=@?(?:[\w-]+\.)*dbs\.com(?:\.sg)?\b/i.test(
      auth,
    )
  );
}
