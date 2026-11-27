// Registers the Telegram webhook with the secret the webhook handler checks.
// (Once you can sign in to the website, Settings → Telegram → Connect does
// the same.)
//
//   pnpm run setup:webhook https://<your-app>.vercel.app/api/webhook
//
// Reads TELEGRAM_BOT_TOKEN (or BOT_TOKEN) from the environment or ./.env.
// Prints Telegram's reply only, never the token or the secret.
import { registerWebhook } from "../src/telegram-webhook.ts";
import { webhookSecretFor } from "../src/webhook-secret.ts";
import { setting } from "./env-file.ts";

const token = setting("TELEGRAM_BOT_TOKEN", "BOT_TOKEN");
const url = process.argv[2] ?? setting("WEBHOOK_URL");

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in the environment or in .env first.");
  process.exit(1);
}
if (!url) {
  console.error(
    "Pass the webhook URL, e.g. https://your-app.vercel.app/api/webhook",
  );
  process.exit(1);
}

try {
  await registerWebhook(token, url, webhookSecretFor(token));
  console.log(`Webhook registered for ${url} with a secret token.`);
} catch (error) {
  console.error(
    `Telegram refused: ${error instanceof Error ? error.message : "failed"}`,
  );
  process.exit(1);
}
