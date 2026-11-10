import type { Context } from "telegraf";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/assistant/store.js", () => ({
  assistantStore: {},
  telegramFileCacheStore: {},
}));

import {
  CanvasAuthError,
  CanvasClient,
  nextPageUrl,
  type CanvasCourse,
  type CanvasFile,
} from "../src/canvas/client.js";
import { findCoursesByModule, moduleCodesFor } from "../src/canvas/modules.js";
import {
  cleanModelText,
  formatDueItemsByModule,
  splitTelegramMessage,
} from "../src/assistant/format.js";
import {
  AssistantToolbox,
  AssistantToolError,
  parseToolArguments,
} from "../src/assistant/tools.js";
import { runAssistant } from "../src/assistant/agent.js";
import {
  answerAssistantMessage,
  handleAssistantText,
  type AssistantTelegram,
} from "../src/assistant/handlers.js";
import { looksLikeCalendarMessage } from "../src/calendar/parser.js";

const BASE = "https://canvas.example.edu";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const courses: CanvasCourse[] = [
  { id: 1, name: "CS2102 Database Systems", course_code: "CS2102" },
  {
    id: 2,
    name: "CS2103T/CS2103R Software Engineering",
    course_code: "CS2103T",
  },
];

function completion(message: Record<string, unknown>): ChatCompletion {
  return {
    id: "c",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, finish_reason: "stop", logprobs: null, message }],
  } as unknown as ChatCompletion;
}

describe("Canvas client", () => {
  it("parses the next link from a Link header", () => {
    expect(
      nextPageUrl(
        `<${BASE}/api/v1/courses?page=1>; rel="current", <${BASE}/api/v1/courses?page=2>; rel="next"`,
      ),
    ).toBe(`${BASE}/api/v1/courses?page=2`);
    expect(nextPageUrl(`<${BASE}/x>; rel="last"`)).toBeNull();
  });

  it("follows pagination and sends the token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([courses[0]], {
          Link: `<${BASE}/api/v1/courses?page=2>; rel="next"`,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([courses[1]]));
    const client = new CanvasClient(BASE, "secret", fetchMock);

    await expect(client.listActiveCourses()).resolves.toEqual(courses);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("enrollment_state=active");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer secret",
    );
  });

  it("refuses to follow a pagination link to another host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([], { Link: `<https://evil.example/next>; rel="next"` }),
      );
    const client = new CanvasClient(BASE, "secret", fetchMock);
    await expect(client.listActiveCourses()).rejects.toThrow("unexpected link");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports an invalid token as CanvasAuthError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"errors":[{"message":"Invalid access token."}]}', {
        status: 401,
      }),
    );
    const client = new CanvasClient(BASE, "secret", fetchMock);
    await expect(client.listActiveCourses()).rejects.toBeInstanceOf(
      CanvasAuthError,
    );
  });

  it("does not send the token to the file store after a redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://files.example/signed" },
        }),
      )
      .mockResolvedValueOnce(new Response("pdf-bytes"));
    const client = new CanvasClient(BASE, "secret", fetchMock);
    const bytes = await client.downloadFile({
      url: `${BASE}/files/9/download`,
    } as CanvasFile);

    expect(bytes.toString()).toBe("pdf-bytes");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer secret",
    );
    expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
  });
});

describe("module matching", () => {
  it("extracts cross-listed module codes", () => {
    expect(moduleCodesFor(courses[1])).toEqual(["CS2103T", "CS2103R"]);
  });

  it("prefers exact module codes", () => {
    expect(findCoursesByModule(courses, "cs2103t").map((c) => c.id)).toEqual([
      2,
    ]);
    expect(findCoursesByModule(courses, "CS 2102").map((c) => c.id)).toEqual([
      1,
    ]);
    expect(findCoursesByModule(courses, "MA1521")).toEqual([]);
  });
});

describe("assistant formatting", () => {
  it("groups by module, sorts by due date and uses Singapore time", () => {
    const text = formatDueItemsByModule(
      [
        {
          moduleCode: "CS2103T",
          name: "iP",
          dueAt: "2026-11-05T15:59:00Z",
          submitted: false,
        },
        {
          moduleCode: "CS2102",
          name: "Project",
          dueAt: "2026-11-04T15:59:00Z",
          submitted: true,
        },
        {
          moduleCode: "CS2103T",
          name: "Quiz",
          dueAt: "2026-11-03T04:00:00Z",
          submitted: false,
        },
      ],
      7,
    );
    expect(text).toBe(
      [
        "Due in the next 7 days (Singapore time):",
        "",
        "CS2103T",
        "• Tue 3 Nov, 12:00 — Quiz",
        "• Thu 5 Nov, 23:59 — iP",
        "",
        "CS2102",
        "• Wed 4 Nov, 23:59 — Project ✅ submitted",
      ].join("\n"),
    );
  });

  it("splits long replies within Telegram's limit on line breaks", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const chunks = splitTelegramMessage(text, 60);
    expect(chunks.every((chunk) => chunk.length <= 60)).toBe(true);
    expect(chunks.join("\n")).toBe(text);
    expect(splitTelegramMessage("x".repeat(130), 60)).toHaveLength(3);
  });

  it("strips reasoning and tool data from model output", () => {
    expect(
      cleanModelText("<think>hmm</think>Hi<tool_data>id=1</tool_data>"),
    ).toBe("Hi");
    // Markdown is kept for rich messages; toPlainText handles the fallback.
    expect(cleanModelText("**Answer:** $x = 1$")).toBe("**Answer:** $x = 1$");
  });
});

describe("assistant tools", () => {
  it("rejects malformed tool arguments", () => {
    expect(() => parseToolArguments("{not json")).toThrow(AssistantToolError);
    expect(() => parseToolArguments("[1]")).toThrow(AssistantToolError);
    expect(parseToolArguments("")).toEqual({});
  });

  function toolbox(canvas: Partial<CanvasClient>) {
    const delivery = {
      sendDocuments: vi.fn().mockResolvedValue(["tg-file-1"]),
      setUploading: vi.fn(),
    };
    return {
      delivery,
      tools: new AssistantToolbox(canvas as CanvasClient, delivery),
    };
  }

  it("returns malformed arguments to the model as an error", async () => {
    const { tools } = toolbox({});
    await expect(tools.execute("send_files", "{oops")).resolves.toMatch(
      /^Error: /,
    );
  });

  it("explains an unknown module", async () => {
    const { tools } = toolbox({
      listActiveCourses: vi.fn().mockResolvedValue(courses),
    });
    await expect(
      tools.execute("search_files", '{"module_code":"MA1521","query":"l5"}'),
    ).resolves.toContain('No active Canvas module matches "MA1521"');
  });

  it("does not upload files above Telegram's 50 MB limit", async () => {
    const downloadFile = vi.fn();
    const { tools, delivery } = toolbox({
      getFile: vi.fn().mockResolvedValue({
        id: 5,
        display_name: "Lecture 5.mp4",
        size: 80 * 1024 * 1024,
      }),
      downloadFile,
    });
    await expect(
      tools.execute("send_files", '{"file_ids":[5]}'),
    ).resolves.toMatch(/Lecture 5\.mp4 is 80\.0 MB/);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(delivery.sendDocuments).not.toHaveBeenCalled();
  });

  it("uploads bytes when Telegram cannot fetch the file itself", async () => {
    const resolveSignedUrl = vi.fn();
    const { tools, delivery } = toolbox({
      getFile: vi.fn().mockResolvedValue({
        id: 5,
        display_name: "L5.pptx",
        filename: "L5.pptx",
        size: 3,
      }),
      resolveSignedUrl,
      downloadFile: vi.fn().mockResolvedValue(Buffer.from("ppt")),
    });
    await expect(tools.execute("send_files", '{"file_ids":[5]}')).resolves.toBe(
      "Sent L5.pptx (3 B).",
    );
    expect(resolveSignedUrl).not.toHaveBeenCalled();
    expect(delivery.sendDocuments).toHaveBeenCalledWith([
      {
        filename: "L5.pptx",
        source: { kind: "bytes", bytes: Buffer.from("ppt") },
      },
    ]);
  });

  it("lets an expired Canvas token stop the run", async () => {
    const { tools } = toolbox({
      listActiveCourses: vi.fn().mockRejectedValue(new CanvasAuthError()),
    });
    await expect(tools.execute("list_modules", "{}")).rejects.toBeInstanceOf(
      CanvasAuthError,
    );
  });
});

describe("assistant loop", () => {
  it("executes tool calls and returns the final answer", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        completion({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "t1",
              type: "function",
              function: { name: "list_modules", arguments: "{}" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        completion({ role: "assistant", content: "You take CS2102." }),
      );
    const execute = vi.fn().mockResolvedValue("CS2102 — Database Systems");

    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "what modules?",
      execute,
    });

    expect(result.reply).toBe("You take CS2102.");
    expect(result.toolContext).toContain("CS2102 — Database Systems");
    expect(execute).toHaveBeenCalledWith("list_modules", "{}");
    const secondCall = create.mock.calls[1][0];
    expect(secondCall.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "t1",
      content: "CS2102 — Database Systems",
    });
  });

  it("stops after the iteration cap", async () => {
    const toolCall = completion({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "t",
          type: "function",
          function: { name: "list_modules", arguments: "{}" },
        },
      ],
    });
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce(toolCall)
      .mockResolvedValueOnce(
        completion({ role: "assistant", content: "Best effort." }),
      );

    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "loop",
      execute: vi.fn().mockResolvedValue("x"),
    });
    expect(result.reply).toBe("Best effort.");
    expect(create).toHaveBeenCalledTimes(6);
    expect(create.mock.calls[5][0].tool_choice).toBe("none");
  });
});

describe("assistant Telegram handling", () => {
  function telegramFake(): AssistantTelegram & {
    sendMessage: ReturnType<typeof vi.fn>;
  } {
    return {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      sendDocument: vi.fn().mockResolvedValue(undefined),
      sendMediaGroup: vi.fn().mockResolvedValue([]),
      sendRichMessage: vi.fn().mockResolvedValue(undefined),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from("img")),
    };
  }

  it("ignores a retried update that was already claimed", async () => {
    const store = {
      claimUpdate: vi.fn().mockResolvedValue(false),
      recentTurns: vi.fn(),
      appendTurn: vi.fn(),
    };
    const runInBackground = vi.fn();
    const ctx = {
      chat: { id: 42 },
      update: { update_id: 7 },
      telegram: telegramFake(),
    } as unknown as Context;

    await handleAssistantText(ctx, "what's due?", { store, runInBackground });
    expect(store.claimUpdate).toHaveBeenCalledWith(7);
    expect(runInBackground).not.toHaveBeenCalled();
  });

  it("replies with a friendly message when the Canvas token expired", async () => {
    const telegram = telegramFake();
    const store = {
      claimUpdate: vi.fn(),
      recentTurns: vi.fn().mockResolvedValue([]),
      appendTurn: vi.fn(),
    };
    const create = vi.fn().mockResolvedValue(
      completion({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "t1",
            type: "function",
            function: { name: "list_modules", arguments: "{}" },
          },
        ],
      }),
    );
    const canvas = {
      listActiveCourses: vi.fn().mockRejectedValue(new CanvasAuthError()),
    } as unknown as CanvasClient;

    await answerAssistantMessage(telegram, 42, "modules?", {
      store,
      runInBackground: vi.fn(),
      createCompletion: create,
      canvas,
      model: "m",
    });
    expect(telegram.sendMessage).toHaveBeenCalledOnce();
    expect(telegram.sendMessage.mock.calls[0][1]).toMatch(
      /Canvas rejected the API token/,
    );
    expect(store.appendTurn).not.toHaveBeenCalled();
  });
});

describe("free-text routing", () => {
  it("only treats event-shaped text as calendar input", () => {
    expect(looksLikeCalendarMessage("12:00-18:00, Homework, 22-08-2026")).toBe(
      true,
    );
    expect(looksLikeCalendarMessage("12-2, Tutorial, 2026-09-05")).toBe(true);
    expect(looksLikeCalendarMessage("what's due this week?")).toBe(false);
    expect(looksLikeCalendarMessage("what's due, for CS2102, this week")).toBe(
      false,
    );
  });
});
