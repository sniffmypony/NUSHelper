import { afterEach, describe, expect, it, vi } from "vitest";
import { acadWeekInfo } from "../src/nus/academic-week.js";
import {
  acadWeekLabel,
  describeAcadWeek,
  matriculationYear,
  parseWeekCommand,
} from "../src/nus/week.js";
import { addDays } from "../src/dates.js";

// Rows as printed in the official NUS academic calendar PDFs for AY26/27,
// AY27/28 and AY28/29: [first day, last day].
type Range = [string, string];
interface PdfSemester {
  orientation?: Range;
  weeks: Range[]; // weeks 1-13
  recess: Range;
  reading: Range;
  exams: Range;
  vacationStart: string; // a Sunday
}

function weeks(week1: string, week7: string, week7End: string): Range[] {
  const rows: Range[] = [];
  for (let n = 0; n < 6; n++) {
    rows.push([addDays(week1, 7 * n), addDays(week1, 7 * n + 4)]);
  }
  rows.push([week7, week7End]);
  for (let n = 1; n < 7; n++) {
    rows.push([addDays(week7, 7 * n), addDays(week7, 7 * n + 4)]);
  }
  return rows;
}

const PDF: Record<string, [PdfSemester, PdfSemester]> = {
  "26/27": [
    {
      orientation: ["2026-08-03", "2026-08-08"],
      weeks: weeks("2026-08-10", "2026-09-28", "2026-10-03"),
      recess: ["2026-09-19", "2026-09-27"],
      reading: ["2026-11-14", "2026-11-20"],
      exams: ["2026-11-21", "2026-12-05"],
      vacationStart: "2026-12-06",
    },
    {
      weeks: weeks("2027-01-11", "2027-03-01", "2027-03-06"),
      recess: ["2027-02-20", "2027-02-28"],
      reading: ["2027-04-17", "2027-04-23"],
      exams: ["2027-04-24", "2027-05-08"],
      vacationStart: "2027-05-09",
    },
  ],
  "27/28": [
    {
      orientation: ["2027-08-02", "2027-08-07"],
      weeks: weeks("2027-08-09", "2027-09-27", "2027-10-02"),
      recess: ["2027-09-18", "2027-09-26"],
      reading: ["2027-11-13", "2027-11-19"],
      exams: ["2027-11-20", "2027-12-04"],
      vacationStart: "2027-12-05",
    },
    {
      weeks: weeks("2028-01-10", "2028-02-28", "2028-03-04"),
      recess: ["2028-02-19", "2028-02-27"],
      reading: ["2028-04-15", "2028-04-21"],
      exams: ["2028-04-22", "2028-05-06"],
      vacationStart: "2028-05-07",
    },
  ],
  "28/29": [
    {
      orientation: ["2028-08-07", "2028-08-12"],
      weeks: weeks("2028-08-14", "2028-10-02", "2028-10-07"),
      recess: ["2028-09-23", "2028-10-01"],
      reading: ["2028-11-18", "2028-11-24"],
      exams: ["2028-11-25", "2028-12-09"],
      vacationStart: "2028-12-10",
    },
    {
      weeks: weeks("2029-01-15", "2029-03-05", "2029-03-10"),
      recess: ["2029-02-24", "2029-03-04"],
      reading: ["2029-04-21", "2029-04-27"],
      exams: ["2029-04-28", "2029-05-12"],
      vacationStart: "2029-05-13",
    },
  ],
};

const YEAR_OF_STUDY: Record<string, number> = {
  "26/27": 2,
  "27/28": 3,
  "28/29": 4,
};

describe("NUSMods' week rule against the official calendars", () => {
  for (const [ay, semesters] of Object.entries(PDF)) {
    semesters.forEach((sem, index) => {
      const prefix = `Y${YEAR_OF_STUDY[ay]}S${index + 1}`;
      const label = (date: string) => acadWeekLabel(date, 2025);

      it(`AY${ay} semester ${index + 1} matches every row of the PDF`, () => {
        const check = (range: Range, expected: string) => {
          for (const date of range) expect(label(date), date).toBe(expected);
        };
        if (sem.orientation) {
          check(sem.orientation, `${prefix} Orientation Week, AY ${ay}`);
        }
        sem.weeks.forEach((range, n) =>
          check(range, `${prefix}W${n + 1}, AY ${ay}`),
        );
        check(sem.recess, `${prefix} Recess Week, AY ${ay}`);
        check(sem.reading, `${prefix} Reading Week, AY ${ay}`);
        expect(label(sem.exams[0])).toBe(`${prefix} Exam Week 1, AY ${ay}`);
        expect(label(sem.exams[1])).toBe(`${prefix} Exam Week 2, AY ${ay}`);
        expect(acadWeekInfo(sem.vacationStart).type).toBe("Vacation");
      });
    });
  }

  it("puts the special terms after semester 2's exams", () => {
    // AY26/27: Special Term I from Mon 10 May, Part II from Mon 21 Jun 2027.
    expect(acadWeekLabel("2027-05-10", 2025)).toBe("Y2ST1W1, AY 26/27");
    expect(acadWeekLabel("2027-06-21", 2025)).toBe("Y2ST2W1, AY 26/27");
    expect(acadWeekLabel("2027-08-02", 2025)).toBe(
      "Y3S1 Orientation Week, AY 27/28",
    );
  });
});

describe("acadWeekLabel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("leaves out the year of study when it isn't configured", () => {
    vi.stubEnv("NUS_MATRICULATION_YEAR", "");
    expect(matriculationYear()).toBeNull();
    expect(acadWeekLabel("2026-09-30")).toBe("S1W7, AY 26/27");
    expect(acadWeekLabel("2026-12-20")).toBe("S1 Vacation, AY 26/27");
  });

  it("reads the year of study from NUS_MATRICULATION_YEAR", () => {
    vi.stubEnv("NUS_MATRICULATION_YEAR", "2025");
    expect(acadWeekLabel("2026-09-30")).toBe("Y2S1W7, AY 26/27");
    vi.stubEnv("NUS_MATRICULATION_YEAR", "twenty");
    expect(matriculationYear()).toBeNull();
  });

  it("drops a year of study that can't be right", () => {
    expect(acadWeekLabel("2026-09-30", 2030)).toBe("S1W7, AY 26/27");
  });
});

describe("describeAcadWeek", () => {
  it("shows finals ahead during the semester", () => {
    expect(describeAcadWeek("2026-11-20", 2025)).toBe(
      [
        "Y2S1 Reading Week, AY 26/27",
        "Reading Week: Sat 14 Nov 2026 – Fri 20 Nov 2026",
        "Finals: Sat 21 Nov 2026 – Sat 5 Dec 2026 (start tomorrow)",
      ].join("\n"),
    );
    expect(describeAcadWeek("2026-09-30", 2025)).toBe(
      [
        "Y2S1W7, AY 26/27",
        "Week 7 (odd week): Mon 28 Sep 2026 – Sun 4 Oct 2026",
        "Finals: Sat 21 Nov 2026 – Sat 5 Dec 2026 (start in 7 weeks 3 days)",
      ].join("\n"),
    );
  });

  it("shows when finals end during exams", () => {
    expect(describeAcadWeek("2026-11-28", 2025)).toBe(
      [
        "Y2S1 Exam Week 1, AY 26/27",
        "Exam Week 1: Sat 21 Nov 2026 – Sun 29 Nov 2026",
        "Finals end Sat 5 Dec 2026 (in 1 week)",
      ].join("\n"),
    );
  });

  it("shows the next semester during vacation", () => {
    expect(describeAcadWeek("2026-12-20", 2025)).toBe(
      [
        "Y2S1 Vacation, AY 26/27",
        "Vacation: Sun 6 Dec 2026 – Sun 10 Jan 2027",
        "Next: AY 26/27 Semester 2 Week 1 starts Mon 11 Jan 2027 (in 3 weeks 1 day)",
      ].join("\n"),
    );
  });
});

describe("parseWeekCommand", () => {
  it("defaults to today and accepts DD-MM-YYYY", () => {
    expect(parseWeekCommand("/week", "2026-11-20")).toBe("2026-11-20");
    expect(parseWeekCommand("/week@hr_bot", "2026-11-20")).toBe("2026-11-20");
    expect(parseWeekCommand("/week 01-03-2027")).toBe("2027-03-01");
    expect(parseWeekCommand("/week 31-02-2027")).toBeNull();
    expect(parseWeekCommand("/week next")).toBeNull();
  });
});

describe("academic week in the assistant", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers academic_week for a date and rejects bad dates", async () => {
    vi.stubEnv("NUS_MATRICULATION_YEAR", "2025");
    const { executeBotActionTool } =
      await import("../src/assistant/bot-tools.js");
    const actions = {} as Parameters<typeof executeBotActionTool>[2];
    await expect(
      executeBotActionTool("academic_week", { date: "2027-03-01" }, actions),
    ).resolves.toMatch(/^Y2S2W7, AY 26\/27\nWeek 7 \(odd week\)/);
    await expect(
      executeBotActionTool("academic_week", { date: "01-03-2027" }, actions),
    ).rejects.toThrow("YYYY-MM-DD");
  });

  it("puts the current week in the system prompt", async () => {
    vi.stubEnv("NUS_MATRICULATION_YEAR", "2025");
    const { systemPrompt } = await import("../src/assistant/agent.js");
    expect(systemPrompt(new Date("2026-11-20T04:00:00Z"))).toContain(
      "NUS academic week: Y2S1 Reading Week, AY 26/27",
    );
  });
});
