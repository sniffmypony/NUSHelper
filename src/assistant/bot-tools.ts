import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { looksLikeCalendarMessage } from "../calendar/parser.js";
import { isValidIsoDate } from "../dates.js";
import { parseExpenditureAmounts } from "../expenditure.js";
import {
  parseReminderCommandLine,
  type ParsedReminderCommand,
} from "../message-lines.js";

// Tools that run the bot's own commands. Arguments are turned back into the
// command syntax and go through the same parsers, so the assistant can never
// create something the slash commands would reject. Deletions only ever send
// a Delete/Keep confirmation; nothing is removed until the user presses it.

export type DeletableKind = "todo" | "task" | "rem";

export interface UndoRef {
  kind: DeletableKind;
  id: number;
  label: string;
}

export interface ToolActionResult {
  message: string;
  undo?: UndoRef;
}

export interface BotActions {
  addTask(input: string): Promise<ToolActionResult>;
  listTasks(): Promise<string>;
  completeTask(id: number): Promise<string>;
  addTodo(description: string): Promise<ToolActionResult>;
  listTodos(): Promise<string>;
  // Returns null when the time has already passed today.
  addReminder(command: ParsedReminderCommand): Promise<ToolActionResult | null>;
  listReminders(): Promise<string>;
  // Sends the usual preview with confirm/cancel buttons; returns false if invalid.
  stageCalendarEvent(text: string): Promise<boolean>;
  listCalendarEvents(startDate: string, days: number): Promise<string>;
  requestDeletion(kind: DeletableKind, id: number): Promise<string>;
  requestCalendarDeletion(eventId: string): Promise<string>;
  logExpenditure(
    amountCents: number,
    spendDate: string | undefined,
    mode: "add" | "remove",
  ): Promise<string>;
  expenditureReport(period: "week" | "month", date?: string): Promise<string>;
  expenditureBreakdown(start: string, end: string): Promise<string>;
}

export class BotToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotToolError";
  }
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): ChatCompletionFunctionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      },
    },
  };
}

const isoDate = (description: string) => ({ type: "string", description });

export const botActionTools: ChatCompletionFunctionTool[] = [
  tool(
    "add_task",
    "Add a long-term task (same as /task), optionally with a module and due date.",
    {
      description: { type: "string" },
      module_code: { type: "string", description: "Optional, e.g. CS2102." },
      due_date: isoDate("Optional due date as YYYY-MM-DD."),
    },
    ["description"],
  ),
  tool("list_tasks", "List unfinished long-term tasks with their ids (/list)."),
  tool(
    "complete_task",
    "Mark a long-term task done (/done). Tasks only; to-dos cannot be completed.",
    { task_id: { type: "integer" } },
    ["task_id"],
  ),
  tool(
    "delete_task",
    "Ask the user to confirm permanently deleting a long-term task (/remove).",
    { task_id: { type: "integer" } },
    ["task_id"],
  ),
  tool(
    "add_todo",
    "Add an item to today's to-do list (/todo).",
    { description: { type: "string" } },
    ["description"],
  ),
  tool("list_todos", "Show today's to-do list with ids (/todos)."),
  tool(
    "delete_todo",
    "Ask the user to confirm removing an item from today's to-do list.",
    { todo_id: { type: "integer" } },
    ["todo_id"],
  ),
  tool(
    "set_reminder",
    "Send a reminder later TODAY at a Singapore time (/remind). Cannot schedule other days.",
    {
      time: {
        type: "string",
        description: "24-hour Singapore time as HHMM, e.g. 1800 for 6pm.",
      },
      description: { type: "string" },
    },
    ["time", "description"],
  ),
  tool("list_reminders", "List reminders still waiting to be sent, with ids."),
  tool(
    "cancel_reminder",
    "Ask the user to confirm cancelling a reminder that has not been sent.",
    { reminder_id: { type: "integer" } },
    ["reminder_id"],
  ),
  tool(
    "create_calendar_event",
    "Propose a Google Calendar event. The user gets a preview and must press Create.",
    {
      time_range: {
        type: "string",
        description: "Start-end in 24-hour time, e.g. 14:00-16:30.",
      },
      title: { type: "string" },
      date: { type: "string", description: "DD-MM-YYYY, e.g. 05-11-2026." },
    },
    ["time_range", "title", "date"],
  ),
  tool("list_calendar_events", "List Google Calendar events with their ids.", {
    start_date: isoDate("First day as YYYY-MM-DD; default today."),
    days: { type: "integer", description: "1-31, default 7." },
  }),
  tool(
    "delete_calendar_event",
    "Ask the user to confirm deleting a Google Calendar event by its id from list_calendar_events.",
    { event_id: { type: "string" } },
    ["event_id"],
  ),
  tool(
    "log_expenditure",
    "Add (or remove) amounts on a day's expenditure total in S$. Same as replying with numbers to the expenditure prompt.",
    {
      amounts: {
        type: "string",
        description: 'Amounts separated by spaces, e.g. "5 3.9".',
      },
      date: isoDate("Day as YYYY-MM-DD; default today."),
      mode: { type: "string", enum: ["add", "remove"] },
    },
    ["amounts"],
  ),
  tool(
    "expenditure_report",
    "Show the stored weekly (Mon-Sun) or monthly expenditure report. The result is sent to the user exactly as returned.",
    {
      period: { type: "string", enum: ["week", "month"] },
      date: isoDate("Any day inside the period as YYYY-MM-DD; default today."),
    },
    ["period"],
  ),
  tool(
    "expenditure_breakdown",
    "Show how much was spent on each day of a date range, with the total. The result is sent to the user exactly as returned.",
    {
      start_date: isoDate("First day as YYYY-MM-DD."),
      end_date: isoDate("Last day as YYYY-MM-DD."),
    },
    ["start_date", "end_date"],
  ),
];

const BOT_TOOL_NAMES = new Set(
  botActionTools.map((tool) => tool.function.name),
);

export function isBotActionTool(name: string): boolean {
  return BOT_TOOL_NAMES.has(name);
}

function text(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredText(args: Record<string, unknown>, name: string): string {
  const value = text(args, name);
  if (!value) throw new BotToolError(`Missing "${name}".`);
  return value;
}

function positiveId(args: Record<string, unknown>, name: string): number {
  const raw = args[name];
  const id = typeof raw === "string" ? Number(raw) : raw;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > 2_147_483_647
  ) {
    throw new BotToolError(`"${name}" must be a positive integer.`);
  }
  return id;
}

function optionalIsoDate(
  args: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = text(args, name);
  if (value && !isValidIsoDate(value)) {
    throw new BotToolError(`"${name}" must be a real date as YYYY-MM-DD.`);
  }
  return value;
}

// Quote titles the same way a user would have to in a calendar message.
function calendarField(value: string): string {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function withUndo(result: ToolActionResult, undo: UndoRef[]): string {
  if (result.undo) undo.push(result.undo);
  return result.message;
}

export async function executeBotActionTool(
  name: string,
  args: Record<string, unknown>,
  actions: BotActions,
  undo: UndoRef[] = [],
): Promise<string> {
  switch (name) {
    case "add_task": {
      const moduleCode = text(args, "module_code")?.replace(/\s+/g, "");
      const dueDate = text(args, "due_date");
      if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        throw new BotToolError('"due_date" must be YYYY-MM-DD.');
      }
      const input = [
        requiredText(args, "description"),
        moduleCode ? `#${moduleCode}` : "",
        dueDate ? `@${dueDate}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return withUndo(await actions.addTask(input), undo);
    }
    case "list_tasks":
      return actions.listTasks();
    case "complete_task":
      return actions.completeTask(positiveId(args, "task_id"));
    case "delete_task":
      return actions.requestDeletion("task", positiveId(args, "task_id"));
    case "add_todo":
      return withUndo(
        await actions.addTodo(requiredText(args, "description")),
        undo,
      );
    case "list_todos":
      return actions.listTodos();
    case "delete_todo":
      return actions.requestDeletion("todo", positiveId(args, "todo_id"));
    case "set_reminder": {
      const time = requiredText(args, "time").replace(":", "");
      const command = parseReminderCommandLine(
        `/remind ${time} ${requiredText(args, "description")}`,
      );
      if (!command) {
        throw new BotToolError(
          '"time" must be a 24-hour HHMM time, e.g. 1800.',
        );
      }
      const confirmation = await actions.addReminder(command);
      return confirmation
        ? withUndo(confirmation, undo)
        : "Not set: that time has already passed today. Reminders only work for later today in Singapore time.";
    }
    case "list_reminders":
      return actions.listReminders();
    case "cancel_reminder":
      return actions.requestDeletion("rem", positiveId(args, "reminder_id"));
    case "create_calendar_event": {
      const line = [
        requiredText(args, "time_range"),
        calendarField(requiredText(args, "title")),
        requiredText(args, "date"),
      ].join(", ");
      if (
        !looksLikeCalendarMessage(line) ||
        !(await actions.stageCalendarEvent(line))
      ) {
        throw new BotToolError(
          "Invalid event. Use time_range like 14:00-16:30 and date as DD-MM-YYYY.",
        );
      }
      return "A preview with Create/Cancel buttons was sent. Nothing is added until the user presses Create.";
    }
    case "list_calendar_events": {
      const rawDays = args.days === undefined ? 7 : Number(args.days);
      if (!Number.isInteger(rawDays)) {
        throw new BotToolError('"days" must be an integer.');
      }
      return actions.listCalendarEvents(
        optionalIsoDate(args, "start_date") ?? "",
        Math.min(Math.max(rawDays, 1), 31),
      );
    }
    case "delete_calendar_event":
      return actions.requestCalendarDeletion(requiredText(args, "event_id"));
    case "log_expenditure": {
      const amountCents = parseExpenditureAmounts(
        requiredText(args, "amounts"),
      );
      if (amountCents === null) {
        throw new BotToolError(
          '"amounts" must be non-negative numbers with up to two decimals, e.g. "5 3.9".',
        );
      }
      const mode = text(args, "mode") ?? "add";
      if (mode !== "add" && mode !== "remove") {
        throw new BotToolError('"mode" must be "add" or "remove".');
      }
      return actions.logExpenditure(
        amountCents,
        optionalIsoDate(args, "date"),
        mode,
      );
    }
    case "expenditure_report": {
      const period = text(args, "period");
      if (period !== "week" && period !== "month") {
        throw new BotToolError('"period" must be "week" or "month".');
      }
      return actions.expenditureReport(period, optionalIsoDate(args, "date"));
    }
    case "expenditure_breakdown": {
      const start = optionalIsoDate(args, "start_date");
      const end = optionalIsoDate(args, "end_date");
      if (!start || !end) {
        throw new BotToolError('"start_date" and "end_date" are required.');
      }
      return actions.expenditureBreakdown(start, end);
    }
    default:
      throw new BotToolError(`Unknown tool "${name}".`);
  }
}
