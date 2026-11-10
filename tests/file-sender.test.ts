import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import {
  CanvasAuthError,
  CanvasClient,
  type CanvasFile,
} from "../src/canvas/client.js";
import { sendCanvasFiles } from "../src/assistant/file-sender.js";
import type { TelegramFileCache } from "../src/assistant/store.js";
import { runAssistant } from "../src/assistant/agent.js";

const BASE = "https://canvas.example.edu";

function file(overrides: Partial<CanvasFile>): CanvasFile {
  return {
    id: 1,
    display_name: "Lecture 1.pdf",
    filename: "Lecture_1.pdf",
    size: 1000,
    folder_id: 1,
    url: `${BASE}/files/1/download`,
    updated_at: "2026-10-01T00:00:00Z",
    "content-type": "application/pdf",
    ...overrides,
  };
}

function setup(files: CanvasFile[], cached = new Map()) {
  const canvas = {
    getFile: vi.fn(async (id: number) => {
      const found = files.find((f) => f.id === id);
      if (!found) throw new Error("not found");
      return found;
    }),
    resolveSignedUrl: vi.fn(
      async (f: CanvasFile) => `https://files.example/signed/${f.id}`,
    ),
    downloadFile: vi.fn(async (f: CanvasFile) => Buffer.from(`bytes-${f.id}`)),
  };
  const delivery = {
    setUploading: vi.fn(),
    sendDocuments: vi.fn(async (docs: unknown[]) =>
      docs.map((_, index) => `tg-${index}`),
    ),
  };
  const cache: TelegramFileCache = {
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn().mockResolvedValue(undefined),
  };
  return {
    canvas,
    delivery,
    cache,
    send: (ids: number[]) =>
      sendCanvasFiles(ids, {
        canvas: canvas as unknown as CanvasClient,
        delivery,
        cache,
      }),
  };
}

describe("sending Canvas files", () => {
  it("lets Telegram fetch small PDFs from the signed URL", async () => {
    const { send, delivery, canvas, cache } = setup([file({})]);
    await expect(send([1])).resolves.toBe("Sent Lecture 1.pdf (1000 B).");
    expect(canvas.downloadFile).not.toHaveBeenCalled();
    expect(delivery.sendDocuments).toHaveBeenCalledWith([
      {
        filename: "Lecture 1.pdf",
        source: { kind: "url", url: "https://files.example/signed/1" },
      },
    ]);
    expect(cache.set).toHaveBeenCalledWith([
      {
        canvasFileId: 1,
        canvasUpdatedAt: "2026-10-01T00:00:00Z",
        telegramFileId: "tg-0",
      },
    ]);
  });

  it("reuses a cached Telegram copy while the Canvas file is unchanged", async () => {
    const { send, delivery, canvas, cache } = setup(
      [file({}), file({ id: 2, display_name: "Lecture 2.pdf" })],
      new Map([
        [
          1,
          {
            canvasFileId: 1,
            canvasUpdatedAt: "2026-10-01T00:00:00Z",
            telegramFileId: "cached-1",
          },
        ],
        [
          2,
          {
            canvasFileId: 2,
            canvasUpdatedAt: "2025-01-01T00:00:00Z",
            telegramFileId: "stale-2",
          },
        ],
      ]),
    );
    await send([1, 2]);
    const [documents] = delivery.sendDocuments.mock.calls[0] as [
      Array<{ source: { kind: string } }>,
    ];
    expect(documents.map((d) => d.source.kind)).toEqual(["cached", "url"]);
    expect(canvas.resolveSignedUrl).toHaveBeenCalledTimes(1);
    // Only the newly sent file is written back.
    expect(
      (cache.set as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toHaveLength(1);
  });

  it("sends several files in one album call", async () => {
    const { send, delivery } = setup([
      file({}),
      file({
        id: 2,
        display_name: "Tut 2.pptx",
        filename: "Tut_2.pptx",
        "content-type": "application/vnd.ms-powerpoint",
      }),
    ]);
    await expect(send([1, 2])).resolves.toBe(
      "Sent Lecture 1.pdf (1000 B), Tut 2.pptx (1000 B).",
    );
    expect(delivery.sendDocuments).toHaveBeenCalledOnce();
    const [documents] = delivery.sendDocuments.mock.calls[0] as [
      Array<{ source: { kind: string } }>,
    ];
    expect(documents.map((d) => d.source.kind)).toEqual(["url", "bytes"]);
  });

  it("falls back to uploading when Telegram rejects a URL or cached id", async () => {
    const { send, delivery, canvas } = setup([file({})]);
    delivery.sendDocuments.mockRejectedValueOnce(
      new Error("failed to get HTTP URL content"),
    );
    await expect(send([1])).resolves.toMatch(/^Sent /);
    expect(canvas.downloadFile).toHaveBeenCalledOnce();
    const [retry] = delivery.sendDocuments.mock.calls[1] as [
      Array<{ source: { kind: string } }>,
    ];
    expect(retry[0].source.kind).toBe("bytes");
  });

  it("uploads large PDFs instead of using a URL", async () => {
    const { send, delivery, canvas } = setup([
      file({ size: 30 * 1024 * 1024 }),
    ]);
    await send([1]);
    expect(canvas.resolveSignedUrl).not.toHaveBeenCalled();
    const [documents] = delivery.sendDocuments.mock.calls[0] as [
      Array<{ source: { kind: string } }>,
    ];
    expect(documents[0].source.kind).toBe("bytes");
  });

  it("keeps working when the cache is unavailable", async () => {
    const { send, cache } = setup([file({})]);
    (cache.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    );
    await expect(send([1])).resolves.toMatch(/^Sent /);
  });

  it("reports files it could not open and still sends the rest", async () => {
    const { send } = setup([file({})]);
    await expect(send([1, 99])).resolves.toBe(
      "Sent Lecture 1.pdf (1000 B). File 99 could not be opened on Canvas.",
    );
  });

  it("stops on an expired Canvas token", async () => {
    const { send, canvas } = setup([file({})]);
    canvas.getFile.mockRejectedValueOnce(new CanvasAuthError());
    await expect(send([1])).rejects.toBeInstanceOf(CanvasAuthError);
  });
});

describe("Canvas signed URLs", () => {
  it("follows Canvas redirects with the token and returns the file-store URL unfetched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: `${BASE}/files/1/download?verifier=x` },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://files.example/signed/1?sig=abc" },
        }),
      );
    const client = new CanvasClient(BASE, "secret", fetchMock);
    await expect(client.resolveSignedUrl(file({}))).resolves.toBe(
      "https://files.example/signed/1?sig=abc",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(new URL(String(call[0])).origin).toBe(BASE);
    }
  });

  it("returns null when Canvas serves the file itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("pdf"));
    const client = new CanvasClient(BASE, "secret", fetchMock);
    await expect(client.resolveSignedUrl(file({}))).resolves.toBeNull();
  });
});

describe("assistant loop after sending files", () => {
  it("replies with the send result without another model call", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "t1",
                type: "function",
                function: {
                  name: "send_files",
                  arguments: '{"file_ids":[1,2]}',
                },
              },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion);
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "send lecture 1 and 2",
      execute: vi.fn().mockResolvedValue("Sent L1.pdf (1 KB), L2.pdf (1 KB)."),
    });
    expect(result.reply).toBe("Sent L1.pdf (1 KB), L2.pdf (1 KB).");
    expect(create).toHaveBeenCalledOnce();
    expect(result.timings.modelCalls).toBe(1);
    expect(result.timings.tools).toEqual([
      { name: "send_files", ms: expect.any(Number) },
    ]);
  });
});
