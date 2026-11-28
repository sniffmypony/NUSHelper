import { optionalEnv } from "../env.js";
import { googleAccessToken } from "../google-oauth.js";
import { getCalendarGateway, type GoogleCalendarGateway } from "./google.js";
import { McpCalendarGateway } from "./mcp-gateway.js";

// Which way the assistant (an AI) reaches Google Calendar. From 1 February
// 2027 Google's terms require AI tools to use its Calendar MCP server with
// the owner's own sign-in (Settings → Assistant's Google access). Until
// then, without that sign-in, the assistant keeps the service account.
// Everything else (typed messages, the Calendar page, scheduled jobs) always
// uses the service account.

export const MCP_REQUIRED_FROM = new Date("2027-02-01T00:00:00+08:00");

export class AssistantCalendarOff extends Error {
  constructor() {
    super(
      "The assistant can't use Google Calendar until you connect Google in Settings → Assistant's Google access.",
    );
    this.name = "AssistantCalendarOff";
  }
}

export function assistantUsesMcp(): boolean {
  return Boolean(
    optionalEnv("GOOGLE_OAUTH_CLIENT_ID") &&
    optionalEnv("GOOGLE_OAUTH_CLIENT_SECRET") &&
    optionalEnv("GOOGLE_OAUTH_REFRESH_TOKEN"),
  );
}

export async function assistantCalendarGateway(
  now = new Date(),
): Promise<McpCalendarGateway | GoogleCalendarGateway> {
  if (assistantUsesMcp()) {
    return new McpCalendarGateway(() =>
      googleAccessToken({
        clientId: optionalEnv("GOOGLE_OAUTH_CLIENT_ID")!,
        clientSecret: optionalEnv("GOOGLE_OAUTH_CLIENT_SECRET")!,
        refreshToken: optionalEnv("GOOGLE_OAUTH_REFRESH_TOKEN")!,
      }),
    );
  }
  if (now >= MCP_REQUIRED_FROM) throw new AssistantCalendarOff();
  return getCalendarGateway();
}
