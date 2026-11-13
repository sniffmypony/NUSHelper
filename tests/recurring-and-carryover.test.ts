import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));

import {
  decodeRule,
  describeRule,
  encodeRule,
  isDueOn,
  parseRecurrence,
  parseRecurringCommand,
  type RecurrenceRule,
} from "../src/recurrence.js";
import { recurringKeyboard } from "../src/recurring.js";
import { carryoverKeyboard } from "../src/todo-carryover.js";

describe("/every", () => {
  it("reads weekdays, every day, weekdays-only and a day of the month", () => {
    expect(parseRecurringCommand("/every mon tutorial prep")).toEqual({
      rule: { kind: "weekly", weekdays: [1] },
      description: "tutorial prep",
    });
    expect(parseRecurrence("thu,MON,mon")).toEqual({
      kind: "weekly",
      weekdays: [1, 4],
    });
    expect(parseRecurrence("weekdays")).toEqual({
      kind: "weekly",
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(parseRecurrence("day")).toEqual({ kind: "daily" });
    expect(parseRecurrence("1")).toEqual({ kind: "monthly", day: 1 });
    expect(parseRecurrence("31st")).toEqual({ kind: "monthly", day: 31 });
  });

  it("rejects what it cannot understand", () => {
    expect(parseRecurrence("32")).toBeNull();
    expect(parseRecurrence("0")).toBeNull();
    expect(parseRecurrence("mon,funday")).toBeNull();
    expect(parseRecurringCommand("/every mon")).toBeNull();
    expect(parseRecurringCommand("/every")).toBeNull();
  });

  it("stores a rule as text and reads it back", () => {
    for (const when of ["day", "mon,thu", "weekdays", "15"]) {
      const rule = parseRecurrence(when)!;
      expect(decodeRule(encodeRule(rule))).toEqual(rule);
    }
    expect(encodeRule({ kind: "weekly", weekdays: [1, 4] })).toBe("weekly:1,4");
    expect(decodeRule("weekly:8")).toBeNull();
    expect(decodeRule("monthly:32")).toBeNull();
    expect(decodeRule("whenever")).toBeNull();
  });

  it("describes a rule in plain words", () => {
    expect(describeRule({ kind: "daily" })).toBe("every day");
    expect(describeRule({ kind: "weekly", weekdays: [1] })).toBe("every Mon");
    expect(describeRule({ kind: "weekly", weekdays: [1, 3, 5] })).toBe(
      "every Mon, Wed and Fri",
    );
    expect(describeRule({ kind: "weekly", weekdays: [1, 2, 3, 4, 5] })).toBe(
      "every weekday",
    );
    expect(describeRule({ kind: "monthly", day: 1 })).toBe(
      "on the 1st of each month",
    );
    expect(describeRule({ kind: "monthly", day: 22 })).toBe(
      "on the 22nd of each month",
    );
    expect(describeRule({ kind: "monthly", day: 13 })).toBe(
      "on the 13th of each month",
    );
  });

  it("knows which days an item is due", () => {
    // 16 November 2026 is a Monday.
    const monday: RecurrenceRule = { kind: "weekly", weekdays: [1] };
    expect(isDueOn(monday, "2026-11-16")).toBe(true);
    expect(isDueOn(monday, "2026-11-17")).toBe(false);
    expect(isDueOn({ kind: "daily" }, "2026-11-17")).toBe(true);
    expect(isDueOn({ kind: "monthly", day: 1 }, "2026-12-01")).toBe(true);
    expect(isDueOn({ kind: "monthly", day: 1 }, "2026-12-02")).toBe(false);
  });

  it("moves the 31st to the last day of a shorter month", () => {
    const last: RecurrenceRule = { kind: "monthly", day: 31 };
    expect(isDueOn(last, "2026-11-30")).toBe(true);
    expect(isDueOn(last, "2027-02-28")).toBe(true);
    expect(isDueOn(last, "2026-12-30")).toBe(false);
    expect(isDueOn(last, "2026-12-31")).toBe(true);
  });

  it("lists items to stop without showing ids", () => {
    const [[button]] = recurringKeyboard([
      { id: 2_147_483_647, description: "x".repeat(80) },
    ]).inline_keyboard;
    expect(button.text).toHaveLength(48);
    expect(button.text.startsWith("Stop: ")).toBe(true);
    expect(button.callback_data).toBe("rep:ask:2147483647");
  });
});

describe("nightly check-in buttons", () => {
  it("has no buttons when nothing was saved", () => {
    expect(carryoverKeyboard([])).toBeUndefined();
  });

  it("gives one button for a single item, with no Move all", () => {
    expect(
      carryoverKeyboard([{ id: 5, description: "laundry" }])?.inline_keyboard,
    ).toEqual([[{ text: "➡️ laundry", callback_data: "todo:carry:5" }]]);
  });

  it("adds Move all for several items and keeps within Telegram's limits", () => {
    const rows = carryoverKeyboard([
      { id: 5, description: "laundry" },
      { id: 2_147_483_647, description: "y".repeat(80) },
    ])!.inline_keyboard;
    expect(rows).toHaveLength(3);
    expect(rows[1][0].text).toHaveLength(48);
    expect(rows[2][0]).toEqual({
      text: "Move all to tomorrow",
      callback_data: "todo:carry:all",
    });
    for (const [button] of rows) {
      expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
  });
});
