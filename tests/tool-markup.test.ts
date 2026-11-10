import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import { runAssistant, UNPROCESSED_REPLY } from "../src/assistant/agent.js";
import { looksLikeToolMarkup } from "../src/assistant/format.js";

// The reply the bot forwarded to Telegram after a quiet spell.
const LEAKED = `]<]minimax[>[<tool_call>
]<]minimax[>[<invoke name="send_files">]<]minimax[>[<file_ids>]<]minimax[>[<item>9623538]<]minimax[>[</item>]<]minimax[>[<item>10164406]<]minimax[>[</item>]<]minimax[>[</file_ids>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>`;

function textReply(content: string): ChatCompletion {
  return {
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  } as unknown as ChatCompletion;
}

describe("tool-call markup written as text", () => {
  it("recognises leaked markup but not ordinary replies", () => {
    expect(looksLikeToolMarkup(LEAKED)).toBe(true);
    expect(looksLikeToolMarkup('<invoke name="send_files">')).toBe(true);
    expect(looksLikeToolMarkup("<tool_call>{}</tool_call>")).toBe(true);
    expect(looksLikeToolMarkup("Sent Tutorial Week 10.pdf (108 KB).")).toBe(
      false,
    );
    expect(
      looksLikeToolMarkup("No files in RVN2001 match <rubrics>. I <3 CS2102"),
    ).toBe(false);
  });

  it("retries instead of forwarding the markup", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(textReply(LEAKED))
      .mockResolvedValueOnce(textReply("No RVN2001 file matches rubrics."));
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "give me the rvn2001 rubrics",
      execute: vi.fn(),
    });
    expect(result.reply).toBe("No RVN2001 file matches rubrics.");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("gives a plain failure message if the model keeps leaking markup", async () => {
    const create = vi.fn().mockResolvedValue(textReply(LEAKED));
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "give me the rvn2001 rubrics",
      execute: vi.fn(),
    });
    expect(result.reply).toBe(UNPROCESSED_REPLY);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("never returns markup even from the final no-tools answer", async () => {
    const toolCall = {
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "t",
                type: "function",
                function: { name: "list_modules", arguments: "{}" },
              },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion;
    const create = vi.fn().mockResolvedValue(toolCall);
    create.mockResolvedValueOnce(toolCall);
    // Five tool steps, then the cap's final answer leaks markup.
    for (let i = 0; i < 4; i++) create.mockResolvedValueOnce(toolCall);
    create.mockResolvedValueOnce(textReply(LEAKED));
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "loop",
      execute: vi.fn().mockResolvedValue("x"),
    });
    expect(result.reply).toBe(UNPROCESSED_REPLY);
  });
});
