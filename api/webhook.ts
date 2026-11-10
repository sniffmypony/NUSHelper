import type { VercelRequest, VercelResponse } from "@vercel/node";
import { bot } from "../src/bot.js";
import { isCalendarConfigured } from "../src/calendar/config.js";
import { ensureCalendarReadable } from "../src/calendar/google.js";
import { withVercelOidcToken } from "../src/calendar/request-context.js";
import { telegramBotToken } from "../src/env.js";
import {
  WEBHOOK_SECRET_HEADER,
  isValidWebhookSecret,
} from "../src/webhook-secret.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(200).send("ok");

  // Only Telegram knows the secret registered by `pnpm run setup:webhook`.
  // A rejected genuine update is retried by Telegram, so none are lost.
  if (
    !isValidWebhookSecret(
      req.headers[WEBHOOK_SECRET_HEADER],
      telegramBotToken(),
    )
  ) {
    console.error("Webhook request rejected: missing or wrong secret token");
    return res.status(401).send("unauthorized");
  }

  try {
    await withVercelOidcToken(req.headers["x-vercel-oidc-token"], async () => {
      // Google Calendar is optional; check access only when it is set up.
      if (isCalendarConfigured()) await ensureCalendarReadable();
      // Do not pass the Vercel response to Telegraf. Its webhook-reply
      // optimisation can end the response as soon as answerCbQuery is sent,
      // allowing the serverless invocation to stop before Calendar work ends.
      await bot.handleUpdate(req.body);
    });
    return res.status(200).send("ok");
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    console.error(`Webhook update failed (${errorType})`);
    return res.status(500).send("update failed");
  }
}
