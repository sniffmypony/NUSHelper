import { createHmac, timingSafeEqual } from "node:crypto";

// Telegram sends the secret given to setWebhook in this header on every
// update. Without the check, anyone who knows the webhook URL could post
// forged updates that appear to come from the owner.
export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

// Derived from the bot token so no extra secret has to be stored: it changes
// whenever the token is rotated, and the token never leaves the server. The
// hex output fits Telegram's allowed characters (A-Z, a-z, 0-9, _ and -).
export function webhookSecretFor(botToken: string): string {
  return createHmac("sha256", botToken)
    .update("telegram-webhook")
    .digest("hex");
}

export function isValidWebhookSecret(
  header: string | string[] | undefined,
  botToken: string,
): boolean {
  const received = Array.isArray(header) ? header[0] : header;
  if (!received) return false;
  const expected = Buffer.from(webhookSecretFor(botToken));
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
