import { CalendarPlus, MapPin } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Category } from "../components/category";
import { ICON } from "../components/icons";
import { Empty, PageHeader, errorText } from "../components/page";
import { TimetableLink } from "../components/TimetableLink";
import { Button, Card, Notice } from "../components/ui";

interface Lesson {
  moduleCode: string;
  lessonType: string;
  classNo: string;
  day: number;
  start: string; // HH:mm
  end: string;
  venue: string;
}

interface Final {
  moduleCode: string;
  title: string;
  start: string;
  durationMinutes: number;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Each module gets a colour in this fixed order (sorted by module code), so
// a module keeps its colour across visits.
const MODULE_COLOURS: Category[] = [
  "class",
  "event",
  "task",
  "exam",
  "reminder",
  "spend",
  "deadline",
];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function WeekGrid({
  lessons,
  colour,
}: {
  lessons: Lesson[];
  colour: (moduleCode: string) => Category;
}) {
  const days = [
    1,
    2,
    3,
    4,
    5,
    ...[6, 7].filter((d) => lessons.some((l) => l.day === d)),
  ];
  const first = Math.min(
    8 * 60,
    ...lessons.map((l) => Math.floor(minutes(l.start) / 60) * 60),
  );
  const last = Math.max(
    18 * 60,
    ...lessons.map((l) => Math.ceil(minutes(l.end) / 60) * 60),
  );
  const hours = Array.from(
    { length: (last - first) / 60 },
    (_, i) => first / 60 + i,
  );
  const span = last - first;
  const height = hours.length * 48;

  return (
    <div className="flex">
      <div className="w-12 shrink-0 pt-9 text-right text-[11px] tabular-nums text-faint">
        {hours.map((hour) => (
          <div
            key={hour}
            style={{ height: 48 }}
            className="-translate-y-1.5 pr-2"
          >
            {String(hour).padStart(2, "0")}:00
          </div>
        ))}
      </div>
      <div
        className="grid min-w-0 flex-1"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {days.map((day) => (
          <div key={day} className="min-w-0 border-l border-line">
            <div className="flex h-9 items-center justify-center border-b border-line bg-brand-soft text-xs font-semibold uppercase tracking-wide text-brand-text">
              {DAY_NAMES[day - 1]}
            </div>
            <div className="relative" style={{ height }}>
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className={`absolute inset-x-0 border-t ${index === 0 ? "border-transparent" : "border-line"}`}
                  style={{ top: index * 48 }}
                />
              ))}
              {lessons
                .filter((lesson) => lesson.day === day)
                .map((lesson, index) => (
                  <div
                    key={index}
                    className={`pill pill-${colour(lesson.moduleCode)} absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight`}
                    style={{
                      top: `${((minutes(lesson.start) - first) / span) * 100}%`,
                      height: `calc(${((minutes(lesson.end) - minutes(lesson.start)) / span) * 100}% - 2px)`,
                    }}
                    title={`${lesson.moduleCode} ${lesson.lessonType} ${lesson.classNo} · ${lesson.start}–${lesson.end}${lesson.venue ? ` · ${lesson.venue}` : ""}`}
                  >
                    <p className="truncate font-semibold">
                      {lesson.moduleCode}
                    </p>
                    <p className="truncate">{lesson.lessonType}</p>
                    {lesson.venue && (
                      <p className="truncate text-muted">{lesson.venue}</p>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// On a phone: the same lessons as a list per day.
function DayList({
  lessons,
  colour,
}: {
  lessons: Lesson[];
  colour: (moduleCode: string) => Category;
}) {
  const days = [...new Set(lessons.map((l) => l.day))].sort();
  return (
    <div className="divide-y divide-line">
      {days.map((day) => (
        <div key={day} className="px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-text">
            {DAY_NAMES[day - 1]}
          </p>
          <ul className="space-y-1.5">
            {lessons
              .filter((lesson) => lesson.day === day)
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((lesson, index) => (
                <li
                  key={index}
                  className={`pill pill-${colour(lesson.moduleCode)} flex items-baseline gap-3 rounded-lg px-3 py-2 text-sm`}
                >
                  <span className="w-24 shrink-0 font-semibold tabular-nums">
                    {lesson.start}–{lesson.end}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {lesson.moduleCode} {lesson.lessonType}
                    </span>
                    {lesson.venue && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
                        <MapPin {...ICON} size={12} />
                        {lesson.venue}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Finals({ colour }: { colour: (moduleCode: string) => Category }) {
  const [finals, setFinals] = useState<Final[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    api<{ finals: Final[] }>("timetable/finals")
      .then((data) => setFinals(data.finals))
      .catch((failure) => setError(errorText(failure)));
  }, []);

  return (
    <Card
      title="Finals"
      description="From NUSMods. Venues are on the NUS exam timetable."
    >
      <div className="space-y-3 px-5 py-4">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : finals === null ? (
          <p className="text-sm text-faint">Asking NUSMods…</p>
        ) : finals.length === 0 ? (
          <Empty>No finals listed for this semester.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {finals.map((final) => {
              const start = new Date(final.start);
              const daysLeft = Math.ceil(
                (start.getTime() - Date.now()) / 86_400_000,
              );
              return (
                <li
                  key={final.moduleCode}
                  className={`pill pill-${colour(final.moduleCode)} animate-settle rounded-lg px-3 py-2 text-sm`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{final.moduleCode}</span>
                    <span className="text-xs text-muted">
                      {daysLeft > 1
                        ? `in ${daysLeft} days`
                        : daysLeft === 1
                          ? "tomorrow"
                          : daysLeft === 0
                            ? "today"
                            : "done"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted">{final.title}</p>
                  <p className="mt-0.5 text-xs font-medium tabular-nums">
                    {start.toLocaleString("en-SG", {
                      timeZone: "Asia/Singapore",
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}{" "}
                    · {final.durationMinutes / 60} h
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <Button
          variant="secondary"
          disabled={busy || !finals || finals.length === 0}
          onClick={async () => {
            setBusy(true);
            setStatus(null);
            try {
              const result = await api<{ message: string }>(
                "timetable/finals/sync",
                {
                  method: "POST",
                },
              );
              setStatus({ tone: "ok", text: result.message });
            } catch (failure) {
              setStatus({ tone: "error", text: errorText(failure) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <CalendarPlus {...ICON} />
          {busy ? "Adding…" : "Re-add finals to Google Calendar"}
        </Button>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Card>
  );
}

export function TimetablePage() {
  const [data, setData] = useState<{
    label: string | null;
    lessons: Lesson[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ label: string | null; lessons: Lesson[] }>("timetable/week")
      .then((view) => {
        setData(view);
        setError(null);
      })
      .catch((failure) => setError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  const modules = [
    ...new Set((data?.lessons ?? []).map((l) => l.moduleCode)),
  ].sort();
  const colour = (moduleCode: string): Category =>
    MODULE_COLOURS[
      Math.max(0, modules.indexOf(moduleCode)) % MODULE_COLOURS.length
    ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description={data?.label ?? "Your NUSMods classes and finals."}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card
          title="This week's classes"
          description="Classes run in teaching weeks 1–13 only."
        >
          {!data ? (
            <p className="px-5 py-4 text-sm text-faint">Loading…</p>
          ) : data.lessons.length === 0 ? (
            <div className="px-5 py-4">
              <Empty>No timetable saved. Paste your NUSMods link below.</Empty>
            </div>
          ) : (
            <>
              <div className="hidden p-4 md:block">
                <WeekGrid lessons={data.lessons} colour={colour} />
              </div>
              <div className="md:hidden">
                <DayList lessons={data.lessons} colour={colour} />
              </div>
            </>
          )}
        </Card>
        <div className="space-y-6">
          {data && data.lessons.length > 0 && <Finals colour={colour} />}
        </div>
      </div>
      <TimetableLink onSaved={load} />
    </div>
  );
}
