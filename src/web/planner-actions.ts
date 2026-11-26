import { asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  APPLE_PAY_KEY_SETTING,
  BANK_EMAIL_KEY_SETTING,
  describePayment,
} from "../apple-pay/payments.js";
import {
  countPayment,
  skipPayment,
  undoPayment,
} from "../apple-pay/service.js";
import { applePayStore, type ApplePayPayment } from "../apple-pay/store.js";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import { websiteUrl } from "./login-links.js";
import * as bot from "../bot-actions.js";
import { CanvasClient } from "../canvas/client.js";
import { deadlineStore } from "../canvas/deadline-store.js";
import { submissionState } from "../canvas/deadline-sync.js";
import { isCalendarConfigured } from "../calendar/config.js";
import { getCalendarGateway } from "../calendar/google.js";
import { addDays, todayInSingapore } from "../dates.js";
import { db } from "../db/client.js";
import {
  reminders,
  tasks,
  todos,
  webChatMessages,
  webChats,
} from "../db/schema.js";
import {
  canvasConfig,
  isCanvasConfigured,
  optionalEnv,
  telegramOwnerId,
} from "../env.js";
import { expenditureStore } from "../expenditure-store.js";
import { syncExamEvents, type Exam } from "../nus/exams.js";
import {
  fetchModuleTerm,
  timetableStore,
  type FetchLike,
} from "../nus/timetable.js";
import { acadWeekLabel } from "../nus/week.js";
import { decodeRule, describeRule, parseRecurrence } from "../recurrence.js";
import { addRecurring, allRecurring, deleteRecurring } from "../recurring.js";
import { calendarActions } from "./calendar-actions.js";
import type { CalendarRange } from "./calendar.js";
import {
  chooseSemester,
  monthBounds,
  previousMonth,
  splitDeadlines,
  spendingMonth,
  toCsv,
  type DeadlineView,
  type ExportKind,
  type Result,
  type SpendingMonth,
} from "./planner.js";

// The planner pages' data and changes. Every query runs on its own, one after
// another (single pooled connection; see src/settings/runtime.ts). Changes
// go through the bot's own functions, so the same rules apply as on Telegram.

export interface TodayView {
  date: string;
  week: string;
  // Today plus the next six days (classes, events, reminders, deadlines…).
  range: CalendarRange;
  todos: Array<{ id: number; description: string }>;
  spending: {
    todayCents: number | null;
    weekCents: number;
    monthCents: number;
    // Today's counted Apple Pay payments.
    applePayCents: number;
  };
}

export interface ApplePayView {
  id: number;
  date: string;
  time: string; // HH:mm, Singapore
  merchant: string;
  card: string;
  amountText: string;
  cents: number | null;
  status: string; // counted, undone, awaiting_sgd, skipped, awaiting_ok
  source: string; // applepay, email
  kind: string; // e.g. "PayLah! Scan & Pay" for bank emails
  readByAi: boolean;
}

export interface ApplePayStatus {
  enabled: boolean;
  // Where the shortcut sends payments.
  endpoint: string | null;
  latest: { receivedAt: string; text: string; status: string } | null;
  // Bank payments still waiting for Count it or Skip.
  waiting?: number;
}

export interface TasksView {
  tasks: Array<{
    id: number;
    description: string;
    module: string | null;
    dueDate: string | null;
  }>;
  todos: Array<{ id: number; description: string }>;
  repeating: Array<{ id: number; description: string; when: string }>;
}

export interface TimetableView {
  label: string | null;
  lessons: Array<{
    moduleCode: string;
    lessonType: string;
    classNo: string;
    day: number;
    start: string; // HH:mm
    end: string;
    venue: string;
  }>;
}

export interface FinalView {
  moduleCode: string;
  title: string;
  start: string; // ISO
  durationMinutes: number;
}

export interface PlannerActions {
  today(): Promise<TodayView>;
  tasks(): Promise<TasksView>;
  addTask(input: {
    description: string;
    module: string | null;
    dueDate: string | null;
  }): Promise<Result>;
  completeTask(id: number): Promise<Result>;
  deleteTask(id: number): Promise<Result>;
  addTodo(description: string): Promise<Result>;
  // Ticking a to-do off removes it (to-dos are a list for today).
  finishTodo(id: number): Promise<Result>;
  addRepeating(when: string, description: string): Promise<Result>;
  deleteRepeating(id: number): Promise<Result>;
  spending(
    month: string,
  ): Promise<SpendingMonth & { applePay: ApplePayView[] }>;
  applePayStatus(): Promise<ApplePayStatus>;
  bankEmailStatus(): Promise<ApplePayStatus>;
  undoApplePay(id: number): Promise<Result>;
  // A bank payment waiting for an answer: Count it, or Skip.
  countPayment(id: number): Promise<Result>;
  skipPayment(id: number): Promise<Result>;
  timetable(): Promise<TimetableView>;
  finals(): Promise<{ label: string | null; finals: FinalView[] }>;
  syncFinals(): Promise<Result>;
  deadlines(): Promise<{ upcoming: DeadlineView[]; recent: DeadlineView[] }>;
  submissions(): Promise<
    Array<{ assignmentId: number; state: "submitted" | "missing" | "unknown" }>
  >;
  exportCsv(kind: ExportKind): Promise<string>;
}

// Submission checks ask Canvas once per deadline, so only the next two
// weeks, and at most this many.
const MAX_SUBMISSION_CHECKS = 15;

function paymentView(row: ApplePayPayment): ApplePayView {
  return {
    id: row.id,
    date: row.spendDate,
    time: DateTime.fromJSDate(row.receivedAt)
      .setZone(SINGAPORE_TIME_ZONE)
      .toFormat("HH:mm"),
    merchant: row.merchant,
    card: row.card,
    amountText: row.amountText,
    cents: row.amountCents,
    status: row.status,
    source: row.source,
    kind: row.kind,
    readByAi: row.readByAi,
  };
}

const clock = (hhmm: string) => `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
const sum = (rows: Array<{ totalCents: number }>) =>
  rows.reduce((total, row) => total + row.totalCents, 0);

async function todoRows() {
  return db
    .select({ id: todos.id, description: todos.description })
    .from(todos)
    .orderBy(asc(todos.id));
}

async function savedSemesterExams(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{
  term: { acadYear: string; semester: number; label: string } | null;
  exams: Exam[];
  modules: string[];
}> {
  const lessons = await timetableStore.all();
  const term = chooseSemester(lessons, todayInSingapore());
  if (!term) return { term: null, exams: [], modules: [] };
  const modules = [
    ...new Set(
      lessons
        .filter(
          (lesson) =>
            lesson.acadYear === term.acadYear &&
            lesson.semester === term.semester,
        )
        .map((lesson) => lesson.moduleCode),
    ),
  ].sort();
  const exams: Exam[] = [];
  // NUSMods, one module at a time.
  for (const moduleCode of modules) {
    const module = await fetchModuleTerm(
      term.acadYear,
      moduleCode,
      term.semester,
      fetchImpl,
    );
    if (module?.exam) exams.push(module.exam);
  }
  exams.sort((a, b) => a.start.localeCompare(b.start));
  return { term, exams, modules };
}

export const plannerActions: PlannerActions = {
  async today() {
    const date = todayInSingapore();
    const range = await calendarActions.range(date, addDays(date, 6));
    const todoList = await todoRows();
    const weekStart = (() => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      return addDays(date, -((day + 6) % 7));
    })();
    const week = await expenditureStore.daysInRange(weekStart, date);
    const month = await expenditureStore.daysInRange(
      `${date.slice(0, 7)}-01`,
      date,
    );
    const todayRow = month.find((row) => row.spendDate === date);
    const applePay = await applePayStore.daySummary(date);
    return {
      date,
      week: acadWeekLabel(date),
      range,
      todos: todoList,
      spending: {
        todayCents: todayRow ? todayRow.totalCents : null,
        weekCents: sum(week),
        monthCents: sum(month),
        applePayCents: applePay.cents,
      },
    };
  },

  async tasks() {
    const open = await bot.openTasks();
    const todoList = await todoRows();
    const repeating = await allRecurring();
    return {
      tasks: open,
      todos: todoList,
      repeating: repeating.map((item) => {
        const rule = decodeRule(item.rule);
        return {
          id: item.id,
          description: item.description,
          when: rule ? describeRule(rule) : item.rule,
        };
      }),
    };
  },

  async addTask({ description, module, dueDate }) {
    // The same text /task takes: "description #MODULE @YYYY-MM-DD".
    const input = [
      description,
      module ? `#${module}` : "",
      dueDate ? `@${dueDate}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const result = await bot.addTask(input);
    return { ok: Boolean(result.id), message: result.message };
  },

  async completeTask(id) {
    const message = await bot.completeTask(id);
    return { ok: message.startsWith("Marked done"), message };
  },

  async deleteTask(id) {
    const message = await bot.removeTask(id);
    return { ok: message.startsWith("Removed"), message };
  },

  async addTodo(description) {
    const result = await bot.addTodo(description);
    return { ok: Boolean(result.id), message: result.message };
  },

  async finishTodo(id) {
    const message = await bot.deleteTodo(id);
    return {
      ok: message.startsWith("Removed"),
      message: message.replace(/^Removed to-do:/, "Done:"),
    };
  },

  async addRepeating(when, description) {
    const rule = parseRecurrence(when);
    if (!rule) {
      return {
        ok: false,
        message:
          'Use "day", "weekdays", weekday names such as "mon,thu", or a day of the month from 1 to 31.',
      };
    }
    const result = await addRecurring(rule, description);
    return { ok: Boolean(result.id), message: result.message };
  },

  async deleteRepeating(id) {
    const message = await deleteRecurring(id);
    return { ok: message.startsWith("Stopped"), message };
  },

  async spending(month) {
    const { start, end } = monthBounds(month);
    const rows = await expenditureStore.daysInRange(start, end);
    const before = monthBounds(previousMonth(month));
    const previous = await expenditureStore.daysInRange(
      before.start,
      before.end,
    );
    const payments = await applePayStore.inRange(start, end);
    return {
      ...spendingMonth(month, rows, previous, todayInSingapore()),
      applePay: payments.map(paymentView),
    };
  },

  async bankEmailStatus() {
    const latest = await applePayStore.latest("email");
    const waiting = await applePayStore.waitingCount();
    const base = websiteUrl();
    return {
      enabled: Boolean(optionalEnv(BANK_EMAIL_KEY_SETTING)),
      waiting,
      endpoint: base ? `${base}/api/bank-email` : null,
      latest: latest
        ? {
            receivedAt: latest.receivedAt.toISOString(),
            text: `${latest.kind ? `${latest.kind}: ` : ""}${describePayment(latest)}`,
            status: latest.status,
          }
        : null,
    };
  },

  async countPayment(id) {
    const message = await countPayment(applePayStore, id, telegramOwnerId());
    return {
      ok: message.startsWith("Counted"),
      message: message.split("\n")[0],
    };
  },

  async skipPayment(id) {
    const message = await skipPayment(applePayStore, id);
    return { ok: message.startsWith("Skipped"), message };
  },

  async applePayStatus() {
    const latest = await applePayStore.latest("applepay");
    const base = websiteUrl();
    return {
      enabled: Boolean(optionalEnv(APPLE_PAY_KEY_SETTING)),
      endpoint: base ? `${base}/api/applepay` : null,
      latest: latest
        ? {
            receivedAt: latest.receivedAt.toISOString(),
            text: describePayment(latest),
            status: latest.status,
          }
        : null,
    };
  },

  async undoApplePay(id) {
    const message = await undoPayment(applePayStore, id, telegramOwnerId());
    return {
      ok: message.startsWith("Undone"),
      message: message.split("\n")[0],
    };
  },

  async timetable() {
    const lessons = await timetableStore.all();
    const term = chooseSemester(lessons, todayInSingapore());
    if (!term) return { label: null, lessons: [] };
    return {
      label: term.label,
      lessons: lessons
        .filter(
          (lesson) =>
            lesson.acadYear === term.acadYear &&
            lesson.semester === term.semester,
        )
        .map((lesson) => ({
          moduleCode: lesson.moduleCode,
          lessonType: lesson.lessonType,
          classNo: lesson.classNo,
          day: lesson.day,
          start: clock(lesson.startTime),
          end: clock(lesson.endTime),
          venue: lesson.venue ?? "",
        })),
    };
  },

  async finals() {
    const { term, exams } = await savedSemesterExams();
    return { label: term?.label ?? null, finals: exams };
  },

  async syncFinals() {
    if (!isCalendarConfigured()) {
      return { ok: false, message: "Google Calendar isn't set up." };
    }
    const { term, exams, modules } = await savedSemesterExams();
    if (!term) return { ok: false, message: "No timetable is saved." };
    if (exams.length === 0) {
      return {
        ok: true,
        message: "NUSMods lists no finals for this semester.",
      };
    }
    const result = await syncExamEvents(
      await getCalendarGateway(),
      term.acadYear,
      term.semester,
      exams,
      modules,
    );
    if (result.failed.length > 0) {
      return {
        ok: false,
        message: `Couldn't add ${result.failed.join(", ")} to Google Calendar. Try again.`,
      };
    }
    return {
      ok: true,
      message: `${result.saved.length} final${result.saved.length === 1 ? "" : "s"} on Google Calendar.`,
    };
  },

  async deadlines() {
    return splitDeadlines(await deadlineStore.all(), new Date());
  },

  async submissions() {
    if (!isCanvasConfigured()) return [];
    const { baseUrl, token } = canvasConfig();
    const canvas = new CanvasClient(baseUrl, token);
    const now = Date.now();
    const soon = (await deadlineStore.all())
      .filter(
        (d) =>
          d.dueAt.getTime() > now && d.dueAt.getTime() < now + 14 * 86_400_000,
      )
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .slice(0, MAX_SUBMISSION_CHECKS);
    const states: Awaited<ReturnType<PlannerActions["submissions"]>> = [];
    for (const deadline of soon) {
      try {
        const assignment = await canvas.getAssignment(
          deadline.courseId,
          deadline.assignmentId,
        );
        states.push({
          assignmentId: deadline.assignmentId,
          state: submissionState(assignment),
        });
      } catch {
        states.push({ assignmentId: deadline.assignmentId, state: "unknown" });
      }
    }
    return states;
  },

  async exportCsv(kind) {
    switch (kind) {
      case "spending": {
        const rows = await expenditureStore.daysInRange(
          "2000-01-01",
          "2100-12-31",
        );
        return toCsv(
          ["date", "total_sgd", "status"],
          rows.map((row) => [
            row.spendDate,
            (row.totalCents / 100).toFixed(2),
            row.status,
          ]),
        );
      }
      case "tasks": {
        const rows = await db.select().from(tasks).orderBy(asc(tasks.id));
        return toCsv(
          ["id", "description", "module", "due_date", "done", "created_at"],
          rows.map((row) => [
            row.id,
            row.description,
            row.module,
            row.dueDate,
            row.done,
            row.createdAt.toISOString(),
          ]),
        );
      }
      case "todos": {
        const rows = await db.select().from(todos).orderBy(asc(todos.id));
        return toCsv(
          ["id", "description", "created_at"],
          rows.map((row) => [
            row.id,
            row.description,
            row.createdAt.toISOString(),
          ]),
        );
      }
      case "reminders": {
        const rows = await db
          .select()
          .from(reminders)
          .where(eq(reminders.ownerId, telegramOwnerId()))
          .orderBy(asc(reminders.scheduledAt));
        return toCsv(
          ["id", "description", "scheduled_at", "status", "sent_at"],
          rows.map((row) => [
            row.id,
            row.description,
            row.scheduledAt.toISOString(),
            row.status,
            row.sentAt?.toISOString() ?? null,
          ]),
        );
      }
      case "repeating": {
        const rows = await allRecurring();
        return toCsv(
          ["id", "description", "when"],
          rows.map((row) => {
            const rule = decodeRule(row.rule);
            return [
              row.id,
              row.description,
              rule ? describeRule(rule) : row.rule,
            ];
          }),
        );
      }
      case "applepay": {
        const rows = await applePayStore.inRange("2000-01-01", "2100-12-31");
        return toCsv(
          [
            "id",
            "date",
            "received_at",
            "amount_sgd",
            "amount_as_sent",
            "merchant",
            "card",
            "status",
            "source",
            "kind",
            "read_by_ai",
          ],
          rows.map((row) => [
            row.id,
            row.spendDate,
            row.receivedAt.toISOString(),
            row.amountCents === null
              ? null
              : (row.amountCents / 100).toFixed(2),
            row.amountText,
            row.merchant,
            row.card,
            row.status,
            row.source,
            row.kind,
            row.readByAi ? "yes" : "no",
          ]),
        );
      }
      case "chats": {
        const rows = await db
          .select({
            chatId: webChats.id,
            title: webChats.title,
            role: webChatMessages.role,
            content: webChatMessages.content,
            createdAt: webChatMessages.createdAt,
          })
          .from(webChatMessages)
          .innerJoin(webChats, eq(webChats.id, webChatMessages.chatId))
          .orderBy(asc(webChatMessages.chatId), asc(webChatMessages.id));
        return toCsv(
          ["chat_id", "chat_title", "role", "message", "sent_at"],
          rows.map((row) => [
            row.chatId,
            row.title,
            row.role,
            row.content,
            row.createdAt.toISOString(),
          ]),
        );
      }
    }
  },
};
