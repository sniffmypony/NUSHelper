import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";
import { runAssistant } from "../src/assistant/agent.js";
import {
  breakdownRangeProblem,
  formatDailyBreakdown,
  parseExpenditureBreakdownCommand,
} from "../src/expenditure.js";

describe("/expenditure command parsing", () => {
  it("reads a range or a single day in DD-MM-YYYY", () => {
    expect(
      parseExpenditureBreakdownCommand("/expenditure 03-12-2026 15-12-2026"),
    ).toEqual({ start: "2026-12-03", end: "2026-12-15" });
    expect(
      parseExpenditureBreakdownCommand("/expenditure 03-12-2026 to 15-12-2026"),
    ).toEqual({ start: "2026-12-03", end: "2026-12-15" });
    expect(
      parseExpenditureBreakdownCommand("/expenditure@my_bot 03-12-2026"),
    ).toEqual({ start: "2026-12-03", end: "2026-12-03" });
  });

  it("rejects anything else", () => {
    for (const text of [
      "/expenditure",
      "/expenditure 2026-12-03",
      "/expenditure 31-02-2026",
      "/expenditure 03-12-2026 31-02-2027",
      "/expenditure last week",
    ]) {
      expect(parseExpenditureBreakdownCommand(text), text).toBeNull();
    }
  });
});

describe("range limits", () => {
  it("rejects reversed and very long ranges", () => {
    expect(
      breakdownRangeProblem({ start: "2026-12-15", end: "2026-12-03" }),
    ).toMatch(/on or before/);
    expect(
      breakdownRangeProblem({ start: "2026-01-01", end: "2027-06-01" }),
    ).toMatch(/at most 366/);
    expect(
      breakdownRangeProblem({ start: "2026-01-01", end: "2026-12-31" }),
    ).toBeNull();
  });
});

describe("day-by-day breakdown", () => {
  const days = [
    { spendDate: "2026-11-03", totalCents: 980, status: "logged" },
    { spendDate: "2026-11-04", totalCents: 0, status: "auto_zero" },
    { spendDate: "2026-11-05", totalCents: 1250, status: "logged" },
    { spendDate: "2026-11-06", totalCents: 0, status: "pending" },
  ];

  it("lists every day, including gaps, with the total", () => {
    expect(
      formatDailyBreakdown(
        days,
        { start: "2026-11-02", end: "2026-11-07" },
        "2026-11-09",
      ),
    ).toBe(
      [
        "Expenditure from 2 November 2026 to 7 November 2026:",
        "",
        "Mon 2 Nov: no entry",
        "Tue 3 Nov: S$9.80",
        "Wed 4 Nov: S$0.00 (nothing logged)",
        "Thu 5 Nov: S$12.50",
        "Fri 6 Nov: no entry",
        "Sat 7 Nov: no entry",
        "",
        "Total: S$22.30",
        "Logged on 2 of 6 days.",
      ].join("\n"),
    );
  });

  it("stops at today when the range runs into the future", () => {
    const report = formatDailyBreakdown(
      days,
      { start: "2026-11-05", end: "2026-11-20" },
      "2026-11-06",
    );
    expect(report).not.toContain("Sat 7 Nov");
    expect(report).toContain("Logged on 1 of 2 days.");
    expect(report).toContain("Later dates haven't happened yet.");
  });

  it("explains empty and future ranges", () => {
    expect(
      formatDailyBreakdown(
        [],
        { start: "2025-12-03", end: "2025-12-15" },
        "2026-11-09",
      ),
    ).toBe("No expenditure is stored for 3 December 2025 to 15 December 2025.");
    expect(
      formatDailyBreakdown(
        [],
        { start: "2026-12-03", end: "2026-12-15" },
        "2026-11-09",
      ),
    ).toMatch(/still in the future/);
  });
});

describe("assistant replies with a breakdown", () => {
  function toolCall(): ChatCompletion {
    return {
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "b",
                type: "function",
                function: {
                  name: "expenditure_breakdown",
                  arguments:
                    '{"start_date":"2026-11-03","end_date":"2026-11-05"}',
                },
              },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion;
  }

  it("sends the figures exactly, with no further model call", async () => {
    const create = vi.fn().mockResolvedValueOnce(toolCall());
    const report = "Tue 3 Nov: S$9.80\n\nTotal: S$9.80";
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "breakdown from 3 to 5 nov",
      execute: vi.fn().mockResolvedValue(report),
    });
    expect(result.reply).toBe(report);
    expect(create).toHaveBeenCalledOnce();
  });

  it("lets the model explain a tool error", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolCall())
      .mockResolvedValueOnce({
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "Which dates?" },
          },
        ],
      } as unknown as ChatCompletion);
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "breakdown",
      execute: vi.fn().mockResolvedValue('Error: "start_date" is required.'),
    });
    expect(result.reply).toBe("Which dates?");
  });
});

describe("assistant replies with a report", () => {
  it("does not let the model reword the weekly report", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "r",
                type: "function",
                function: {
                  name: "expenditure_report",
                  arguments: '{"period":"week"}',
                },
              },
            ],
          },
        },
      ],
    } as unknown as ChatCompletion);
    const report = "Weekly expenditure report\n2 Nov – 8 Nov: S$22.30";
    const result = await runAssistant({
      create,
      model: "m",
      history: [],
      userText: "how much did i spend this week",
      execute: vi.fn().mockResolvedValue(report),
    });
    expect(result.reply).toBe(report);
    expect(create).toHaveBeenCalledOnce();
  });
});
