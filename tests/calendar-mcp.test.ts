import { describe, expect, it, vi } from "vitest";
import { callCalendarTool } from "../src/calendar/mcp.js";

// A stand-in for Google's Calendar MCP server: initialize answers JSON with
// a session id, the notification gets 202, and the tool call answers as a
// server-sent event stream.
function fakeServer(toolReply: unknown) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const message = JSON.parse(String(init?.body));
    if (message.method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2025-06-18", capabilities: {} },
        }),
        {
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "session-1",
          },
        },
      );
    }
    if (message.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: toolReply })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  });
}

describe("calling Google's Calendar MCP server", () => {
  it("does the handshake and reads a streamed tool result", async () => {
    const server = fakeServer({
      content: [{ type: "text", text: '{"events":[{"summary":"Lecture"}]}' }],
    });
    const result = await callCalendarTool(
      "list_events",
      { pageSize: 5 },
      "access-1",
      server,
    );
    expect(result.content?.[0].text).toContain("Lecture");
    const calls = server.mock.calls.map(([, init]) => ({
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    }));
    expect(calls.map((call) => call.body.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    expect(calls[2].body.params).toEqual({
      name: "list_events",
      arguments: { pageSize: 5 },
    });
    expect(calls[2].headers.Authorization).toBe("Bearer access-1");
    expect(calls[2].headers["Mcp-Session-Id"]).toBe("session-1");
  });

  it("turns refusals into plain messages without the token", async () => {
    await expect(
      callCalendarTool(
        "list_events",
        {},
        "secret-token",
        fakeServer({
          isError: true,
          content: [{ type: "text", text: "Not found" }],
        }),
      ),
    ).rejects.toThrow("Google Calendar couldn't do that: Not found");
    const refused = vi.fn<typeof fetch>(
      async () => new Response("", { status: 401 }),
    );
    await expect(
      callCalendarTool("list_events", {}, "secret-token", refused),
    ).rejects.toThrow("Connect Google again in Settings");
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed: Bearer secret-token");
    });
    const error = await callCalendarTool(
      "list_events",
      {},
      "secret-token",
      offline,
    ).catch((failure: Error) => failure);
    expect(String(error)).not.toContain("secret-token");
  });
});
