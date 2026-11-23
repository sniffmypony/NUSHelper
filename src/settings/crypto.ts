import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

// Keys saved on the website are stored encrypted (AES-256-GCM). The key is
// derived from the bot token, like the webhook secret, so no extra variable
// is needed. Changing the bot token makes saved keys unreadable: the bot
// then uses the Vercel values again and the website asks for them anew.

function encryptionKey(botToken: string): Buffer {
  return createHmac("sha256", botToken)
    .update("nushelper-settings-encryption-v1")
    .digest();
}

export function encryptSecret(plaintext: string, botToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(botToken), iv);
  const data = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}

// null when it can't be decrypted (wrong key, tampered, other format).
export function decryptSecret(stored: string, botToken: string): string | null {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(botToken),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function lastFour(secret: string): string {
  return secret.slice(-4);
}
