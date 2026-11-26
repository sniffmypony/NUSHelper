import { isValidIsoDate } from "../dates.js";
import type { PlannerActions } from "./planner-actions.js";
import {
  EXPORT_KINDS,
  isMonth,
  type ExportKind,
  type Result,
} from "./planner.js";

// The planner pages' API (Today, Tasks, Spending, Timetable, Deadlines,
// export), called by the router after sign-in. Inputs are checked here.

export type PlannerResponse =
  | { status: number; body: unknown }
  | {
      status: 200;
      download: { filename: string; contentType: string; body: string };
    };

const MAX_TEXT = 500;
const MODULE = /^[A-Z]{2,4}\d{4}[A-Z]{0,3}$/;

const bad = (error: string): PlannerResponse => ({
  status: 400,
  body: { error },
});
const ok = (body: unknown): PlannerResponse => ({ status: 200, body });
const result = (outcome: Result): PlannerResponse => ({
  status: outcome.ok ? 200 : 422,
  body: outcome.ok ? outcome : { error: outcome.message },
});

function text(body: unknown, name: string): string {
  const value = (body as Record<string, unknown> | null)?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function id(raw: string): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : null;
}

export async function plannerRoute(
  method: string,
  route: string,
  body: unknown,
  actions: PlannerActions,
): Promise<PlannerResponse | null> {
  if (method === "GET" && route === "today") return ok(await actions.today());

  if (route === "tasks") {
    if (method === "GET") return ok(await actions.tasks());
    if (method === "POST") {
      const description = text(body, "description");
      const module = text(body, "module").replace(/\s+/g, "").toUpperCase();
      const dueDate = text(body, "dueDate");
      if (!description || description.length > MAX_TEXT) {
        return bad("Describe the task (up to 500 characters).");
      }
      if (/[#@]/.test(description)) {
        return bad("Leave # and @ out; use the module and date fields.");
      }
      if (module && !MODULE.test(module)) {
        return bad("Enter a module code like CS2102.");
      }
      if (dueDate && !isValidIsoDate(dueDate)) return bad("Pick a real date.");
      return result(
        await actions.addTask({
          description,
          module: module || null,
          dueDate: dueDate || null,
        }),
      );
    }
  }
  const task = /^tasks\/(\d{1,10})(\/done)?$/.exec(route);
  if (task) {
    const taskId = id(task[1]);
    if (taskId === null) return bad("Unknown task.");
    if (method === "POST" && task[2]) {
      return result(await actions.completeTask(taskId));
    }
    if (method === "DELETE" && !task[2]) {
      return result(await actions.deleteTask(taskId));
    }
  }

  if (method === "POST" && route === "todos") {
    const description = text(body, "description");
    if (!description || description.length > MAX_TEXT) {
      return bad("Describe the to-do (up to 500 characters).");
    }
    return result(await actions.addTodo(description));
  }
  const todo = /^todos\/(\d{1,10})$/.exec(route);
  if (todo && method === "DELETE") {
    const todoId = id(todo[1]);
    if (todoId === null) return bad("Unknown to-do.");
    return result(await actions.finishTodo(todoId));
  }

  if (method === "POST" && route === "repeating") {
    const when = text(body, "when").toLowerCase().replace(/\s+/g, "");
    const description = text(body, "description");
    if (!description || description.length > MAX_TEXT) {
      return bad("Describe what repeats (up to 500 characters).");
    }
    if (!when || when.length > 60) return bad("Say when it repeats.");
    return result(await actions.addRepeating(when, description));
  }
  const repeating = /^repeating\/(\d{1,10})$/.exec(route);
  if (repeating && method === "DELETE") {
    const repeatingId = id(repeating[1]);
    if (repeatingId === null) return bad("Unknown repeating item.");
    return result(await actions.deleteRepeating(repeatingId));
  }

  const spending = /^spending\/(\d{4}-\d{2})$/.exec(route);
  if (spending && method === "GET") {
    if (!isMonth(spending[1])) return bad("Months are YYYY-MM.");
    return ok(await actions.spending(spending[1]));
  }

  if (method === "GET" && route === "timetable/week") {
    return ok(await actions.timetable());
  }
  if (method === "GET" && route === "timetable/finals") {
    return ok(await actions.finals());
  }
  if (method === "POST" && route === "timetable/finals/sync") {
    return result(await actions.syncFinals());
  }

  if (method === "GET" && route === "applepay") {
    return ok(await actions.applePayStatus());
  }
  if (method === "GET" && route === "bankemail") {
    return ok(await actions.bankEmailStatus());
  }
  const payment = /^payments\/(\d{1,10})\/(count|skip)$/.exec(route);
  if (payment && method === "POST") {
    const paymentId = id(payment[1]);
    if (paymentId === null) return bad("Unknown payment.");
    return result(
      payment[2] === "count"
        ? await actions.countPayment(paymentId)
        : await actions.skipPayment(paymentId),
    );
  }
  const applePay = /^applepay\/(\d{1,10})\/undo$/.exec(route);
  if (applePay && method === "POST") {
    const paymentId = id(applePay[1]);
    if (paymentId === null) return bad("Unknown payment.");
    return result(await actions.undoApplePay(paymentId));
  }

  if (method === "GET" && route === "deadlines") {
    return ok(await actions.deadlines());
  }
  if (method === "POST" && route === "deadlines/submissions") {
    return ok({ states: await actions.submissions() });
  }

  const exported = /^export\/([a-z]+)\.csv$/.exec(route);
  if (exported && method === "GET") {
    const kind = exported[1] as ExportKind;
    if (!EXPORT_KINDS.includes(kind)) return bad("Unknown export.");
    return {
      status: 200,
      download: {
        filename: `nushelper-${kind}.csv`,
        contentType: "text/csv; charset=utf-8",
        // A byte-order mark so Excel reads the text as UTF-8.
        body: `\uFEFF${await actions.exportCsv(kind)}`,
      },
    };
  }

  return null;
}
