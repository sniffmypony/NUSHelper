import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { formatCurrency } from "../expenditure.js";

// Apple Pay payments sent by the owner's iPhone (a Shortcuts "Transaction"
// automation). The phone sends the amount as text, e.g. "S$5.40" or "¥500";
// only Singapore dollars are counted straight away, anything else waits for
// the owner to give its S$ amount.

export interface ParsedAmount {
  currency: string; // ISO code, e.g. "SGD", "JPY"; "OTHER" when unknown
  // Cents for SGD; null for other currencies (never converted by guessing).
  cents: number | null;
}

// Symbols and prefixes, longest first so "US$" wins over "$".
const SYMBOLS: Array<[string, string]> = [
  ["SGD", "SGD"],
  ["S$", "SGD"],
  ["US$", "USD"],
  ["A$", "AUD"],
  ["HK$", "HKD"],
  ["NT$", "TWD"],
  ["NZ$", "NZD"],
  ["C$", "CAD"],
  ["RM", "MYR"],
  ["¥", "JPY"],
  ["￥", "JPY"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₩", "KRW"],
  ["฿", "THB"],
  ["₹", "INR"],
  ["₱", "PHP"],
  ["Rp", "IDR"],
  ["₫", "VND"],
  // A bare "$" on a Singapore iPhone is Singapore dollars.
  ["$", "SGD"],
];

export const MAX_AMOUNT_CENTS = 100_000_00; // S$100,000: anything above is a mistake

// "S$5.40", "SGD 5.40", "$1,234.50", "5.40", "5,40", "¥500", "JPY 500".
export function parseApplePayAmount(raw: string): ParsedAmount | null {
  let text = raw.replace(/\u00a0/g, " ").trim();
  if (!text || text.length > 40) return null;
  const negative = /^-|^\(.*\)$/.test(text);
  if (negative) return null;

  let currency: string | null = null;
  const code = /^([A-Z]{3})\s*|\s*([A-Z]{3})$/.exec(text);
  if (code) {
    currency = code[1] ?? code[2];
    text = text.replace(code[0], "").trim();
  }
  if (!currency) {
    for (const [symbol, iso] of SYMBOLS) {
      if (text.startsWith(symbol)) {
        currency = iso;
        text = text.slice(symbol.length).trim();
        break;
      }
      if (text.endsWith(symbol)) {
        currency = iso;
        text = text.slice(0, -symbol.length).trim();
        break;
      }
    }
  }
  currency ??= "SGD";
  if (/[^\d.,\s]/.test(text)) {
    // Some other symbol we don't know: keep it, but never count it as S$.
    if (!/^[^\d]{1,4}\s*[\d.,\s]+$/.test(text)) return null;
    currency = currency === "SGD" ? "OTHER" : currency;
    text = text.replace(/^[^\d]+/, "").trim();
  }

  // Normalise separators: "1,234.50" and "5,40" (a decimal comma).
  let number = text.replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(number)) {
    number = number.replace(/,/g, "");
  } else if (/^\d+,\d{1,2}$/.test(number)) {
    number = number.replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(number)) return null;
  if (currency !== "SGD") return { currency, cents: null };

  const [whole, fraction = ""] = number.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return { currency, cents };
}

// Shortcut fields are free text from the phone: kept short and single-line.
export function cleanField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Control characters (codes below 32, and 127) become spaces.
  const printable = [...value]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, max);
}

export function describePayment(payment: {
  amountText: string;
  amountCents: number | null;
  merchant: string;
  card: string;
}): string {
  const amount =
    payment.amountCents !== null
      ? formatCurrency(payment.amountCents)
      : payment.amountText;
  const at = payment.merchant ? ` at ${payment.merchant}` : "";
  const card = payment.card ? ` (${payment.card})` : "";
  return `${amount}${at}${card}`;
}

// ---- The key the shortcut sends ------------------------------------------

// Where the key's hash is kept (bot_settings, like the website's settings).
export const APPLE_PAY_KEY_SETTING = "APPLE_PAY_KEY_HASH";

// A new random key, shown to the owner once. Only its hash is stored.
export function newApplePayKey(): string {
  return `ap_${randomBytes(24).toString("base64url")}`;
}

export function hashApplePayKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export const KEY_FORMAT = /^ap_[A-Za-z0-9_-]{32}$/;

// The headers the shortcut may put the key in. "Authorisation" is how a
// British-English iPhone autocorrects "Authorization".
const KEY_HEADERS = ["authorization", "authorisation", "x-nushelper-key"];

export interface SuppliedKey {
  key: string | null;
  // For the diagnostic log; never the key itself.
  header: string | null;
  hadBearer: boolean;
  length: number;
  looksRight: boolean;
}

// The key from the request, forgiving the ways a phone mangles it: either
// spelling of the header, with or without "Bearer ", any letter case for
// "Bearer", surrounding quotes, and invisible or non-breaking spaces.
export function readSuppliedKey(
  headers: Record<string, string | string[] | undefined>,
): SuppliedKey {
  for (const name of KEY_HEADERS) {
    const raw = headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string" || !value.trim()) continue;
    let key = value
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/[\u00A0\u2000-\u200A\u202F\u3000]/g, " ")
      .trim()
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    const hadBearer = /^bearer\b/i.test(key);
    key = key.replace(/^bearer\s*:?\s*/i, "").trim();
    return {
      key,
      header: name,
      hadBearer,
      length: key.length,
      looksRight: KEY_FORMAT.test(key),
    };
  }
  return {
    key: null,
    header: null,
    hadBearer: false,
    length: 0,
    looksRight: false,
  };
}

// The supplied key checked against the stored hash, in constant time.
export function keyMatches(
  key: string | null,
  storedHash: string | undefined,
): boolean {
  if (!storedHash || !key) return false;
  const supplied = Buffer.from(hashApplePayKey(key), "hex");
  const wanted = Buffer.from(storedHash, "hex");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
