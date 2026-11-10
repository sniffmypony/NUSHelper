import { afterEach, describe, expect, it } from "vitest";
import { systemPrompt } from "../src/assistant/agent.js";
import { toolsFor } from "../src/assistant/tools.js";
import { isCanvasConfigured } from "../src/env.js";

const saved = {
  token: process.env.CANVAS_API_TOKEN,
  url: process.env.CANVAS_BASE_URL,
};
afterEach(() => {
  process.env.CANVAS_API_TOKEN = saved.token;
  process.env.CANVAS_BASE_URL = saved.url;
});

const names = (features: { canvas: boolean; calendar: boolean }) =>
  toolsFor(features).map((tool) => tool.function.name);

describe("optional integrations", () => {
  it("offers every tool when everything is set up", () => {
    const all = names({ canvas: true, calendar: true });
    expect(all).toEqual(
      expect.arrayContaining(["search_files", "create_calendar_event"]),
    );
  });

  it("drops Canvas tools without Canvas", () => {
    const tools = names({ canvas: false, calendar: true });
    for (const name of [
      "list_modules",
      "list_upcoming_assignments",
      "search_files",
      "send_files",
    ]) {
      expect(tools).not.toContain(name);
    }
    expect(tools).toContain("create_calendar_event");
    expect(tools).toContain("add_task");
  });

  it("drops calendar tools without Google Calendar", () => {
    const tools = names({ canvas: true, calendar: false });
    for (const name of [
      "create_calendar_event",
      "list_calendar_events",
      "delete_calendar_event",
    ]) {
      expect(tools).not.toContain(name);
    }
    expect(tools).toContain("search_files");
  });

  it("tells the model which integrations are not set up", () => {
    const now = new Date("2026-11-10T12:00:00+08:00");
    const prompt = systemPrompt(now, { canvas: false, calendar: false });
    expect(prompt).toContain(
      "Not set up on this bot: Canvas and Google Calendar.",
    );
    expect(prompt).not.toContain("- Canvas:");
    expect(systemPrompt(now)).not.toContain("Not set up on this bot");
  });

  it("needs both Canvas settings", () => {
    process.env.CANVAS_API_TOKEN = "token";
    delete process.env.CANVAS_BASE_URL;
    expect(isCanvasConfigured()).toBe(false);
    process.env.CANVAS_BASE_URL = "https://canvas.example.edu";
    expect(isCanvasConfigured()).toBe(true);
  });
});
