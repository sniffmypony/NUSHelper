import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/assistant/store.js", () => ({
  assistantStore: {},
  telegramFileCacheStore: {},
  assistantSettingsStore: {},
}));

import {
  attemptLimitMs,
  chooseEffort,
  fallbackChain,
  type EffortSetting,
} from "../src/assistant/effort.js";
import { cleanModelText } from "../src/assistant/format.js";
import {
  ModelTimeoutError,
  resetEffortSupportForTests,
  streamCompletion,
} from "../src/assistant/model-client.js";
import {
  PROGRESS_NOTE,
  answerAssistantMessage,
  type AssistantTelegram,
} from "../src/assistant/handlers.js";
import type { AssistantSettings } from "../src/assistant/store.js";
import type { BotActions } from "../src/assistant/bot-tools.js";

function completion(message: Record<string, unknown>): ChatCompletion {
  return {
    choices: [{ index: 0, finish_reason: "stop", message }],
  } as unknown as ChatCompletion;
}

function fakeTelegram() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn(),
    sendMediaGroup: vi.fn(),
    sendRichMessage: vi.fn().mockResolvedValue(undefined),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from("img")),
  } satisfies AssistantTelegram;
}

function fakeStore() {
  return {
    claimUpdate: vi.fn(),
    recentTurns: vi.fn().mockResolvedValue([]),
    appendTurn: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeSettings(effort: EffortSetting = "auto") {
  return {
    effort: vi.fn().mockResolvedValue(effort),
    setEffort: vi.fn(),
    saveRequest: vi.fn().mockResolvedValue(41),
    findRequest: vi.fn(),
  } satisfies AssistantSettings;
}

const efforts = (create: ReturnType<typeof vi.fn>) =>
  create.mock.calls.map((call) => call[0].reasoning_effort);

describe("choosing the thinking effort", () => {
  it("thinks little for bot actions and more for study questions", () => {
    expect(chooseEffort("auto", "remind me at 6pm to do tut", false)).toBe(
      "low",
    );
    expect(chooseEffort("auto", "what's due this week?", false)).toBe("low");
    expect(chooseEffort("auto", "solve q2", false)).toBe("medium");
    expect(chooseEffort("auto", "find all the candidate keys", false)).toBe(
      "medium",
    );
    expect(chooseEffort("auto", "", true)).toBe("medium");
    expect(chooseEffort("high", "add todo laundry", false)).toBe("high");
  });

  it("falls back one level at a time, keeping time for the lower levels", () => {
    expect(fallbackChain("high")).toEqual(["high", "medium", "low"]);
    expect(fallbackChain("medium")).toEqual(["medium", "low"]);
    expect(fallbackChain("low")).toEqual(["low"]);
    expect(attemptLimitMs("medium", "medium", 270_000)).toBe(165_000);
    expect(attemptLimitMs("high", "high", 270_000)).toBe(135_000);
    expect(attemptLimitMs("high", "medium", 130_000)).toBe(85_000);
    // The last level gets whatever is left.
    expect(attemptLimitMs("high", "low", 48_000)).toBe(48_000);
  });
});

describe("reasoning in the reply", () => {
  it("removes MiniMax's streamed <mm:think> blocks, even unclosed ones", () => {
    expect(cleanModelText("<mm:think>R+ = ...</mm:think>## 23\nABF")).toBe(
      "## 23\nABF",
    );
    expect(cleanModelText("<think>x</think>ok")).toBe("ok");
    expect(cleanModelText("Answer\n<mm:think>cut off mid-thought")).toBe(
      "Answer",
    );
    // Seen live after a tool call: the opening tag is left out.
    expect(
      cleanModelText("</mm:think>Reminder set for 23:50: test the bot"),
    ).toBe("Reminder set for 23:50: test the bot");
    expect(cleanModelText("time is valid.</mm:think>\nDone.")).toBe("Done.");
  });
});

function streamOf(chunks: object[], delayMs = 0) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        yield chunk;
      }
    },
  };
}

function clientWith(create: ReturnType<typeof vi.fn>) {
  return { chat: { completions: { create } } } as never;
}

describe("streaming completions", () => {
  afterEach(() => resetEffortSupportForTests());

  it("assembles text and tool calls from the stream", async () => {
    const create = vi.fn().mockResolvedValue(
      streamOf([
        {
          id: "c1",
          model: "m",
          choices: [{ delta: { content: "<mm:think>hm" } }],
        },
        { choices: [{ delta: { content: "</mm:think>Hi" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "t1",
                    function: { name: "add_", arguments: '{"de' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { name: "todo", arguments: 'scription":"x"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );
    const result = await streamCompletion(clientWith(create), {
      model: "m",
      messages: [],
      reasoning_effort: "medium",
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      stream: true,
      reasoning_effort: "medium",
    });
    const message = result.choices[0].message;
    expect(cleanModelText(message.content)).toBe("Hi");
    expect(message.tool_calls).toEqual([
      {
        id: "t1",
        type: "function",
        function: { name: "add_todo", arguments: '{"description":"x"}' },
      },
    ]);
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("gives up when the stream goes quiet", async () => {
    const create = vi.fn().mockImplementation(async (_body, { signal }) => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "a" } }] };
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      },
    }));
    await expect(
      streamCompletion(
        clientWith(create),
        { model: "m", messages: [] },
        {},
        30,
      ),
    ).rejects.toBeInstanceOf(ModelTimeoutError);
  });

  it("stops when the attempt's time is up", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamCompletion(
        clientWith(vi.fn()),
        { model: "m", messages: [] },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(ModelTimeoutError);
  });

  it("drops reasoning_effort for good if the model rejects it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rejection = new OpenAI.BadRequestError(
      400,
      { message: "Unsupported parameter: reasoning_effort" },
      "Unsupported parameter: reasoning_effort",
      new Headers(),
    );
    const create = vi
      .fn()
      .mockRejectedValueOnce(rejection)
      .mockImplementation(async () =>
        streamOf([{ choices: [{ delta: { content: "ok" } }] }]),
      );
    const body = { model: "m", messages: [], reasoning_effort: "low" as const };
    await streamCompletion(clientWith(create), body);
    await streamCompletion(clientWith(create), body);
    expect(create.mock.calls.map((c) => c[0].reasoning_effort)).toEqual([
      "low",
      undefined,
      undefined,
    ]);
  });
});

describe("answering with effort, fallback and Think harder", () => {
  it("answers study questions at medium and offers Think harder", async () => {
    const telegram = fakeTelegram();
    const settings = fakeSettings();
    const create = vi
      .fn()
      .mockResolvedValue(
        completion({ role: "assistant", content: "ABF, ACF" }),
      );

    await answerAssistantMessage(telegram, 42, "solve q2", {
      store: fakeStore(),
      settings,
      runInBackground: vi.fn(),
      createCompletion: create,
      model: "m",
    });

    expect(efforts(create)).toEqual(["medium"]);
    expect(settings.saveRequest).toHaveBeenCalledWith("42", {
      text: "solve q2",
      attachment: undefined,
    });
    expect(telegram.sendRichMessage).toHaveBeenCalledWith(42, "ABF, ACF", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Think harder", callback_data: "ai:think:41" }],
        ],
      },
    });
  });

  it("keeps bot actions at low effort with no Think harder button", async () => {
    const telegram = fakeTelegram();
    const settings = fakeSettings();
    const create = vi
      .fn()
      .mockResolvedValue(
        completion({ role: "assistant", content: "Which day?" }),
      );

    await answerAssistantMessage(telegram, 42, "add a reminder", {
      store: fakeStore(),
      settings,
      runInBackground: vi.fn(),
      createCompletion: create,
      model: "m",
    });

    expect(efforts(create)).toEqual(["low"]);
    expect(settings.saveRequest).not.toHaveBeenCalled();
    expect(telegram.sendRichMessage).toHaveBeenCalledWith(
      42,
      "Which day?",
      undefined,
    );
  });

  it("falls back from high to medium to low when each runs out of time", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const telegram = fakeTelegram();
    const settings = fakeSettings();
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ModelTimeoutError())
      .mockRejectedValueOnce(new ModelTimeoutError())
      .mockResolvedValue(completion({ role: "assistant", content: "Done." }));

    await answerAssistantMessage(
      telegram,
      42,
      "solve q2",
      {
        store: fakeStore(),
        settings,
        runInBackground: vi.fn(),
        createCompletion: create,
        model: "m",
      },
      undefined,
      undefined,
      { effort: "high" },
    );

    expect(efforts(create)).toEqual(["high", "medium", "low"]);
    expect(telegram.sendRichMessage).toHaveBeenCalledWith(
      42,
      "_Answered with low thinking because high took too long._\n\nDone.",
      undefined,
    );
    // High already ran out of time; another press would only fail again.
    expect(settings.saveRequest).not.toHaveBeenCalled();
  });

  it("doesn't repeat an attempt that already changed something", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const telegram = fakeTelegram();
    const addTodo = vi
      .fn()
      .mockResolvedValue({ message: "Added to today's list: laundry" });
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        completion({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "a",
              type: "function",
              function: {
                name: "add_todo",
                arguments: '{"description":"laundry"}',
              },
            },
          ],
        }),
      )
      .mockRejectedValue(new ModelTimeoutError());

    await answerAssistantMessage(
      telegram,
      42,
      "solve this and add a todo for laundry",
      {
        store: fakeStore(),
        settings: fakeSettings(),
        runInBackground: vi.fn(),
        createCompletion: create,
        model: "m",
      },
      { addTodo } as unknown as BotActions,
    );

    expect(addTodo).toHaveBeenCalledTimes(1);
    expect(efforts(create)).toEqual(["medium", "medium"]);
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      42,
      expect.stringContaining("took too long"),
    );
  });

  it("uses the /effort setting and posts a progress note on slow answers", async () => {
    const telegram = fakeTelegram();
    const create = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return completion({ role: "assistant", content: "Added." });
    });

    await answerAssistantMessage(telegram, 42, "add todo laundry", {
      store: fakeStore(),
      settings: fakeSettings("high"),
      runInBackground: vi.fn(),
      createCompletion: create,
      model: "m",
      progressNoteMs: 5,
    });

    expect(efforts(create)).toEqual(["high"]);
    expect(telegram.sendMessage).toHaveBeenCalledWith(42, PROGRESS_NOTE);
    expect(telegram.deleteMessage).toHaveBeenCalledWith(42, 900);
  });
});
