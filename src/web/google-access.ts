import { DateTime } from "luxon";
import { calendarId } from "../calendar/config.js";
import { callCalendarTool, shapeOf, type ToolResult } from "../calendar/mcp.js";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import { optionalEnv } from "../env.js";
import {
  checkState,
  clearNonceCookie,
  finishGoogleSignIn,
  forgetGoogleAccessTokens,
  googleAccessToken,
  GOOGLE_NONCE_COOKIE,
  revokeGoogleSignIn,
  startGoogleSignIn,
} from "../google-oauth.js";
import { encryptSecret, lastFour } from "../settings/crypto.js";
import type { SettingsStore } from "../settings/store.js";
import { readCookie } from "./session.js";

// Settings → Google Calendar → Assistant access: the owner signs in to
// their own Google account once, and the assistant reaches Calendar through
// Google's MCP server with that sign-in (required for AI tools from
// February 2027). The client ID and secret are website settings; the
// lasting sign-in is stored encrypted like the other keys.

export const CLIENT_ID = "GOOGLE_OAUTH_CLIENT_ID";
export const CLIENT_SECRET = "GOOGLE_OAUTH_CLIENT_SECRET";
export const REFRESH_TOKEN = "GOOGLE_OAUTH_REFRESH_TOKEN";
export const ACCOUNT = "GOOGLE_OAUTH_ACCOUNT";

export interface GoogleAccessStatus {
  clientId: boolean;
  clientSecret: boolean;
  connected: boolean;
  account: string | null;
}

export interface GoogleAccess {
  status(): GoogleAccessStatus;
  // The address to send the browser to, and the cookie that ties the return
  // trip to this browser.
  start(uid: string, nowSeconds: number): { url: string; cookie: string };
  // Google's redirect back: where to send the browser next.
  finish(
    query: Record<string, string>,
    cookieHeader: string | undefined,
    nowSeconds: number,
  ): Promise<{ redirect: string; cookie: string }>;
  disconnect(): Promise<void>;
  check(): Promise<{ count: number | null }>;
}

export interface GoogleAccessDependencies {
  store: SettingsStore;
  botToken(): string;
  ownerId(): string;
  siteUrl(): string | null;
  settingsChanged(): Promise<void>;
  fetchImpl?: typeof fetch;
}

function clientConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = optionalEnv(CLIENT_ID);
  const clientSecret = optionalEnv(CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// The events in a list_events reply, wherever the server puts them.
function eventsIn(result: ToolResult): unknown[] | null {
  const look = (value: unknown): unknown[] | null => {
    if (Array.isArray(value)) return value;
    const events = (value as { events?: unknown } | null)?.events;
    return Array.isArray(events) ? events : null;
  };
  const structured = look(result.structuredContent);
  if (structured) return structured;
  for (const part of result.content ?? []) {
    if (!part.text) continue;
    try {
      const parsed = look(JSON.parse(part.text));
      if (parsed) return parsed;
    } catch {
      // Plain text.
    }
  }
  return null;
}

export function googleAccess(deps: GoogleAccessDependencies): GoogleAccess {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const settings = (reason: string) => `/settings?google=${reason}`;

  return {
    status() {
      return {
        clientId: Boolean(optionalEnv(CLIENT_ID)),
        clientSecret: Boolean(optionalEnv(CLIENT_SECRET)),
        connected: Boolean(optionalEnv(REFRESH_TOKEN)),
        account: optionalEnv(ACCOUNT) ?? null,
      };
    },

    start(uid, nowSeconds) {
      const client = clientConfig();
      const siteUrl = deps.siteUrl();
      if (!client) throw new Error("Add the client ID and secret first.");
      if (!siteUrl)
        throw new Error("This site's address isn't known; set WEB_URL.");
      return startGoogleSignIn({
        clientId: client.clientId,
        siteUrl,
        botToken: deps.botToken(),
        uid,
        nowSeconds,
      });
    },

    async finish(query, cookieHeader, nowSeconds) {
      const done = (reason: string) => ({
        redirect: settings(reason),
        cookie: clearNonceCookie,
      });
      if (query.error) return done("denied");
      const checked = checkState(
        query.state ?? "",
        readCookie(cookieHeader, GOOGLE_NONCE_COOKIE),
        deps.botToken(),
        nowSeconds,
      );
      if (!checked || checked.uid !== deps.ownerId() || !query.code) {
        return done("expired");
      }
      const client = clientConfig();
      const siteUrl = deps.siteUrl();
      if (!client || !siteUrl) return done("expired");
      try {
        const signedIn = await finishGoogleSignIn({
          code: query.code,
          nonce: checked.nonce,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          siteUrl,
          botToken: deps.botToken(),
          fetchImpl,
        });
        // One after the other (single database connection).
        await deps.store.setSecret(
          REFRESH_TOKEN,
          encryptSecret(signedIn.refreshToken, deps.botToken()),
          lastFour(signedIn.refreshToken),
        );
        if (signedIn.email) await deps.store.setValue(ACCOUNT, signedIn.email);
        await deps.store.addAudit("google", "connected");
        forgetGoogleAccessTokens();
        await deps.settingsChanged();
        return done("connected");
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed";
        return {
          redirect: `${settings("error")}&reason=${encodeURIComponent(message)}`,
          cookie: clearNonceCookie,
        };
      }
    },

    async disconnect() {
      const refreshToken = optionalEnv(REFRESH_TOKEN);
      if (refreshToken) await revokeGoogleSignIn(refreshToken, fetchImpl);
      await deps.store.clearSecret(REFRESH_TOKEN);
      await deps.store.clearValue(ACCOUNT);
      await deps.store.addAudit("google", "disconnected");
      forgetGoogleAccessTokens();
      await deps.settingsChanged();
    },

    // Read-only: next week's events through the MCP server. The reply's
    // shape (never its contents) is logged, to see what the server sends.
    async check() {
      const client = clientConfig();
      const refreshToken = optionalEnv(REFRESH_TOKEN);
      if (!client || !refreshToken) throw new Error("Connect Google first.");
      const token = await googleAccessToken({
        ...client,
        refreshToken,
        fetchImpl,
      });
      const now = DateTime.now().setZone(SINGAPORE_TIME_ZONE);
      const local = "yyyy-LL-dd'T'HH:mm:ss";
      const result = await callCalendarTool(
        "list_events",
        {
          ...(calendarId() ? { calendarId: calendarId() } : {}),
          startTime: now.toFormat(local),
          endTime: now.plus({ days: 7 }).toFormat(local),
          timeZone: SINGAPORE_TIME_ZONE,
          pageSize: 5,
        },
        token,
        fetchImpl,
      );
      let textShape: unknown = null;
      const text = result.content?.find((part) => part.text)?.text;
      if (text) {
        try {
          textShape = shapeOf(JSON.parse(text));
        } catch {
          textShape = "plain text";
        }
      }
      console.log(
        `Calendar MCP list_events reply shape: ${JSON.stringify({ result: shapeOf(result), text: textShape })}`,
      );
      return { count: eventsIn(result)?.length ?? null };
    },
  };
}
