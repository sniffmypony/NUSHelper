// Registers the Telegram webhook with the secret the webhook handler checks.
//
//   pnpm run setup:webhook https://<your-app>.vercel.app/api/webhook
//
// Reads TELEGRAM_BOT_TOKEN (or BOT_TOKEN) from the environment or ./.env.
// Prints Telegram's reply only, never the token or the secret.
import { existsSync, readFileSync } from "node:fs";
import { webhookSecretFor } from "../src/webhook-secret.ts";

function fromDotEnv(name: string): string | undefined {
  if (!existsSync(".env")) return undefined;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] === name) return match[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const token =
  process.env.TELEGRAM_BOT_TOKEN ??
  process.env.BOT_TOKEN ??
  fromDotEnv("TELEGRAM_BOT_TOKEN") ??
  fromDotEnv("BOT_TOKEN");
const url =
  process.argv[2] ?? process.env.WEBHOOK_URL ?? fromDotEnv("WEBHOOK_URL");

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in the environment or in .env first.");
  process.exit(1);
}
if (!url || !/^https:\/\/[^/]+\/api\/webhook$/.test(url)) {
  console.error(
    "Pass the webhook URL, e.g. https://your-app.vercel.app/api/webhook",
  );
  process.exit(1);
}

const response = await fetch(
  `https://api.telegram.org/bot${token}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: webhookSecretFor(token),
      // Only the update types the bot handles.
      allowed_updates: ["message", "edited_message", "callback_query"],
    }),
  },
);
const result = (await response.json()) as {
  ok?: boolean;
  description?: string;
};
console.log(
  result.ok
    ? `Webhook registered for ${url} with a secret token.`
    : `Telegram refused: ${result.description ?? `HTTP ${response.status}`}`,
);
process.exit(result.ok ? 0 : 1);
