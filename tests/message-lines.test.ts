import { describe, expect, it } from "vitest";
import {
  parseReminderCommandLine,
  parseTodoCommandLine,
  splitMessageLines,
} from "../src/message-lines.js";

describe("multi-line Telegram messages", () => {
  it("keeps physical line numbers while ignoring blank lines", () => {
    expect(
      splitMessageLines(
        "/todo project\r\n/todo homework\n\n12-1, Meeting, 01-10-2026",
      ),
    ).toEqual([
      { lineNumber: 1, sourceLine: 0, text: "/todo project" },
      { lineNumber: 2, sourceLine: 1, text: "/todo homework" },
      {
        lineNumber: 4,
        sourceLine: 3,
        text: "12-1, Meeting, 01-10-2026",
      },
    ]);
  });

  it("accepts strict same-day reminder commands", () => {
    expect(parseReminderCommandLine("/remind 1800 do tutorial")).toEqual({
      hour: 18,
      minute: 0,
      description: "do tutorial",
    });
    expect(
      parseReminderCommandLine("/remind@NUSHelperBot 0000 medicine"),
    ).toEqual({ hour: 0, minute: 0, description: "medicine" });
    expect(parseReminderCommandLine("/remind 2400 nope")).toBeNull();
    expect(parseReminderCommandLine("/remind 1260 nope")).toBeNull();
    expect(parseReminderCommandLine("/remind 1800")).toBeNull();
    expect(parseReminderCommandLine("/remind 180 do tutorial")).toBeNull();
  });

  it("accepts exact todo commands and rejects malformed command lines", () => {
    expect(parseTodoCommandLine("/todo project")).toBe("project");
    expect(parseTodoCommandLine("/todo@NUSHelperBot medicine")).toBe(
      "medicine",
    );
    expect(parseTodoCommandLine("/todo_random")).toBeNull();
    expect(parseTodoCommandLine("/todo  adsajs adjas")).toBeNull();
    expect(parseTodoCommandLine("/todo ")).toBeNull();
  });

  it("continues to a valid todo after invalid earlier lines", () => {
    const accepted = splitMessageLines(
      "/todo_random\n/todo  adsajs adjas\n/todo medicine",
    )
      .map((line) => parseTodoCommandLine(line.text))
      .filter((value): value is string => value !== null);

    expect(accepted).toEqual(["medicine"]);
  });
});
