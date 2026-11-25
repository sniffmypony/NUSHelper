import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  APPLE_PAY_KEY_SETTING,
  keyMatches,
} from "../src/apple-pay/payments.js";
import { receivePayment } from "../src/apple-pay/service.js";
import { applePayStore } from "../src/apple-pay/store.js";
import { optionalEnv, telegramOwnerId } from "../src/env.js";
import { refreshSettings } from "../src/settings/runtime.js";
import { sendTo } from "../src/topics.js";

// Apple Pay payments from the owner's iPhone (a Shortcuts "Transaction"
// automation). It sends JSON { amount, merchant, card } with
// "Authorization: Bearer <key>"; the key is made in Settings → Apple Pay and
// only its hash is stored. The reply is one plain line for the phone's
// notification.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Use POST.");
  }

  await refreshSettings();
  const header = req.headers.authorization;
  if (
    !keyMatches(
      Array.isArray(header) ? header[0] : header,
      optionalEnv(APPLE_PAY_KEY_SETTING),
    )
  ) {
    return res.status(401).send("NUSHelper didn't accept this key.");
  }

  try {
    const result = await receivePayment(req.body, {
      store: applePayStore,
      send: sendTo("expenditure"),
      ownerId: telegramOwnerId(),
      now: new Date(),
    });
    return res.status(result.status).send(result.text);
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Apple Pay payment failed (${type})`);
    return res.status(500).send("NUSHelper couldn't save this payment.");
  }
}
