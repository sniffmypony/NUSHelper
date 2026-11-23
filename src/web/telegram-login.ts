import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Telegram Login Widget data, checked as Telegram documents it
// (core.telegram.org/widgets/login#checking-authorization): the hash is an
// HMAC-SHA256 of the other fields, sorted and joined by newlines, keyed with
// SHA-256 of the bot token. Only Telegram (holding the token) can make it.

export type LoginCheck =
  | { ok: true; id: string; authDate: number }
  | { ok: false; reason: "bad-signature" | "expired" | "malformed" };

// A login is accepted only shortly after Telegram signed it, so a captured
// one can't be replayed later.
export const LOGIN_MAX_AGE_SECONDS = 10 * 60;

export function verifyTelegramLogin(
  data: Record<string, unknown>,
  botToken: string,
  nowSeconds: number,
): LoginCheck {
  const { hash, ...fields } = data;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, reason: "malformed" };
  }
  const entries = Object.entries(fields);
  if (
    entries.some(
      ([, value]) => typeof value !== "string" && typeof value !== "number",
    )
  ) {
    return { ok: false, reason: "malformed" };
  }
  const checkString = entries
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  const authDate = Number(fields.auth_date);
  const id = fields.id;
  if (!Number.isSafeInteger(authDate) || id === undefined) {
    return { ok: false, reason: "malformed" };
  }
  if (
    nowSeconds - authDate > LOGIN_MAX_AGE_SECONDS ||
    authDate > nowSeconds + 60
  ) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, id: String(id), authDate };
}
