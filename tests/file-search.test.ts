import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import type {
  CanvasClient,
  CanvasFile,
  CanvasFolder,
} from "../src/canvas/client.js";
import { AssistantToolbox, searchPlan } from "../src/assistant/tools.js";
import {
  NOT_SENT_NOTE,
  runAssistant,
  withoutFalseSendClaims,
} from "../src/assistant/agent.js";

describe("search spellings", () => {
  it("searches the stem and letter form of numbered items", () => {
    expect(searchPlan("lecture 10").terms).toEqual(["lec", "l10"]);
    expect(searchPlan("tut 3").terms).toEqual(["tut", "t3", "t03"]);
    expect(searchPlan("rubrics").terms).toEqual(["rubrics"]);
    expect(searchPlan("lecture 10 slides").terms).toEqual(["lec", "l10"]);
    expect(searchPlan("CS2102 L10").terms).toEqual(["lec", "l10"]);
  });

  it("keeps only names with exactly that number", () => {
    const { fileMatches } = searchPlan("lecture 10");
    for (const name of [
      "L10 (annotated).pdf",
      "Lecture 10 - Normal forms.pdf",
      "lec10.pdf",
      "CS2102_Lect_10.pptx",
      "Lectures 10.pdf",
      "L010.pdf",
      "Lecture Notes 10.pdf",
    ]) {
      expect(fileMatches(name), name).toBe(true);
    }
    for (const name of [
      "L1.pdf",
      "L100.pdf",
      "Lab 10.pdf",
      "SQL10.pdf",
      "Lesson 10.pdf",
      "Lecture 11.pdf",
    ]) {
      expect(fileMatches(name), name).toBe(false);
    }
  });

  it("still finds the tutorial file sent earlier", () => {
    const { fileMatches } = searchPlan("tut 10");
    expect(fileMatches("Tutorial Week 10.pdf")).toBe(true);
    expect(fileMatches("Tutorial Week 1.pdf")).toBe(false);
    expect(fileMatches("Tutorial 3 Week 10.pdf")).toBe(false);
  });

  it("matches numbered folders such as Week 3", () => {
    const { folderMatches } = searchPlan("week 3");
    expect(folderMatches("Week 3", "course files/Week 3")).toBe(true);
    expect(folderMatches("Week 03 - Joins", "course files/x")).toBe(true);
    expect(folderMatches("Week 13", "course files/Week 13")).toBe(false);
  });
});

describe("searching several items at once", () => {
  const files: CanvasFile[] = [
    {
      id: 10,
      display_name: "L10 (annotated).pdf",
      filename: "L10.pdf",
      size: 2048,
      folder_id: 1,
    },
    {
      id: 9,
      display_name: "L9.pdf",
      filename: "L9.pdf",
      size: 2048,
      folder_id: 1,
    },
    {
      id: 100,
      display_name: "L100 notes.pdf",
      filename: "L100.pdf",
      size: 2048,
      folder_id: 1,
    },
  ];
  const folders: CanvasFolder[] = [
    { id: 1, name: "Lectures", full_name: "course files/Lectures" },
  ];

  function toolbox() {
    const searchFiles = vi.fn(async (_course: number, term: string) =>
      files.filter((f) =>
        f.display_name.toLowerCase().includes(term.toLowerCase()),
      ),
    );
    const canvas = {
      listActiveCourses: vi
        .fn()
        .mockResolvedValue([
          { id: 1, name: "CS2102 Database Systems", course_code: "CS2102" },
        ]),
      listFolders: vi.fn().mockResolvedValue(folders),
      listFolderFiles: vi.fn().mockResolvedValue([]),
      searchFiles,
    };
    return {
      canvas,
      tools: new AssistantToolbox(canvas as unknown as CanvasClient, {
        setUploading: vi.fn(),
        sendDocuments: vi.fn(),
      }),
    };
  }

  it("finds L10 for 'lecture 10' and reports a missing lecture 11 in one call", async () => {
    const { tools, canvas } = toolbox();
    const output = await tools.execute(
      "search_files",
      '{"module_code":"CS2102","queries":["lecture 10","lecture 11"]}',
    );
    expect(output).toBe(
      [
        '"lecture 10":\n1. id=10 | L10 (annotated).pdf | 2 KB | folder: Lectures',
        '"lecture 11": no matching files in CS2102.',
      ].join("\n\n"),
    );
    expect(canvas.listFolders).toHaveBeenCalledOnce();
  });

  it("tells the model not to keep searching when nothing matches", async () => {
    const { tools } = toolbox();
    await expect(
      tools.execute(
        "search_files",
        '{"module_code":"CS2102","queries":["lecture 11"]}',
      ),
    ).resolves.toMatch(/Don't search again/);
  });

  it("still accepts a single query string", async () => {
    const { tools } = toolbox();
    await expect(
      tools.execute("search_files", '{"module_code":"CS2102","query":"L9"}'),
    ).resolves.toBe("1. id=9 | L9.pdf | 2 KB | folder: Lectures");
  });
});

describe("false 'Sent' claims", () => {
  it("removes a send claim when nothing was sent", () => {
    expect(
      withoutFalseSendClaims(
        "Sent L10 (annotated).pdf (5.9 MB).\n\nThere's no L11 file in CS2102 yet.",
        false,
      ),
    ).toBe(`${NOT_SENT_NOTE}\n\nThere's no L11 file in CS2102 yet.`);
    expect(withoutFalseSendClaims("Sent L10.pdf.", false)).toBe(NOT_SENT_NOTE);
  });

  it("leaves replies alone when files were sent or nothing is claimed", () => {
    expect(withoutFalseSendClaims("Sent L10.pdf.", true)).toBe("Sent L10.pdf.");
    expect(withoutFalseSendClaims("No file was sent.", false)).toBe(
      "No file was sent.",
    );
  });

  it("tells the model nothing was sent when it runs out of steps", async () => {
    const search = {
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "s",
                type: "function",
                function: {
                  name: "search_files",
                  arguments: '{"module_code":"CS2102","queries":["L11"]}',
                },
              },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion;
    const create = vi.fn().mockResolvedValue(search);
    create.mockImplementation(async (body) =>
      body.tool_choice === "none"
        ? ({
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: "Sent L10 (annotated).pdf (5.9 MB).",
                },
              },
            ],
          } as unknown as ChatCompletion)
        : search,
    );
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "get me slides for cs2102, lecture 10 and 11",
      execute: vi.fn().mockResolvedValue("Error: No files match."),
    });
    const finalBody = create.mock.calls.at(-1)![0];
    expect(finalBody.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("No files were sent."),
    });
    expect(result.reply).toBe(NOT_SENT_NOTE);
  });
});
