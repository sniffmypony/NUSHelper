import { describe, expect, it, vi } from "vitest";
import {
  USER_TEXT_FIELDS,
  keepUserSpelling,
  restoreUserSpelling,
} from "../src/assistant/user-spelling.js";

const fix = (written: string, user: string) =>
  restoreUserSpelling(written, user).text;

describe("keeping names as the user typed them", () => {
  it("puts back a name the assistant misspelled, keeping its capital", () => {
    expect(
      restoreUserSpelling(
        "Ask Igy about the poll",
        "remind me to ask iggy abt poll in an hr",
      ),
    ).toEqual({ text: "Ask Iggy about the poll", fixes: [["Igy", "Iggy"]] });
  });

  it("lets ordinary words be tidied", () => {
    // "about" for "abt" and the added "the" stay: lowercase words aren't checked.
    expect(fix("Ask Iggy about the poll", "ask iggy abt poll")).toBe(
      "Ask Iggy about the poll",
    );
    expect(fix("Ask Iggy About the Poll", "ask iggy abt poll")).toBe(
      "Ask Iggy About the Poll",
    );
  });

  it("leaves correct names, the first word, module codes and dates alone", () => {
    expect(fix("Call Mum", "remind me to call mum at 5")).toBe("Call Mum");
    expect(fix("Igy said hi", "iggy said hi")).toBe("Igy said hi");
    expect(fix("Finish CS2102 tutorial", "finish cs2102 tut")).toBe(
      "Finish CS2102 tutorial",
    );
    expect(fix("Pay rent on 1 December", "pay rent on the 1st")).toBe(
      "Pay rent on 1 December",
    );
  });

  it("fixes two-letter slips only in longer names", () => {
    expect(fix("Meet Jonathon", "meet jonathan tmr")).toBe("Meet Jonathan");
    // "Bob" -> "Bill" is not a slip: too far apart.
    expect(fix("Text Bill", "text bob")).toBe("Text Bill");
    // Different first letter: not treated as the same word.
    expect(fix("Text Kate", "text cate")).toBe("Text Kate");
  });

  it("doesn't guess between two equally close words", () => {
    expect(fix("Ask Ana", "ask ann and anna")).toBe("Ask Ana");
  });
});

describe("tool arguments", () => {
  it("covers the five tools that save the user's text", () => {
    expect(USER_TEXT_FIELDS).toEqual({
      add_task: "description",
      add_todo: "description",
      set_reminder: "description",
      add_repeating: "description",
      create_calendar_event: "title",
    });
  });

  it("rewrites only the saved text field, and logs no names", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const user = "remind me to ask iggy abt poll in an hr";
    expect(
      JSON.parse(
        keepUserSpelling(
          "set_reminder",
          '{"time":"2011","description":"Ask Igy about the poll"}',
          user,
        ),
      ),
    ).toEqual({ time: "2011", description: "Ask Iggy about the poll" });
    expect(
      JSON.parse(
        keepUserSpelling(
          "create_calendar_event",
          '{"title":"Lunch with Igy","date":"25-11-2026","all_day":true}',
          "lunch with iggy on 25 nov",
        ),
      ).title,
    ).toBe("Lunch with Iggy");
    expect(log).toHaveBeenCalledWith(
      "Restored the user's spelling of 1 word in set_reminder",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("Igy");
    log.mockRestore();
  });

  it("passes other tools, bad JSON and photos without a caption through", () => {
    const args = '{"query":"Igy"}';
    expect(keepUserSpelling("search_files", args, "iggy")).toBe(args);
    expect(keepUserSpelling("add_todo", "{not json", "iggy")).toBe("{not json");
    const todo = '{"description":"Ask Igy"}';
    expect(keepUserSpelling("add_todo", todo, "")).toBe(todo);
    expect(keepUserSpelling("add_todo", todo, "ask iggy")).toBe(
      '{"description":"Ask Iggy"}',
    );
  });
});
