import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));

import { CanvasAuthError, CanvasRequestError } from "../src/canvas/client.js";
import {
  canvasDeadlineSection,
  fetchDueItems,
  type DeadlineSource,
} from "../src/canvas/deadlines.js";
import {
  acadWeekInfo,
  acadYearStart,
  teachingWeek,
} from "../src/nus/academic-week.js";
import {
  lessonRunsOn,
  parseShareLink,
  selectLessons,
  type RawLesson,
} from "../src/nus/timetable-link.js";
import {
  describeTimetable,
  importTimetable,
  todaysClassesSection,
  type FetchLike,
  type NewLesson,
  type TimetableStore,
} from "../src/nus/timetable.js";

describe("NUS academic weeks (NUSMods' rule)", () => {
  it("starts the year on the first Monday of August", () => {
    // The same years NUSMods tests its own calculator with.
    expect(acadYearStart(2014)).toBe("2014-08-04");
    expect(acadYearStart(2016)).toBe("2016-08-01");
    expect(acadYearStart(2019)).toBe("2019-08-05");
    expect(acadYearStart(2026)).toBe("2026-08-03");
  });

  it("matches NUSMods' own examples for AY16/17", () => {
    const week = (date: string) => {
      const { type, num, sem, year } = acadWeekInfo(date);
      return { type, num, sem, year };
    };
    const sem1 = { sem: "Semester 1", year: "16/17" };
    expect(week("2016-08-01")).toEqual({
      ...sem1,
      type: "Orientation",
      num: null,
    });
    expect(week("2016-08-08")).toEqual({
      ...sem1,
      type: "Instructional",
      num: 1,
    });
    expect(week("2016-08-14")).toEqual({
      ...sem1,
      type: "Instructional",
      num: 1,
    });
    expect(week("2016-09-12")).toEqual({
      ...sem1,
      type: "Instructional",
      num: 6,
    });
    expect(week("2016-09-19")).toEqual({ ...sem1, type: "Recess", num: null });
    expect(week("2016-09-27")).toEqual({
      ...sem1,
      type: "Instructional",
      num: 7,
    });
    expect(week("2016-11-11")).toEqual({
      ...sem1,
      type: "Instructional",
      num: 13,
    });
    expect(week("2016-11-14")).toEqual({ ...sem1, type: "Reading", num: null });
    expect(week("2016-11-21")).toEqual({
      ...sem1,
      type: "Examination",
      num: 1,
    });
    expect(week("2016-12-02")).toEqual({
      ...sem1,
      type: "Examination",
      num: 2,
    });
    expect(week("2016-12-07").type).toBe("Vacation");
    expect(acadWeekInfo("2016-07-31").year).toBe("15/16");
  });

  it("gives this year's weeks: AY26/27", () => {
    const type = (date: string) => acadWeekInfo(date).type;
    expect(teachingWeek("2026-08-03")).toBeNull(); // orientation
    expect(teachingWeek("2026-08-10")).toEqual({
      year: "2026-2027",
      semester: 1,
      week: 1,
    });
    expect(teachingWeek("2026-09-18")?.week).toBe(6);
    expect(type("2026-09-19")).toBe("Recess"); // the Saturday before
    expect(teachingWeek("2026-09-21")).toBeNull();
    expect(teachingWeek("2026-09-28")?.week).toBe(7);
    expect(teachingWeek("2026-11-13")?.week).toBe(13);
    expect(type("2026-11-14")).toBe("Reading");
    expect(teachingWeek("2026-11-16")).toBeNull();
    expect(type("2026-11-21")).toBe("Examination");
    expect(type("2026-12-10")).toBe("Vacation");
    expect(teachingWeek("2027-01-04")).toBeNull(); // week before semester 2
    expect(teachingWeek("2027-01-11")).toEqual({
      year: "2026-2027",
      semester: 2,
      week: 1,
    });
    expect(type("2027-02-22")).toBe("Recess");
    expect(teachingWeek("2027-04-16")?.week).toBe(13);
    expect(type("2027-04-19")).toBe("Reading");
  });

  it("does not treat special terms as teaching weeks 1-13", () => {
    expect(acadWeekInfo("2027-05-17").sem).toBe("Special Term I");
    expect(teachingWeek("2027-05-17")).toBeNull();
  });
});

const ALL_WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const lesson = (overrides: Partial<RawLesson>): RawLesson => ({
  classNo: "G14",
  startTime: "1600",
  endTime: "1800",
  weeks: ALL_WEEKS,
  day: "Friday",
  lessonType: "Lecture",
  venue: "I3-AUD",
  ...overrides,
});

const CS2103T: RawLesson[] = [
  lesson({ classNo: "G13", day: "Thursday" }),
  lesson({}),
  lesson({
    classNo: "T05",
    lessonType: "Tutorial",
    day: "Monday",
    startTime: "1000",
    endTime: "1100",
    venue: "COM1-0210",
    weeks: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  }),
  lesson({
    classNo: "B01",
    lessonType: "Laboratory",
    day: "Monday",
    startTime: "1400",
    endTime: "1600",
    venue: "COM1-B109",
    weeks: [2, 4, 6, 8, 10, 12],
  }),
];

describe("NUSMods share links", () => {
  it("reads the semester and modules, skipping hidden ones", () => {
    expect(
      parseShareLink(
        "https://nusmods.com/timetable/sem-2/share?CS2103T=LEC:G14,TUT:T05&CS2102=LEC:1&hidden=CS2102&ta=CS1010S",
      ),
    ).toEqual({
      semester: 2,
      modules: [{ moduleCode: "CS2103T", config: "LEC:G14,TUT:T05" }],
    });
    expect(
      parseShareLink("https://nusmods.com/timetable/st-i/share?MA1521=LEC:1")
        ?.semester,
    ).toBe(3);
  });

  it("only accepts NUSMods timetable links", () => {
    const query = "?CS2103T=LEC:G14";
    expect(
      parseShareLink(`https://example.com/timetable/sem-1/share${query}`),
    ).toBeNull();
    expect(
      parseShareLink(`http://nusmods.com/timetable/sem-1/share${query}`),
    ).toBeNull();
    expect(
      parseShareLink(`https://nusmods.com/courses/CS2103T${query}`),
    ).toBeNull();
    expect(
      parseShareLink("https://nusmods.com/timetable/sem-1/share"),
    ).toBeNull();
    expect(parseShareLink("not a link")).toBeNull();
  });

  it("picks classes from all three link formats", () => {
    const picked = (config: string) =>
      selectLessons(config, CS2103T).map(
        (item) => `${item.lessonType} ${item.classNo}`,
      );
    expect(picked("LEC:G14,TUT:T05")).toEqual(["Lecture G14", "Tutorial T05"]);
    expect(picked("LAB:(3);LEC:(1)")).toEqual([
      "Laboratory B01",
      "Lecture G14",
    ]);
    expect(
      picked(
        "TUT:(T05|MON|1000|1100|COM1-0210|3_4_5_6_7_8_9_10_11_12_13);LEC:(G14|FRI|1600|1800|I3-AUD|1_2_3)",
      ),
    ).toEqual(["Tutorial T05", "Lecture G14"]);
    // A position that points at another kind of class is ignored.
    expect(picked("TUT:(1)")).toEqual([]);
    expect(picked("XYZ:1")).toEqual([]);
  });

  it("knows which weeks a class runs", () => {
    expect(lessonRunsOn([2, 4, 6], "2026-08-17", 2)).toBe(true);
    expect(lessonRunsOn([2, 4, 6], "2026-08-24", 3)).toBe(false);
    const range = { start: "2026-08-12", end: "2026-09-09", weekInterval: 2 };
    expect(lessonRunsOn(range, "2026-08-12", 1)).toBe(true);
    expect(lessonRunsOn(range, "2026-08-19", 2)).toBe(false);
    expect(lessonRunsOn(range, "2026-08-26", 3)).toBe(true);
    expect(lessonRunsOn(range, "2026-09-16", 6)).toBe(false);
    expect(
      lessonRunsOn(
        { start: "2026-08-12", end: "2026-11-11", weeks: [1, 3] },
        "2026-08-26",
        3,
      ),
    ).toBe(true);
    expect(lessonRunsOn(undefined, "2026-08-12", 1)).toBe(false);
  });
});

function fakeStore(initial: NewLesson[] = []): TimetableStore & {
  rows: NewLesson[];
} {
  const store = {
    rows: initial,
    replaceAll: vi.fn(async (lessons: NewLesson[]) => {
      store.rows = lessons;
    }),
    clear: vi.fn(async () => {
      store.rows = [];
    }),
    all: vi.fn(async () => store.rows),
    forDay: vi.fn(async (acadYear: string, semester: number, day: number) =>
      store.rows
        .filter(
          (row) =>
            row.acadYear === acadYear &&
            row.semester === semester &&
            row.day === day,
        )
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    ),
  };
  return store;
}

const nusmods = (
  modules: Record<string, RawLesson[]>,
  semester = 2,
): FetchLike =>
  vi.fn(async (url: string) => {
    const match = /\/v2\/(\d{4}-\d{4})\/modules\/([A-Z0-9]+)\.json$/.exec(url);
    const timetable = match ? modules[`${match[1]}/${match[2]}`] : undefined;
    return {
      ok: Boolean(timetable),
      status: timetable ? 200 : 404,
      headers: { get: () => null },
      json: async () => ({ semesterData: [{ semester, timetable }] }),
    };
  });

// Friday 13 November 2026: the last day of semester 1's week 13.
const NOW = new Date("2026-11-13T09:30:00Z");
const LINK =
  "https://nusmods.com/timetable/sem-2/share?CS2103T=LEC:G14,TUT:T05,LAB:B01&GEA1000=TUT:1";

describe("/timetable", () => {
  it("saves the chosen classes and reports a module with none", async () => {
    const store = fakeStore();
    const message = await importTimetable(
      LINK,
      NOW,
      store,
      nusmods({ "2026-2027/CS2103T": CS2103T }),
    );
    expect(
      store.rows.map((row) => `${row.day} ${row.startTime} ${row.lessonType}`),
    ).toEqual(["5 1600 Lecture", "1 1000 Tutorial", "1 1400 Laboratory"]);
    expect(store.rows[0]).toMatchObject({
      acadYear: "2026-2027",
      semester: 2,
      moduleCode: "CS2103T",
      venue: "I3-AUD",
    });
    expect(message).toContain(
      "Saved your Semester 2 timetable (AY2026/2027): 3 classes across 1 module.",
    );
    expect(message).toContain("No classes found for: GEA1000.");
    expect(message).toContain(
      "Monday\n• 10:00–11:00 CS2103T Tutorial — COM1-0210",
    );
  });

  it("keeps the old timetable when the link or the modules are no good", async () => {
    const store = fakeStore([{ ...sampleRow(), moduleCode: "OLD1000" }]);
    await expect(
      importTimetable("https://example.com/x", NOW, store, nusmods({})),
    ).resolves.toMatch(/doesn't look like a NUSMods timetable link/);
    await expect(
      importTimetable(LINK, NOW, store, nusmods({})),
    ).resolves.toMatch(/couldn't find those modules/);
    expect(store.replaceAll).not.toHaveBeenCalled();
    expect(store.rows[0].moduleCode).toBe("OLD1000");
  });

  it("uses next year's data for a semester 1 link sent after semester 1", async () => {
    const store = fakeStore();
    await importTimetable(
      "https://nusmods.com/timetable/sem-1/share?CS2103T=LEC:G14",
      new Date("2027-07-20T02:00:00Z"),
      store,
      nusmods({ "2027-2028/CS2103T": CS2103T }, 1),
    );
    expect(store.rows[0]).toMatchObject({ acadYear: "2027-2028", semester: 1 });
  });

  it("follows a short NUSMods link, and nothing else", async () => {
    const store = fakeStore();
    const data = nusmods({ "2026-2027/CS2103T": CS2103T });
    const fetchImpl: FetchLike = vi.fn(async (url, init) =>
      url.startsWith("https://shorten.nusmods.com/")
        ? {
            ok: false,
            status: 302,
            headers: { get: () => LINK },
            json: async () => ({}),
          }
        : data(url, init),
    );
    await importTimetable(
      "https://shorten.nusmods.com/abc123",
      NOW,
      store,
      fetchImpl,
    );
    expect(store.rows).toHaveLength(3);
  });

  function sampleRow(): NewLesson {
    return {
      acadYear: "2026-2027",
      semester: 2,
      moduleCode: "CS2103T",
      lessonType: "Tutorial",
      classNo: "T05",
      day: 1,
      startTime: "1000",
      endTime: "1100",
      venue: "COM1-0210",
      weeks: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    };
  }

  const semester2 = () =>
    fakeStore([
      sampleRow(),
      {
        ...sampleRow(),
        lessonType: "Laboratory",
        classNo: "B01",
        startTime: "1400",
        endTime: "1600",
        venue: "COM1-B109",
        weeks: [2, 4, 6, 8, 10, 12],
      },
    ]);

  it("lists only the classes that run that week", async () => {
    // Monday of semester 2, week 2: the lab runs, the tutorial has not started.
    await expect(todaysClassesSection("2027-01-18", semester2())).resolves.toBe(
      "🏫 Today's classes (Week 2):\n• 14:00–16:00 CS2103T Laboratory — COM1-B109",
    );
    // Week 4: both.
    await expect(todaysClassesSection("2027-02-01", semester2())).resolves.toBe(
      [
        "🏫 Today's classes (Week 4):",
        "• 10:00–11:00 CS2103T Tutorial — COM1-0210",
        "• 14:00–16:00 CS2103T Laboratory — COM1-B109",
      ].join("\n"),
    );
  });

  it("stays silent in recess, reading, exam and vacation weeks", async () => {
    const store = semester2();
    for (const day of [
      "2027-02-22", // recess week (a Monday)
      "2027-04-19", // reading week
      "2027-04-26", // exam week
      "2027-05-10", // vacation
      "2027-01-04", // the week before semester 2
    ]) {
      await expect(todaysClassesSection(day, store)).resolves.toBeNull();
    }
    expect(store.forDay).not.toHaveBeenCalled();
  });

  it("shows nothing on a day with no class or for another semester", async () => {
    const store = semester2();
    await expect(todaysClassesSection("2027-02-02", store)).resolves.toBeNull();
    // Semester 1 of the next year: the saved timetable is for semester 2.
    await expect(todaysClassesSection("2027-08-16", store)).resolves.toBeNull();
  });

  it("says whether the saved timetable is being announced", async () => {
    await expect(
      describeTimetable(semester2(), new Date("2027-02-01T02:00:00Z")),
    ).resolves.toMatch(/This is teaching week 4\.$/);
    await expect(describeTimetable(semester2(), NOW)).resolves.toMatch(
      /different semester/,
    );
    await expect(
      describeTimetable(semester2(), new Date("2027-04-20T02:00:00Z")),
    ).resolves.toMatch(/not a teaching week/);
    await expect(describeTimetable(fakeStore(), NOW)).resolves.toMatch(
      /^No timetable is saved/,
    );
  });
});

describe("Canvas deadlines for the morning message and digest", () => {
  const source = (overrides: Partial<DeadlineSource> = {}): DeadlineSource => ({
    listActiveCourses: async () => [
      { id: 1, name: "Software Engineering", course_code: "CS2103T" },
      { id: 2, name: "Database Systems", course_code: "CS2102" },
    ],
    listFutureAssignments: async (courseId) =>
      courseId === 1
        ? [
            { id: 10, name: "iP week 13", due_at: "2026-11-14T15:59:00Z" },
            { id: 11, name: "Far away", due_at: "2026-12-20T15:59:00Z" },
            { id: 12, name: "No date", due_at: null },
          ]
        : [
            {
              id: 20,
              name: "Assignment 3",
              due_at: "2026-11-13T15:59:00Z",
              submission: { submitted_at: "2026-11-12T03:00:00Z" },
            },
          ],
    ...overrides,
  });
  const until = new Date(NOW.getTime() + 48 * 3_600_000);

  it("returns what is due in the window, earliest first", async () => {
    const items = await fetchDueItems(source(), NOW, until);
    expect(items.map((item) => `${item.moduleCode} ${item.name}`)).toEqual([
      "CS2102 Assignment 3",
      "CS2103T iP week 13",
    ]);
    expect(items[0].submitted).toBe(true);
  });

  it("leaves submitted work out of the morning message", async () => {
    const result = await canvasDeadlineSection(
      "🎓 Canvas — due in the next 48 hours:",
      NOW,
      until,
      { includeSubmitted: false },
      source(),
    );
    expect(result).toEqual({
      failed: false,
      text: "🎓 Canvas — due in the next 48 hours:\n• Sat 14 Nov, 23:59 — CS2103T: iP week 13",
    });
  });

  it("ticks submitted work in the weekly digest", async () => {
    const result = await canvasDeadlineSection(
      "🎓 Canvas deadlines this week:",
      NOW,
      until,
      { includeSubmitted: true },
      source(),
    );
    expect(result.text).toContain(
      "• Fri 13 Nov, 23:59 — CS2102: Assignment 3 ✅ submitted",
    );
  });

  it("has no section when nothing is due", async () => {
    const result = await canvasDeadlineSection(
      "title",
      NOW,
      until,
      { includeSubmitted: true },
      source({ listFutureAssignments: async () => [] }),
    );
    expect(result).toEqual({ text: null, failed: false });
  });

  it("skips one module that fails but reports Canvas being down", async () => {
    const oneHidden = await canvasDeadlineSection(
      "title",
      NOW,
      until,
      { includeSubmitted: true },
      source({
        listFutureAssignments: async (courseId) => {
          if (courseId === 1) throw new CanvasRequestError("forbidden", 403);
          return [
            { id: 20, name: "Assignment 3", due_at: "2026-11-13T15:59:00Z" },
          ];
        },
      }),
    );
    expect(oneHidden.text).toContain("CS2102: Assignment 3");

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = await canvasDeadlineSection(
      "title",
      NOW,
      until,
      { includeSubmitted: true },
      source({
        listActiveCourses: async () => {
          throw new CanvasAuthError();
        },
      }),
    );
    expect(down).toEqual({ text: null, failed: true });
    // Only the error's type is logged, never Canvas details.
    expect(logged).toHaveBeenCalledWith(
      "Canvas deadline check failed (CanvasAuthError)",
    );
    logged.mockRestore();
  });
});
