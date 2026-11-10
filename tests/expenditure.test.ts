import { describe, expect, it } from "vitest";
import {
  clippedWeeks,
  formatMonthlyReport,
  formatWeeklyReport,
  isDateEditable,
  parseExpenditureAmounts,
  parseMonthlyExpenditureQuery,
  shouldSendReportsNow,
} from "../src/expenditure.js";

describe("expenditure amount parsing", () => {
  it("sums spaces, commas, and new lines using exact cents", () => {
    expect(parseExpenditureAmounts("10.95 11 3")).toBe(2495);
    expect(parseExpenditureAmounts("10.95, 11,\n3")).toBe(2495);
    expect(parseExpenditureAmounts("0 0.5 0.05")).toBe(55);
  });

  it.each(["", "-1", "+1", "S$10", "$10", "1e3", "10.999", "1..2", "1, nope"])(
    "rejects invalid input %j",
    (value) => {
      expect(parseExpenditureAmounts(value)).toBeNull();
    },
  );

  it("requires a full month and four-digit year", () => {
    expect(parseMonthlyExpenditureQuery("june 2027 expenditure")).toEqual({
      start: "2027-06-01",
      end: "2027-06-30",
      label: "June 2027",
    });
    expect(parseMonthlyExpenditureQuery("Jun 2027 expenditure")).toBeNull();
    expect(parseMonthlyExpenditureQuery("June expenditure")).toBeNull();
  });
});

describe("expenditure reports", () => {
  it("splits a month into Monday-Sunday weeks clipped at both ends", () => {
    expect(clippedWeeks("2026-02-01", "2026-02-28")).toEqual([
      { start: "2026-02-01", end: "2026-02-01" },
      { start: "2026-02-02", end: "2026-02-08" },
      { start: "2026-02-09", end: "2026-02-15" },
      { start: "2026-02-16", end: "2026-02-22" },
      { start: "2026-02-23", end: "2026-02-28" },
    ]);
  });

  it("formats weekly total and independent month-to-date total", () => {
    const text = formatWeeklyReport(
      [
        { spendDate: "2026-09-01", totalCents: 500, status: "logged" },
        { spendDate: "2026-09-07", totalCents: 1000, status: "logged" },
        { spendDate: "2026-09-13", totalCents: 250, status: "logged" },
      ],
      { start: "2026-09-07", end: "2026-09-13" },
    );
    expect(text).toContain("7 Sep – 13 Sep: S$12.50");
    expect(text).toContain("September month-to-date: S$17.50");
  });

  it("lists all tied highest-spend clipped weeks and coverage", () => {
    const text = formatMonthlyReport(
      [
        { spendDate: "2026-02-01", totalCents: 1000, status: "logged" },
        { spendDate: "2026-02-03", totalCents: 1000, status: "logged" },
      ],
      { start: "2026-02-01", end: "2026-02-28" },
      false,
      true,
    );
    expect(text).toContain("Total: S$20.00");
    expect(text).toContain(
      "Highest-spend weeks: 1 Feb – 1 Feb, 2 Feb – 8 Feb (S$10.00)",
    );
    expect(text).toContain("2/28 days stored");
  });

  it("allows edits for 365 days but not after the deadline", () => {
    expect(isDateEditable("2025-10-31", new Date("2026-10-31T15:59:59Z"))).toBe(
      true,
    );
    expect(isDateEditable("2025-10-30", new Date("2026-10-31T00:00:00Z"))).toBe(
      false,
    );
  });
});

describe("daytime expenditure entries", () => {
  it("hold today's reports until the 11:30pm prompt", () => {
    const noon = new Date("2026-11-08T04:00:00Z"); // Sunday 12:00 SGT
    expect(shouldSendReportsNow("2026-11-08", noon)).toBe(false);
    expect(shouldSendReportsNow("2026-11-07", noon)).toBe(true);
    const lateNight = new Date("2026-11-08T15:40:00Z"); // Sunday 23:40 SGT
    expect(shouldSendReportsNow("2026-11-08", lateNight)).toBe(true);
  });
});
