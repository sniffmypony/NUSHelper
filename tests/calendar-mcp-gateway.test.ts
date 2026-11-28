import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantCalendarOff,
  assistantCalendarGateway,
  MCP_REQUIRED_FROM,
} from "../src/calendar/assistant-gateway.js";
import {
  agendaEvent,
  localTime,
  McpCalendarGateway,
} from "../src/calendar/mcp-gateway.js";
import type { ParsedCalendarEvent } from "../src/calendar/parser.js";
import { replaceSettingOverrides } from "../src/setting-overrides.js";

vi.mock("../src/calendar/google.js", () => ({
  getCalendarGateway: vi.fn(async () => ({ kind: "service-account" })),
}));

// A Calendar MCP server that answers each tool call with `answer(name, args)`.
function server(
  answer: (name: string, args: Record<string, unknown>) => unknown,
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const message = JSON.parse(String(init?.body));
    if (!("id" in message)) return new Response(null, { status: 202 });
    let result: unknown = { protocolVersion: "2025-06-18" };
    if (message.method === "tools/call") {
      calls.push({ name: message.params.name, args: message.params.arguments });
      result = answer(message.params.name, message.params.arguments);
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  });
  const gateway = new McpCalendarGateway(async () => "token", fetchImpl);
  return { gateway, calls };
}

const json = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

const dinner: ParsedCalendarEvent = {
  title: "Dinner",
  startDateTime: "2026-12-07T19:00:00+08:00",
  endDateTime: "2026-12-07T21:00:00+08:00",
  allDay: false,
  repeat: "weekly",
  timeZone: "Asia/Singapore",
  calendarId: "me@gmail.com",
  isPast: false,
};

afterEach(() => replaceSettingOverrides(new Map()));

describe("the assistant's calendar through MCP", () => {
  it("sends local times with the time zone named", () => {
    expect(localTime("2026-12-07T19:00:00+08:00")).toBe("2026-12-07T19:00:00");
    expect(localTime("2026-12-07T11:00:00Z")).toBe("2026-12-07T11:00:00");
    expect(localTime("2026-12-07")).toBe("2026-12-07T00:00:00");
  });

  it("reads events in REST's field names or flatter ones", () => {
    expect(
      agendaEvent({
        id: "e1",
        summary: "Lecture",
        start: { dateTime: "2026-12-07T10:00:00+08:00" },
        end: { dateTime: "2026-12-07T12:00:00+08:00" },
      }),
    ).toMatchObject({ id: "e1", title: "Lecture", allDay: false });
    expect(
      agendaEvent({
        eventId: "e2",
        title: "Exam",
        startTime: "2026-12-08T00:00:00",
        endTime: "2026-12-09T00:00:00",
        allDay: true,
      }),
    ).toEqual({
      id: "e2",
      title: "Exam",
      htmlLink: null,
      allDay: true,
      startDate: "2026-12-08",
      endDate: "2026-12-09",
    });
    expect(agendaEvent({ id: "e3", status: "cancelled" })).toBeNull();
  });

  it("creates on the chosen calendar without emails, and keeps Google's id", async () => {
    replaceSettingOverrides(new Map([["GOOGLE_CALENDAR_ID", "me@gmail.com"]]));
    const { gateway, calls } = server(() =>
      json({ id: "google-id-1", htmlLink: "https://cal/1" }),
    );
    expect(await gateway.create("our-id", dinner)).toEqual({
      id: "google-id-1",
      htmlLink: "https://cal/1",
    });
    expect(calls[0]).toEqual({
      name: "create_event",
      args: {
        calendarId: "me@gmail.com",
        summary: "Dinner",
        startTime: "2026-12-07T19:00:00",
        endTime: "2026-12-07T21:00:00",
        allDay: false,
        timeZone: "Asia/Singapore",
        recurrenceData: ["RRULE:FREQ=WEEKLY"],
        notificationLevel: "NONE",
      },
    });
  });

  it("finds the new event's id in structured content too", async () => {
    const { gateway } = server(() => ({
      structuredContent: { event: { id: "g2" } },
    }));
    expect((await gateway.create("x", { ...dinner, repeat: null })).id).toBe(
      "g2",
    );
  });

  it("treats a missing event as already gone", async () => {
    const { gateway } = server(() => ({
      isError: true,
      content: [{ type: "text", text: "Event not found" }],
    }));
    expect(await gateway.delete("gone")).toBe("already-deleted");
    expect(await gateway.get("gone")).toBeNull();
    expect(await gateway.getAgendaEvent("gone")).toBeNull();
  });

  it("lists a range across pages", async () => {
    let page = 0;
    const { gateway, calls } = server(() =>
      json(
        page++ === 0
          ? {
              events: [
                {
                  id: "a",
                  summary: "A",
                  start: { date: "2026-12-07" },
                  end: { date: "2026-12-08" },
                },
              ],
              nextPageToken: "p2",
            }
          : {
              events: [
                {
                  id: "b",
                  summary: "B",
                  start: { date: "2026-12-09" },
                  end: { date: "2026-12-10" },
                },
              ],
            },
      ),
    );
    const events = await gateway.listRange(
      "2026-12-07T00:00:00+08:00",
      "2026-12-14T00:00:00+08:00",
    );
    expect(events.map((event) => event.id)).toEqual(["a", "b"]);
    expect(calls[1].args).toMatchObject({
      pageToken: "p2",
      timeZone: "Asia/Singapore",
    });
  });
});

describe("which way the assistant reaches Calendar", () => {
  const before = new Date(MCP_REQUIRED_FROM.getTime() - 1);

  it("uses MCP once Google is connected", async () => {
    replaceSettingOverrides(
      new Map([
        ["GOOGLE_OAUTH_CLIENT_ID", "id"],
        ["GOOGLE_OAUTH_CLIENT_SECRET", "secret"],
        ["GOOGLE_OAUTH_REFRESH_TOKEN", "rt"],
      ]),
    );
    expect(await assistantCalendarGateway(before)).toBeInstanceOf(
      McpCalendarGateway,
    );
  });

  it("keeps the service account until 1 February 2027, then asks to connect", async () => {
    expect(await assistantCalendarGateway(before)).toEqual({
      kind: "service-account",
    });
    await expect(
      assistantCalendarGateway(MCP_REQUIRED_FROM),
    ).rejects.toBeInstanceOf(AssistantCalendarOff);
  });
});
