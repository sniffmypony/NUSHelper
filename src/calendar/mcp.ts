// A minimal client for Google's Calendar MCP server: the JSON-RPC handshake
// over Streamable HTTP, then one tool call. Replies may come as JSON or as
// a server-sent event stream; both are read. Signed in as the owner (see
// google-oauth.ts); errors never include the access token.

export const CALENDAR_MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";
const PROTOCOL_VERSION = "2025-06-18";

type Fetch = typeof fetch;

export interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export class CalendarMcpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    // A refusal from the server's tool itself (not sign-in or network).
    readonly fromTool = false,
  ) {
    super(message);
    this.name = "CalendarMcpError";
  }
}

interface JsonRpcMessage {
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

// The JSON-RPC reply with this id, from a JSON body or an SSE stream.
function readReply(
  body: string,
  contentType: string,
  id: number,
): JsonRpcMessage | null {
  const messages: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // Not a JSON-RPC message.
      }
    }
  } else if (body.trim()) {
    try {
      const parsed = JSON.parse(body);
      messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      return null;
    }
  }
  return (
    (messages.find(
      (message) => (message as JsonRpcMessage)?.id === id,
    ) as JsonRpcMessage) ?? null
  );
}

export async function callCalendarTool(
  name: string,
  args: Record<string, unknown>,
  accessToken: string,
  fetchImpl: Fetch = fetch,
): Promise<ToolResult> {
  let session: string | null = null;
  let version = PROTOCOL_VERSION;

  const post = async (message: object): Promise<Response> => {
    try {
      return await fetchImpl(CALENDAR_MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": version,
          ...(session ? { "Mcp-Session-Id": session } : {}),
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CalendarMcpError("Couldn't reach Google Calendar.");
    }
  };

  const request = async (id: number, method: string, params: object) => {
    const response = await post({ jsonrpc: "2.0", id, method, params });
    if (response.status === 401 || response.status === 403) {
      throw new CalendarMcpError(
        "Google refused the assistant's sign-in. Connect Google again in Settings.",
        response.status,
      );
    }
    if (!response.ok) {
      throw new CalendarMcpError(
        `Google Calendar answered HTTP ${response.status}.`,
        response.status,
      );
    }
    session = response.headers.get("mcp-session-id") ?? session;
    const reply = readReply(
      await response.text(),
      response.headers.get("content-type") ?? "",
      id,
    );
    if (!reply) throw new CalendarMcpError("Google Calendar sent no reply.");
    if (reply.error) {
      throw new CalendarMcpError(
        `Google Calendar refused: ${reply.error.message ?? `error ${reply.error.code}`}.`,
        undefined,
        true,
      );
    }
    return reply.result;
  };

  const init = (await request(1, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "nushelper", version: "1" },
  })) as { protocolVersion?: string } | undefined;
  if (typeof init?.protocolVersion === "string") version = init.protocolVersion;
  // A notification: no reply expected (202 Accepted).
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });

  const result = (await request(2, "tools/call", {
    name,
    arguments: args,
  })) as ToolResult;
  if (result?.isError) {
    const text = result.content?.find((part) => part.text)?.text ?? "";
    throw new CalendarMcpError(
      `Google Calendar couldn't do that${text ? `: ${text.slice(0, 200)}` : "."}`,
      undefined,
      true,
    );
  }
  return result;
}
