import type { ChatCompletion } from "openai/resources/chat/completions";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/assistant/store.js", () => ({
  assistantStore: {},
  telegramFileCacheStore: {},
}));

import {
  describeDocument,
  documentKind,
  parsePageList,
  readDocument,
} from "../src/assistant/documents.js";
import { AssistantToolbox } from "../src/assistant/tools.js";
import { runAssistant } from "../src/assistant/agent.js";
import {
  answerAssistantMessage,
  attachmentFromMessage,
  type AssistantTelegram,
} from "../src/assistant/handlers.js";
import type { CanvasClient } from "../src/canvas/client.js";

// A minimal valid one-page PDF with the given lines of text.
function makePdf(lines: string[]): Buffer {
  const stream = lines
    .map((line, i) => `BT /F1 16 Tf 50 ${740 - i * 30} Td (${line}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const TUTORIAL = makePdf([
  "CS2102 Tutorial 10",
  "Q1. Find the candidate keys of R(A,B,C,D)",
  "Q2. Is R in BCNF? Justify.",
]);

function completion(message: Record<string, unknown>): ChatCompletion {
  return {
    choices: [{ index: 0, finish_reason: "stop", message }],
  } as unknown as ChatCompletion;
}

describe("reading documents", () => {
  it("extracts PDF text by page and renders page images", async () => {
    const doc = await readDocument("Tutorial 10.pdf", TUTORIAL);
    expect(doc.pageCount).toBe(1);
    expect(doc.text).toContain("--- page 1 ---");
    expect(doc.text).toContain("Q2. Is R in BCNF? Justify.");
    expect(doc.images).toHaveLength(1);
    expect(doc.images[0].url).toMatch(/^data:image\/png;base64,/);
    expect(describeDocument(doc)).toMatch(
      /^File: Tutorial 10\.pdf\nPages: 1\nPage images attached: page 1/,
    );
  });

  it("reads PowerPoint slides and Word paragraphs", async () => {
    const pptx = Buffer.from(
      zipSync({
        "ppt/slides/slide2.xml": strToU8(
          "<p:sld><a:p><a:r><a:t>Second &amp; last</a:t></a:r></a:p></p:sld>",
        ),
        "ppt/slides/slide1.xml": strToU8(
          "<p:sld><a:p><a:r><a:t>Normal forms</a:t></a:r></a:p></p:sld>",
        ),
      }),
    );
    const slides = await readDocument("L10.pptx", pptx);
    expect(slides.text).toBe(
      "--- slide 1 ---\nNormal forms\n\n--- slide 2 ---\nSecond & last",
    );

    const docx = Buffer.from(
      zipSync({
        "word/document.xml": strToU8(
          '<w:document><w:p><w:r><w:t>Q1.</w:t></w:r><w:r><w:t xml:space="preserve"> Define 3NF</w:t></w:r></w:p><w:p><w:r><w:t>Q2.</w:t></w:r></w:p></w:document>',
        ),
      }),
    );
    expect((await readDocument("t.docx", docx)).text).toBe(
      "Q1. Define 3NF\nQ2.",
    );
  });

  it("knows which files it can read", () => {
    expect(documentKind("a.pdf")).toBe("pdf");
    expect(documentKind("query.sql")).toBe("text");
    expect(documentKind("photo.JPG")).toBe("image");
    expect(documentKind("lecture.key")).toBe("unsupported");
  });

  it("parses page ranges within the document", () => {
    expect(parsePageList("2-4,7", 10)).toEqual([2, 3, 4, 7]);
    expect(parsePageList("9-20", 10)).toEqual([9, 10]);
    expect(parsePageList(undefined, 3)).toEqual([1, 2, 3]);
    expect(parsePageList(undefined, 40)).toHaveLength(6);
  });
});

describe("read_files tool", () => {
  it("downloads the Canvas file and queues its page images for the model", async () => {
    const canvas = {
      getFile: vi.fn().mockResolvedValue({
        id: 77,
        display_name: "Tutorial 10.pdf",
        filename: "T10.pdf",
        size: TUTORIAL.length,
        "content-type": "application/pdf",
      }),
      downloadFile: vi.fn().mockResolvedValue(TUTORIAL),
    };
    const tools = new AssistantToolbox(canvas as unknown as CanvasClient, {
      setUploading: vi.fn(),
      sendDocuments: vi.fn(),
    });
    const output = await tools.execute("read_files", '{"file_ids":[77]}');
    expect(output).toContain("Q2. Is R in BCNF?");
    const images = tools.takeImages();
    expect(images).toHaveLength(1);
    expect(images[0].label).toBe("Tutorial 10.pdf page 1");
    expect(tools.takeImages()).toEqual([]);
  });

  it("shows tool page images to the model and keeps history short", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        completion({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "r",
              type: "function",
              function: { name: "read_files", arguments: '{"file_ids":[77]}' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        completion({ role: "assistant", content: "R is not in BCNF." }),
      );
    const longText = `File: T10.pdf\nPages: 1\n\n${"x".repeat(10_000)}`;
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "solve q2",
      execute: vi.fn().mockResolvedValue(longText),
      takeImages: () => [
        { label: "T10.pdf page 1", url: "data:image/png;base64,AAA" },
      ],
    });
    const second = create.mock.calls[1][0].messages;
    expect(second.at(-1)).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("T10.pdf page 1") },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      ],
    });
    expect(result.toolContext).toBe("[read_files]\nFile: T10.pdf\nPages: 1");
  });
});

describe("files sent or replied to", () => {
  it("recognises readable documents and explains unreadable ones", () => {
    expect(
      attachmentFromMessage({
        document: {
          file_id: "d",
          file_name: "T10.pdf",
          mime_type: "application/pdf",
        },
      }),
    ).toEqual({
      kind: "file",
      fileId: "d",
      name: "T10.pdf",
      mimeType: "application/pdf",
    });
    expect(
      attachmentFromMessage({ document: { file_id: "d", file_name: "x.key" } }),
    ).toMatchObject({ kind: "unsupported" });
    expect(attachmentFromMessage({ text: "hi" })).toBeNull();
  });

  it("reads a file the user replied to and sends it with the question", async () => {
    const telegram = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      sendDocument: vi.fn(),
      sendMediaGroup: vi.fn(),
      sendRichMessage: vi.fn().mockResolvedValue(undefined),
      downloadFile: vi.fn().mockResolvedValue(TUTORIAL),
    } satisfies AssistantTelegram;
    const store = {
      claimUpdate: vi.fn(),
      recentTurns: vi.fn().mockResolvedValue([]),
      appendTurn: vi.fn().mockResolvedValue(undefined),
    };
    const create = vi
      .fn()
      .mockResolvedValue(
        completion({ role: "assistant", content: "Not BCNF." }),
      );

    await answerAssistantMessage(
      telegram,
      42,
      "solve q2",
      {
        store,
        runInBackground: vi.fn(),
        createCompletion: create,
        canvas: {} as CanvasClient,
        model: "m",
      },
      undefined,
      {
        kind: "file",
        fileId: "tg-doc",
        name: "Tutorial 10.pdf",
        mimeType: "application/pdf",
      },
    );

    expect(telegram.downloadFile).toHaveBeenCalledWith("tg-doc");
    const user = create.mock.calls[0][0].messages.at(-1);
    expect(user.content[0].text).toContain("solve q2");
    expect(user.content[0].text).toContain("<attached_file>");
    expect(user.content[0].text).toContain("Q2. Is R in BCNF? Justify.");
    expect(user.content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(store.appendTurn).toHaveBeenCalledWith(
      "42",
      "[File: Tutorial 10.pdf] solve q2",
      "Not BCNF.",
      "",
    );
  });
});
