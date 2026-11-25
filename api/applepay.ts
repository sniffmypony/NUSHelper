import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  APPLE_PAY_KEY_SETTING,
  keyMatches,
  readSuppliedKey,
} from "../src/apple-pay/payments.js";
import { receivePayment } from "../src/apple-pay/service.js";
import { applePayStore } from "../src/apple-pay/store.js";
import { optionalEnv, telegramOwnerId } from "../src/env.js";
import {
  forgetLoadedSettings,
  refreshSettings,
} from "../src/settings/runtime.js";
import { sendTo } from "../src/topics.js";

// Apple Pay payments from the owner's iPhone (a Shortcuts Wallet/Transaction
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

  const supplied = readSuppliedKey(req.headers);
  await refreshSettings();
  let stored = optionalEnv(APPLE_PAY_KEY_SETTING);
  let accepted = keyMatches(supplied.key, stored);
  if (!accepted && supplied.key) {
    // The saved key may have just been replaced: this instance keeps
    // settings for up to 30 seconds, so read them again before refusing.
    forgetLoadedSettings();
    await refreshSettings();
    stored = optionalEnv(APPLE_PAY_KEY_SETTING);
    accepted = keyMatches(supplied.key, stored);
  }
  if (!accepted) {
    // What arrived, never the key itself.
    console.log(
      `Apple Pay key refused: ${JSON.stringify({
        header: supplied.header,
        hadBearer: supplied.hadBearer,
        length: supplied.length,
        looksRight: supplied.looksRight,
        keySaved: Boolean(stored),
        headerNames: Object.keys(req.headers).sort(),
      })}`,
    );
    const text = !stored
      ? "NUSHelper: Apple Pay is off. Make a key in Settings → Apple Pay."
      : !supplied.key
        ? "NUSHelper got no key. Add the Authorization header with the key from Settings."
        : !supplied.looksRight
          ? `NUSHelper: that isn't a whole key (got ${supplied.length} characters; a key is "ap_" plus 32). Copy it again from Settings.`
          : "NUSHelper didn't accept this key: it isn't the newest one. Copy the latest from Settings → Apple Pay.";
    return res.status(401).send(text);
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
