import { describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../src/canvas/client.js";
import { AssistantToolbox, assistantTools } from "../src/assistant/tools.js";
import type { BotActions } from "../src/assistant/bot-tools.js";
import {
  confirmDeleteKeyboard,
  undoKeyboard,
} from "../src/assistant/keyboards.js";

function setup() {
  const actions = {
    addTask: vi.fn().mockResolvedValue({
      message: "Added: Finish ER diagram [CS2102]",
      undo: { kind: "task", id: 3, label: "Finish ER diagram" },
    }),
    listTasks: vi
      .fn()
      .mockResolvedValue("• Finish ER diagram [CS2102] (task_id 3)"),
    completeTask: vi.fn().mockResolvedValue("Marked done ✅ Finish ER diagram"),
    addTodo: vi.fn().mockResolvedValue({
      message: "Added to today's list: laundry",
      undo: { kind: "todo", id: 1, label: "laundry" },
    }),
    listTodos: vi.fn().mockResolvedValue("Today's list is empty."),
    addReminder: vi.fn().mockResolvedValue({
      message: "Reminder set for 18:00 today: do tut",
      undo: { kind: "rem", id: 9, label: "18:00 do tut" },
    }),
    listReminders: vi.fn().mockResolvedValue("• 18:00 do tut (reminder_id 9)"),
    addRepeating: vi.fn().mockResolvedValue({
      message: "Repeating every Mon: tutorial prep",
      undo: { kind: "rep", id: 4, label: "tutorial prep" },
    }),
    listRepeating: vi
      .fn()
      .mockResolvedValue("• tutorial prep — every Mon (repeating_id 4)"),
    stageCalendarEvent: vi.fn().mockResolvedValue(true),
    listCalendarEvents: vi.fn().mockResolvedValue("No events in that range."),
    requestDeletion: vi.fn().mockResolvedValue("Asked the user to confirm."),
    requestCalendarDeletion: vi
      .fn()
      .mockResolvedValue("Asked the user to confirm."),
    logExpenditure: vi
      .fn()
      .mockResolvedValue("2 November 2026: S$8.90 logged."),
    expenditureReport: vi.fn().mockResolvedValue("Weekly expenditure report"),
    expenditureBreakdown: vi.fn().mockResolvedValue("Thu 3 Dec: S$9.80"),
  } satisfies BotActions;
  const toolbox = new AssistantToolbox(
    {} as CanvasClient,
    { sendDocuments: vi.fn(), setUploading: vi.fn() },
    () => new Date(),
    actions,
  );
  return { actions, toolbox };
}

describe("assistant bot-action tools", () => {
  it("exposes the bot commands alongside the Canvas tools", () => {
    const names = assistantTools.map((tool) => tool.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_upcoming_assignments",
        "add_task",
        "complete_task",
        "delete_task",
        "add_todo",
        "delete_todo",
        "set_reminder",
        "cancel_reminder",
        "create_calendar_event",
        "delete_calendar_event",
        "log_expenditure",
        "expenditure_report",
      ]),
    );
  });

  it("builds /task syntax and records an undo", async () => {
    const { actions, toolbox } = setup();
    await expect(
      toolbox.execute(
        "add_task",
        '{"description":"Finish ER diagram","module_code":"cs 2102","due_date":"2026-11-09"}',
      ),
    ).resolves.toBe("Added: Finish ER diagram [CS2102]");
    expect(actions.addTask).toHaveBeenCalledWith(
      "Finish ER diagram #cs2102 @2026-11-09",
    );
    expect(toolbox.undo).toEqual([
      { kind: "task", id: 3, label: "Finish ER diagram" },
    ]);
  });

  it("rejects a malformed due date before touching the database", async () => {
    const { actions, toolbox } = setup();
    await expect(
      toolbox.execute(
        "add_task",
        '{"description":"x","due_date":"next friday"}',
      ),
    ).resolves.toMatch(/^Error: "due_date" must be YYYY-MM-DD/);
    expect(actions.addTask).not.toHaveBeenCalled();
  });

  it("parses reminders with the /remind parser", async () => {
    const { actions, toolbox } = setup();
    await expect(
      toolbox.execute(
        "set_reminder",
        '{"time":"18:00","description":"do tut"}',
      ),
    ).resolves.toBe("Reminder set for 18:00 today: do tut");
    expect(actions.addReminder).toHaveBeenCalledWith({
      hour: 18,
      minute: 0,
      description: "do tut",
    });

    await expect(
      toolbox.execute("set_reminder", '{"time":"6pm","description":"x"}'),
    ).resolves.toMatch(/^Error: "time" must be a 24-hour HHMM time/);
  });

  it("reports a reminder time that has already passed", async () => {
    const { actions, toolbox } = setup();
    actions.addReminder.mockResolvedValueOnce({
      message: "Not set: That time has already passed today.",
    });
    await expect(
      toolbox.execute("set_reminder", '{"time":"0700","description":"x"}'),
    ).resolves.toMatch(/already passed today/);
    expect(toolbox.undo).toEqual([]);
  });

  it("sets a reminder for another day from a YYYY-MM-DD date", async () => {
    const { actions, toolbox } = setup();
    await toolbox.execute(
      "set_reminder",
      '{"time":"0900","date":"2026-11-20","description":"submit form"}',
    );
    expect(actions.addReminder).toHaveBeenCalledWith({
      hour: 9,
      minute: 0,
      description: "submit form",
      day: { kind: "date", day: 20, month: 11, year: 2026 },
    });
    await expect(
      toolbox.execute(
        "set_reminder",
        '{"time":"0900","date":"20 Nov","description":"x"}',
      ),
    ).resolves.toMatch(/^Error: "date" must be a real date/);
  });

  it("adds, lists and asks before deleting repeating items", async () => {
    const { actions, toolbox } = setup();
    await toolbox.execute(
      "add_repeating",
      '{"description":"tutorial prep","frequency":"weekly","weekdays":"mon, thu"}',
    );
    expect(actions.addRepeating).toHaveBeenLastCalledWith(
      "mon,thu",
      "tutorial prep",
    );
    await toolbox.execute(
      "add_repeating",
      '{"description":"pay bill","frequency":"monthly","day_of_month":1}',
    );
    expect(actions.addRepeating).toHaveBeenLastCalledWith("1", "pay bill");
    await toolbox.execute(
      "add_repeating",
      '{"description":"vitamins","frequency":"daily"}',
    );
    expect(actions.addRepeating).toHaveBeenLastCalledWith("day", "vitamins");
    expect(toolbox.undo).toHaveLength(3);

    await expect(toolbox.execute("list_repeating", "{}")).resolves.toContain(
      "repeating_id 4",
    );
    await toolbox.execute("delete_repeating", '{"repeating_id":4}');
    expect(actions.requestDeletion).toHaveBeenCalledWith("rep", 4);
  });

  it("stages calendar events as a normal calendar line", async () => {
    const { actions, toolbox } = setup();
    await expect(
      toolbox.execute(
        "create_calendar_event",
        '{"time_range":"14:00-16:30","title":"Planning, phase 2","date":"05-11-2026"}',
      ),
    ).resolves.toMatch(/preview .* was sent/);
    expect(actions.stageCalendarEvent).toHaveBeenCalledWith(
      '14:00-16:30, "Planning, phase 2", 05-11-2026',
    );
  });

  it("validates ids", async () => {
    const { actions, toolbox } = setup();
    await expect(
      toolbox.execute("complete_task", '{"task_id":-1}'),
    ).resolves.toMatch(/^Error: /);
    expect(actions.completeTask).not.toHaveBeenCalled();
    await expect(
      toolbox.execute("complete_task", '{"task_id":3}'),
    ).resolves.toBe("Marked done ✅ Finish ER diagram");
  });

  it("routes deletions to a confirmation instead of deleting", async () => {
    const { actions, toolbox } = setup();
    await toolbox.execute("delete_todo", '{"todo_id":2}');
    await toolbox.execute("delete_task", '{"task_id":3}');
    await toolbox.execute("cancel_reminder", '{"reminder_id":9}');
    await toolbox.execute("delete_calendar_event", '{"event_id":"abc123"}');
    expect(actions.requestDeletion.mock.calls).toEqual([
      ["todo", 2],
      ["task", 3],
      ["rem", 9],
    ]);
    expect(actions.requestCalendarDeletion).toHaveBeenCalledWith("abc123");
  });

  it("parses expenditure amounts with the expenditure parser", async () => {
    const { actions, toolbox } = setup();
    await expect(
      toolbox.execute("log_expenditure", '{"amounts":"5 3.9"}'),
    ).resolves.toMatch(/S\$8\.90/);
    expect(actions.logExpenditure).toHaveBeenCalledWith(890, undefined, "add");

    await expect(
      toolbox.execute("log_expenditure", '{"amounts":"-5"}'),
    ).resolves.toMatch(/^Error: "amounts"/);
    await expect(
      toolbox.execute("log_expenditure", '{"amounts":"5","date":"2026-02-30"}'),
    ).resolves.toMatch(/^Error: "date" must be a real date/);
    expect(actions.logExpenditure).toHaveBeenCalledOnce();
  });

  it("requires a valid report period", async () => {
    const { actions, toolbox } = setup();
    await toolbox.execute("expenditure_report", '{"period":"month"}');
    expect(actions.expenditureReport).toHaveBeenCalledWith("month", undefined);
    await expect(
      toolbox.execute("expenditure_report", '{"period":"year"}'),
    ).resolves.toMatch(/^Error: /);
  });

  it("explains when bot actions are unavailable", async () => {
    const toolbox = new AssistantToolbox({} as CanvasClient, {
      sendDocuments: vi.fn(),
      setUploading: vi.fn(),
    });
    await expect(toolbox.execute("list_todos", "{}")).resolves.toMatch(
      /not available/,
    );
  });
});

describe("assistant keyboards", () => {
  it("builds Delete/Keep and Undo buttons within Telegram's limits", () => {
    expect(confirmDeleteKeyboard("todo", 2).inline_keyboard[0]).toEqual([
      { text: "Delete", callback_data: "ai:del:todo:2" },
      { text: "Keep", callback_data: "ai:keep" },
    ]);
    expect(undoKeyboard([])).toBeUndefined();
    const keyboard = undoKeyboard([
      { kind: "rem", id: 2_147_483_647, label: "18:00 do tut" },
    ])!;
    const button = keyboard.inline_keyboard[0][0];
    expect(button.callback_data).toBe("ai:undo:rem:2147483647");
    expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
  });
});
