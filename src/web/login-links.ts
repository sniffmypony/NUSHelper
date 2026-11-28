import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { webLoginLinks } from "../db/schema.js";
import { optionalEnv } from "../env.js";

// Sign-in by link: the owner sends /web to the bot and gets a one-time link
// to the website. It is the fallback for Telegram Login, whose confirmation
// message doesn't always arrive. Only the owner's chat can receive it.

export const LINK_TTL_MS = 20 * 60_000;

export interface LoginLinkStore {
  add(tokenHash: string, expiresAt: Date): Promise<void>;
  // Marks the link used if it is unused and unexpired; true if it was.
  consume(tokenHash: string, now: Date): Promise<boolean>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createLoginToken(
  store: LoginLinkStore,
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await store.add(hashToken(token), new Date(now.getTime() + LINK_TTL_MS));
  return token;
}

export function consumeLoginToken(
  store: LoginLinkStore,
  token: string,
  now = new Date(),
): Promise<boolean> {
  if (!/^[\w-]{20,100}$/.test(token)) return Promise.resolve(false);
  return store.consume(hashToken(token), now);
}

// The website's address: WEB_URL if set, else the Vercel project's
// production domain (a system variable Vercel provides).
export function websiteUrl(): string | null {
  const configured = optionalEnv("WEB_URL");
  if (configured) return configured.replace(/\/+$/, "");
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return domain ? `https://${domain}` : null;
}

// The token goes after "#", which browsers never send to a server, so link
// previews and scanners can't use it up; the page reads it and posts it.
export function loginLink(base: string, token: string): string {
  return `${base}/login#token=${token}`;
}

export const loginLinkStore: LoginLinkStore = {
  async add(tokenHash, expiresAt) {
    await db
      .delete(webLoginLinks)
      .where(lt(webLoginLinks.expiresAt, new Date()));
    await db.insert(webLoginLinks).values({ tokenHash, expiresAt });
  },
  async consume(tokenHash, now) {
    const rows = await db
      .update(webLoginLinks)
      .set({ usedAt: now })
      .where(
        and(
          eq(webLoginLinks.tokenHash, tokenHash),
          isNull(webLoginLinks.usedAt),
          gt(webLoginLinks.expiresAt, now),
        ),
      )
      .returning({ tokenHash: webLoginLinks.tokenHash });
    return rows.length > 0;
  },
};
