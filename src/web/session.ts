import { createHmac, timingSafeEqual } from "node:crypto";

// The website's sign-in: a signed cookie, valid 60 days. Viewing or changing
// keys also needs a "fresh" sign-in, within the last 10 minutes. Raising
// the session version (Sign out everywhere) invalidates every cookie.

export const SESSION_COOKIE = "nh_session";
export const SESSION_SECONDS = 60 * 24 * 60 * 60;
export const FRESH_SECONDS = 10 * 60;

export interface Session {
  uid: string;
  iat: number; // when the cookie was issued (seconds)
  authAt: number; // when Telegram confirmed the sign-in (seconds)
  v: number; // session version
}

function key(botToken: string): Buffer {
  return createHmac("sha256", botToken)
    .update("nushelper-web-session-v1")
    .digest();
}

function signature(payload: string, botToken: string): Buffer {
  return createHmac("sha256", key(botToken)).update(payload).digest();
}

export function signSession(session: Session, botToken: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${signature(payload, botToken).toString("base64url")}`;
}

export function verifySession(
  token: string | undefined,
  botToken: string,
  nowSeconds: number,
  version: number,
): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = signature(payload, botToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let session: Session;
  try {
    session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Session;
  } catch {
    return null;
  }
  if (
    typeof session.uid !== "string" ||
    typeof session.iat !== "number" ||
    typeof session.authAt !== "number" ||
    session.v !== version ||
    nowSeconds - session.iat > SESSION_SECONDS ||
    session.iat > nowSeconds + 60
  ) {
    return null;
  }
  return session;
}

export function isFresh(session: Session, nowSeconds: number): boolean {
  return nowSeconds - session.authAt <= FRESH_SECONDS;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=");
  }
  return undefined;
}
