import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));

import { examEventId } from "../src/nus/exams.js";
import {
  classesOn,
  findShareLink,
  importTimetable,
  parseClassesCommand,
  type FetchLike,
  type NewLesson,
  type TimetableStore,
} from "../src/nus/timetable.js";

const LINK =
  "https://nusmods.com/timetable/sem-1/share?CFG1002=&CS2040S=LAB:06,LEC:1&CS2102=TUT:02,LEC:1&ES2660=SEC:G19&HSI1000=WS:D4,LEC:1&RVN2001=SEC:G1&ST2334=TUT:18,LEC:1";
// Friday of reading week, AY26/27 semester 1.
const NOW = new Date("2026-11-20T04:00:00Z");

// Serves the AY2026/27 NUSMods module files saved in tests/fixtures.
const fetchFixture: FetchLike = async (url) => {
  const match = /\/v2\/(\d{4}-\d{4})\/modules\/([A-Z0-9]+)\.json$/.exec(url);
  let body: unknown = null;
  if (match?.[1] === "2026-2027") {
    try {
      body = JSON.parse(
        readFileSync(
          new URL(`./fixtures/nusmods/${match[2]}.json`, import.meta.url),
          "utf8",
        ),
      );
    } catch {
      body = null;
    }
  }
  return {
    ok: body !== null,
    status: body === null ? 404 : 200,
    headers: { get: () => null },
    json: async () => body,
  };
};

function memoryStore(): TimetableStore & { rows: NewLesson[] } {
  const store = {
    rows: [] as NewLesson[],
    async replaceAll(lessons: NewLesson[]) {
      store.rows = [...lessons];
    },
    async clear() {
      store.rows = [];
    },
    async all() {
      return [...store.rows];
    },
    async forDay(acadYear: string, semester: number, day: number) {
      return store.rows.filter(
        (row) =>
          row.acadYear === acadYear &&
          row.semester === semester &&
          row.day === day,
      );
    },
  };
  return store;
}

function fakeCalendar() {
  return {
    putEvent: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue("deleted" as const),
  };
}

describe("saving a timetable puts the finals on Google Calendar", () => {
  it("lists the finals and adds one event per final", async () => {
    const store = memoryStore();
    const calendar = fakeCalendar();
    const reply = await importTimetable(
      LINK,
      NOW,
      store,
      fetchFixture,
      async () => calendar,
    );

    expect(reply).toContain("Saved your Semester 1 timetable (AY2026/2027)");
    expect(reply).not.toContain("No classes found for");
    expect(reply).toContain(
      [
        "Finals:",
        "HSI1000 Mon 23 Nov, 09:00–10:00",
        "ST2334 Mon 23 Nov, 17:00–19:00",
        "CS2040S Tue 24 Nov, 09:00–11:00",
        "CS2102 Sat 28 Nov, 13:00–15:00",
      ].join("\n"),
    );
    expect(reply).toContain(
      "📅 4 finals on Google Calendar: CS2040S, CS2102, HSI1000, ST2334",
    );
    expect(store.rows).toHaveLength(12);

    expect(calendar.putEvent).toHaveBeenCalledTimes(4);
    expect(calendar.putEvent).toHaveBeenCalledWith(
      examEventId("2026-2027", 1, "CS2102"),
      expect.objectContaining({
        title: "📝 Final: CS2102 Database Systems",
        startDateTime: "2026-11-28T13:00:00+08:00",
        endDateTime: "2026-11-28T15:00:00+08:00",
      }),
    );
  });

  it("updates the same events when the link is sent again, and removes dropped modules' finals", async () => {
    const store = memoryStore();
    const calendar = fakeCalendar();
    const save = (link: string) =>
      importTimetable(link, NOW, store, fetchFixture, async () => calendar);

    await save(LINK);
    const firstIds = calendar.putEvent.mock.calls.map((call) => call[0]);
    calendar.putEvent.mockClear();

    const reply = await save(LINK.replace("&CS2102=TUT:02,LEC:1", ""));
    expect(calendar.putEvent.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(
        firstIds.filter((id) => id !== examEventId("2026-2027", 1, "CS2102")),
      ),
    );
    expect(calendar.delete).toHaveBeenCalledWith(
      examEventId("2026-2027", 1, "CS2102"),
    );
    expect(reply).toContain("🗑 Removed the finals of dropped modules: CS2102");
  });

  it("still saves the timetable when Google Calendar fails or isn't set up", async () => {
    const store = memoryStore();
    const failing = await importTimetable(LINK, NOW, store, fetchFixture, () =>
      Promise.reject(new Error("no auth")),
    );
    expect(failing).toContain("I couldn't reach Google Calendar");
    expect(store.rows).toHaveLength(12);

    const withoutCalendar = await importTimetable(
      LINK,
      NOW,
      memoryStore(),
      fetchFixture,
      null,
    );
    expect(withoutCalendar).toContain("Finals:");
    expect(withoutCalendar).not.toContain("Google Calendar");
  });

  it("uses a stable, valid Google event id per year, semester and module", () => {
    const id = examEventId("2026-2027", 1, "CS2102");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(examEventId("2026-2027", 2, "CS2102")).not.toBe(id);
  });
});

describe("/classes", () => {
  async function saved() {
    const store = memoryStore();
    await importTimetable(LINK, NOW, store, fetchFixture, null);
    return store;
  }

  it("shows the right venue in odd and even weeks", async () => {
    const store = await saved();
    // HSI1000 WS D4 is in S16-0208 in weeks 3, 7, 11 and S12-0402 in 4, 8.
    expect(await classesOn("2026-08-25", store)).toBe(
      "Tue 25 Aug 2026 · S1W3, AY 26/27\n• 09:00–12:00 HSI1000 Workshop — S16-0208",
    );
    expect(await classesOn("2026-09-01", store)).toBe(
      "Tue 1 Sep 2026 · S1W4, AY 26/27\n• 09:00–12:00 HSI1000 Workshop — S12-0402",
    );
    expect(await classesOn("2026-09-08", store)).toBe(
      "Tue 8 Sep 2026 · S1W5, AY 26/27\nNo classes.",
    );
  });

  it("leaves out classes that start in a later week", async () => {
    const store = await saved();
    // Week 1: CS2102 TUT (weeks 3-13) and ES2660 (weeks 2-13) not yet.
    expect(await classesOn("2026-08-13", store)).toBe(
      [
        "Thu 13 Aug 2026 · S1W1, AY 26/27",
        "• 10:00–12:00 CS2040S Lecture — LT9",
        "• 16:00–18:00 HSI1000 Lecture — E-Learn_B",
      ].join("\n"),
    );
  });

  it("has no classes outside teaching weeks, and says when the timetable is for another semester", async () => {
    const store = await saved();
    expect(await classesOn("2026-09-21", store)).toBe(
      "Mon 21 Sep 2026 · S1 Recess Week, AY 26/27\nNo classes (Recess Week).",
    );
    expect(await classesOn("2026-11-23", store)).toBe(
      "Mon 23 Nov 2026 · S1 Exam Week 1, AY 26/27\nNo classes (Exam Week 1).",
    );
    expect(await classesOn("2027-01-11", store)).toContain(
      "Your saved timetable is for Semester 1, AY2026/2027.",
    );
    expect(await classesOn("2026-08-25", memoryStore())).toContain(
      "No timetable is saved.",
    );
  });

  it("accepts today, tomorrow, weekdays and dates", () => {
    // 2026-11-20 is a Friday.
    const parse = (text: string) => parseClassesCommand(text, "2026-11-20");
    expect(parse("/classes")).toBe("2026-11-20");
    expect(parse("/classes tomorrow")).toBe("2026-11-21");
    expect(parse("/classes fri")).toBe("2026-11-20");
    expect(parse("/classes Monday")).toBe("2026-11-23");
    expect(parse("/classes 25-08-2026")).toBe("2026-08-25");
    expect(parse("/classes someday")).toBeNull();
    expect(parse("/classes 31-02-2027")).toBeNull();
  });
});

describe("share links in a message", () => {
  it("finds full and short NUSMods links inside text", () => {
    expect(findShareLink(`update my timetable ${LINK} thanks`)).toBe(LINK);
    expect(findShareLink("https://shorten.nusmods.com/abc12 pls")).toBe(
      "https://shorten.nusmods.com/abc12",
    );
    expect(findShareLink("check nusmods.com later")).toBeNull();
  });
});
