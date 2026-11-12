import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/bot-actions.js", () => ({
  openTasks: vi.fn(),
  completeTask: vi.fn(),
  findTask: vi.fn(),
}));

import * as actions from "../src/bot-actions.js";
import { systemPrompt } from "../src/assistant/agent.js";
import { pickQuery, pickTask, taskPickerKeyboard } from "../src/task-picker.js";
import {
  formatTaskItem,
  formatTodoItem,
  matchTasks,
} from "../src/task-todo.js";

const TASKS = [
  { id: 41, description: "Finish ER diagram", module: "CS2102", dueDate: null },
  { id: 57, description: "Read lecture 5", module: "CS2103T", dueDate: null },
  { id: 58, description: "Read lecture 6", module: "CS2103T", dueDate: null },
];

function fakeContext() {
  return { reply: vi.fn().mockResolvedValue({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(actions.openTasks).mockResolvedValue(TASKS);
  vi.mocked(actions.completeTask).mockResolvedValue(
    "Marked done ✅ Finish ER diagram",
  );
});

describe("lists without numbering", () => {
  it("shows tasks and to-dos as bullets with no ids", () => {
    expect(formatTaskItem({ ...TASKS[0], dueDate: "2026-11-20" })).toBe(
      "• Finish ER diagram [CS2102] — due 2026-11-20",
    );
    expect(
      formatTodoItem({ id: 31, description: "laundry", taskId: null }),
    ).toBe("• laundry");
    expect(formatTodoItem({ id: 32, description: "ER", taskId: 41 })).toBe(
      "• ER (from your tasks)",
    );
  });

  it("gives the assistant ids it is told never to show", () => {
    expect(formatTaskItem(TASKS[0], true)).toContain("(task_id 41)");
    expect(
      formatTodoItem({ id: 31, description: "laundry", taskId: null }, true),
    ).toBe("• laundry (todo_id 31)");
    expect(systemPrompt(new Date())).toMatch(
      /Never show them to the user or number items like #12/,
    );
  });
});

describe("/done and /remove", () => {
  it("matches every typed word against the name and module", () => {
    expect(matchTasks(TASKS, "lecture cs2103t").map((t) => t.id)).toEqual([
      57, 58,
    ]);
    expect(matchTasks(TASKS, "ER diag").map((t) => t.id)).toEqual([41]);
    expect(matchTasks(TASKS, "   ")).toEqual([]);
  });

  it("reads the words after the command", () => {
    expect(pickQuery("/done ER diagram", "done")).toBe("ER diagram");
    expect(pickQuery("/remove@MyBot lecture", "remove")).toBe("lecture");
    expect(pickQuery("/done", "done")).toBe("");
  });

  it("completes a single name match straight away", async () => {
    const ctx = fakeContext();
    await pickTask(ctx as never, "done", "er diagram");
    expect(actions.completeTask).toHaveBeenCalledWith(41);
    expect(ctx.reply).toHaveBeenCalledWith("Marked done ✅ Finish ER diagram");
  });

  it("shows buttons when nothing or several tasks match the name", async () => {
    const ctx = fakeContext();
    await pickTask(ctx as never, "done", "");
    await pickTask(ctx as never, "done", "lecture");
    expect(actions.completeTask).not.toHaveBeenCalled();
    const [, first] = ctx.reply.mock.calls[0];
    expect(first.reply_markup.inline_keyboard).toHaveLength(3);
    const [text, second] = ctx.reply.mock.calls[1];
    expect(text).toBe("Which task is done?");
    expect(
      second.reply_markup.inline_keyboard.map((row: never[]) => row[0]),
    ).toEqual([
      { text: "Read lecture 5 [CS2103T]", callback_data: "task:done:57" },
      { text: "Read lecture 6 [CS2103T]", callback_data: "task:done:58" },
    ]);
  });

  it("always asks Delete/Keep before removing, and never shows an id", async () => {
    const ctx = fakeContext();
    await pickTask(ctx as never, "remove", "diagram");
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toBe("Delete task: Finish ER diagram?");
    expect(text).not.toMatch(/#|41/);
    expect(extra.reply_markup.inline_keyboard[0][0].callback_data).toBe(
      "ai:del:task:41",
    );
  });

  it("says when no task matches", async () => {
    const ctx = fakeContext();
    await pickTask(ctx as never, "remove", "physics");
    expect(ctx.reply).toHaveBeenCalledWith(
      'No open task matches "physics". Send /remove on its own to pick from your list.',
    );
  });

  it("keeps button text and callback data within Telegram's limits", () => {
    const [[button]] = taskPickerKeyboard(
      [
        {
          id: 2_147_483_647,
          description: "x".repeat(80),
          module: null,
          dueDate: null,
        },
      ],
      "remove",
    ).inline_keyboard;
    expect(button.text).toHaveLength(48);
    expect(button.callback_data).toBe("task:rm:2147483647");
  });
});
