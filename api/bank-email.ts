import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  BANK_EMAIL_KEY_SETTING,
  keyMatches,
  readSuppliedKey,
} from "../src/apple-pay/payments.js";
import { applePayStore } from "../src/apple-pay/store.js";
import { readWithAi } from "../src/bank-email/ai.js";
import { receiveBankEmail } from "../src/bank-email/service.js";
import { optionalEnv } from "../src/env.js";
import {
  forgetLoadedSettings,
  refreshSettings,
} from "../src/settings/runtime.js";
import { sendTo } from "../src/topics.js";

// DBS alert emails from the owner's Google Apps Script (Settings → Bank
// emails). The script sends { id, from, subject, date, text, auth } with
// "Authorization: Bearer <key>"; only the key's hash is stored. The bot never
// reads Gmail itself.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Use POST.");
  }

  const supplied = readSuppliedKey(req.headers);
  await refreshSettings();
  let stored = optionalEnv(BANK_EMAIL_KEY_SETTING);
  let accepted = keyMatches(supplied.key, stored);
  if (!accepted && supplied.key) {
    // A key replaced moments ago: read the settings again before refusing.
    forgetLoadedSettings();
    await refreshSettings();
    stored = optionalEnv(BANK_EMAIL_KEY_SETTING);
    accepted = keyMatches(supplied.key, stored);
  }
  if (!accepted) {
    console.log(
      `Bank email key refused: ${JSON.stringify({
        header: supplied.header,
        length: supplied.length,
        looksRight: supplied.looksRight,
        keySaved: Boolean(stored),
      })}`,
    );
    return res
      .status(401)
      .send(
        !stored
          ? "Bank emails are off. Make a key in Settings → Bank emails."
          : "NUSHelper didn't accept this key. Copy the latest from Settings → Bank emails.",
      );
  }

  try {
    const result = await receiveBankEmail(req.body, {
      store: applePayStore,
      send: sendTo("expenditure"),
      readWithAi,
      now: new Date(),
    });
    return res.status(result.status).send(result.text);
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Bank email failed (${type})`);
    return res.status(500).send("NUSHelper couldn't handle this email.");
  }
}
