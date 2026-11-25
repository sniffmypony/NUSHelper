import { describe, expect, it, vi } from "vitest";
import type { PlannerActions } from "../src/web/planner-actions.js";
import { plannerRoute } from "../src/web/planner-routes.js";
import {
  chooseSemester,
  csvCell,
  isMonth,
  spendingMonth,
  splitDeadlines,
  toCsv,
} from "../src/web/planner.js";

describe("spending month", () => {
  const rows = [
    { spendDate: "2026-11-02", totalCents: 890, status: "logged" },
    { spendDate: "2026-11-03", totalCents: 0, status: "auto_zero" },
    { spendDate: "2026-11-06", totalCents: 6985, status: "logged" },
    { spendDate: "2026-11-30", totalCents: 500, status: "logged" },
  ];

  it("totals the recorded days up to today and leaves the future empty", () => {
    const month = spendingMonth(
      "2026-11",
      rows,
      [{ totalCents: 1000 }],
      "2026-11-24",
    );
    expect(month.label).toBe("November 2026");
    expect(month.days).toHaveLength(30);
    expect(month.totalCents).toBe(890 + 0 + 6985);
    expect(month.recordedDays).toBe(3);
    expect(month.averageCents).toBe(Math.round(7875 / 3));
    expect(month.highest).toEqual({ date: "2026-11-06", cents: 6985 });
    expect(month.days.at(-1)).toMatchObject({ cents: null, future: true });
    expect(month.previousTotalCents).toBe(1000);
  });

  it("splits it into Monday-to-Sunday weeks within the month", () => {
    const month = spendingMonth("2026-11", rows, [], "2026-11-30");
    // 1 Nov 2026 is a Sunday.
    expect(month.weeks[0]).toEqual({
      start: "2026-11-01",
      end: "2026-11-01",
      cents: 0,
    });
    expect(month.weeks[1]).toEqual({
      start: "2026-11-02",
      end: "2026-11-08",
      cents: 7875,
    });
    expect(month.weeks.at(-1)).toEqual({
      start: "2026-11-30",
      end: "2026-11-30",
      cents: 500,
    });
  });

  it("accepts only real months", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("26-11")).toBe(false);
  });
});

describe("CSV", () => {
  it("quotes what needs quoting and defuses spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5 lunch")).toBe("'-5 lunch");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [["x", 1]])).toBe("a,b\r\nx,1\r\n");
  });
});

describe("timetable semester", () => {
  const lesson = (acadYear: string, semester: number) => ({
    acadYear,
    semester,
    moduleCode: "CS2102",
    lessonType: "Lecture",
    classNo: "1",
    day: 1,
    startTime: "1600",
    endTime: "1800",
  });

  it("shows the running semester when it is saved, else the latest", () => {
    const saved = [lesson("2026-2027", 1), lesson("2026-2027", 2)];
    // 24 Nov 2026 is in Semester 1.
    expect(chooseSemester(saved, "2026-11-24")).toMatchObject({
      acadYear: "2026-2027",
      semester: 1,
      label: "AY2026/2027 Semester 1",
    });
    expect(
      chooseSemester([lesson("2025-2026", 2)], "2026-11-24"),
    ).toMatchObject({ acadYear: "2025-2026", semester: 2 });
    expect(chooseSemester([], "2026-11-24")).toBeNull();
  });
});

describe("deadlines", () => {
  it("splits upcoming (soonest first) from the last 14 days", () => {
    const now = new Date("2026-11-24T00:00:00Z");
    const at = (iso: string, id: number) => ({
      assignmentId: id,
      moduleCode: "CS2102",
      name: `A${id}`,
      dueAt: new Date(iso),
      htmlUrl: null,
    });
    const { upcoming, recent } = splitDeadlines(
      [
        at("2026-11-30T15:59:00Z", 2),
        at("2026-11-25T15:59:00Z", 1),
        at("2026-11-20T15:59:00Z", 3),
        at("2026-10-01T15:59:00Z", 4),
      ],
      now,
    );
    expect(upcoming.map((d) => d.assignmentId)).toEqual([1, 2]);
    expect(recent.map((d) => d.assignmentId)).toEqual([3]);
  });
});

describe("planner routes", () => {
  const done = { ok: true, message: "Done" };
  function actions() {
    return {
      today: vi.fn(),
      tasks: vi.fn(),
      addTask: vi.fn(async () => done),
      completeTask: vi.fn(async () => done),
      deleteTask: vi.fn(async () => done),
      addTodo: vi.fn(async () => done),
      finishTodo: vi.fn(async () => done),
      addRepeating: vi.fn(async () => done),
      deleteRepeating: vi.fn(async () => done),
      spending: vi.fn(async () => ({})),
      timetable: vi.fn(),
      finals: vi.fn(),
      syncFinals: vi.fn(),
      deadlines: vi.fn(),
      submissions: vi.fn(async () => []),
      exportCsv: vi.fn(async () => "a,b\r\n"),
    } as unknown as PlannerActions & Record<string, ReturnType<typeof vi.fn>>;
  }

  it("checks a new task before adding it", async () => {
    const a = actions();
    const add = (body: unknown) => plannerRoute("POST", "tasks", body, a);
    expect((await add({ description: "" }))?.status).toBe(400);
    expect((await add({ description: "x #CS2102" }))?.status).toBe(400);
    expect((await add({ description: "x", module: "hello" }))?.status).toBe(
      400,
    );
    expect(
      (await add({ description: "x", dueDate: "2026-02-30" }))?.status,
    ).toBe(400);
    expect(
      (
        await add({
          description: "ER diagram",
          module: "cs 2102",
          dueDate: "2026-11-27",
        })
      )?.status,
    ).toBe(200);
    expect(a.addTask).toHaveBeenCalledWith({
      description: "ER diagram",
      module: "CS2102",
      dueDate: "2026-11-27",
    });
  });

  it("completes, deletes and ticks off by id", async () => {
    const a = actions();
    await plannerRoute("POST", "tasks/7/done", undefined, a);
    await plannerRoute("DELETE", "tasks/7", undefined, a);
    await plannerRoute("DELETE", "todos/3", undefined, a);
    await plannerRoute("DELETE", "repeating/2", undefined, a);
    expect(a.completeTask).toHaveBeenCalledWith(7);
    expect(a.deleteTask).toHaveBeenCalledWith(7);
    expect(a.finishTodo).toHaveBeenCalledWith(3);
    expect(a.deleteRepeating).toHaveBeenCalledWith(2);
  });

  it("only reads real months of spending", async () => {
    const a = actions();
    expect(
      (await plannerRoute("GET", "spending/2026-13", undefined, a))?.status,
    ).toBe(400);
    expect(
      (await plannerRoute("GET", "spending/2026-11", undefined, a))?.status,
    ).toBe(200);
    expect(a.spending).toHaveBeenCalledWith("2026-11");
  });

  it("exports known lists as CSV files only", async () => {
    const a = actions();
    const file = await plannerRoute("GET", "export/spending.csv", undefined, a);
    expect(file).toMatchObject({
      status: 200,
      download: {
        filename: "nushelper-spending.csv",
        contentType: "text/csv; charset=utf-8",
        body: "\uFEFFa,b\r\n",
      },
    });
    expect(
      (await plannerRoute("GET", "export/secrets.csv", undefined, a))?.status,
    ).toBe(400);
  });
});
