import { CalendarPlus, GraduationCap, MapPin, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { CATEGORY, type Category } from "../components/category";
import { ICON } from "../components/icons";
import {
  Empty,
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  Skeleton,
  errorText,
  useLoad,
} from "../components/page";
import { TimetableLink } from "../components/TimetableLink";
import { Badge, Button, Notice, Panel } from "../components/ui";
import { clockOf, fromIso, minutesOf, nowMinutes, todayIso } from "../dates";

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
const DAY_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
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
const HOUR = 52;

// Monday = 1 … Sunday = 7, in Singapore.
const todayWeekday = () => ((fromIso(todayIso()).getUTCDay() + 6) % 7) + 1;

function useMinute(): number {
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function WeekGrid({
  lessons,
  colour,
}: {
  lessons: Lesson[];
  colour: (moduleCode: string) => Category;
}) {
  const now = useMinute();
  const today = todayWeekday();
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
    ...lessons.map((l) => Math.floor(minutesOf(l.start) / 60) * 60),
  );
  const last = Math.max(
    18 * 60,
    ...lessons.map((l) => Math.ceil(minutesOf(l.end) / 60) * 60),
  );
  const hours = Array.from(
    { length: (last - first) / 60 },
    (_, i) => first / 60 + i,
  );
  const span = last - first;
  const height = hours.length * HOUR;
  const showNow = days.includes(today) && now >= first && now <= last;

  return (
    <div className="flex">
      <div
        aria-hidden
        className="tnum w-12 shrink-0 pt-10 text-right text-[11px] text-faint"
      >
        {hours.map((hour) => (
          <div
            key={hour}
            style={{ height: HOUR }}
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
        {days.map((day) => {
          const isToday = day === today;
          return (
            <div key={day} className="min-w-0 border-l border-line">
              <div
                className={`flex h-10 items-center justify-center gap-1.5 border-b border-line text-xs font-semibold tracking-[0.06em] uppercase ${isToday ? "text-ink" : "text-muted"}`}
              >
                {DAY_NAMES[day - 1]}
                {isToday && (
                  <span className="rounded bg-now px-1 py-px text-[10px] tracking-normal text-on-now normal-case">
                    Today
                  </span>
                )}
              </div>
              <div
                className={`relative ${isToday ? "bg-now-soft/40" : ""}`}
                style={{ height }}
              >
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className={`absolute inset-x-0 border-t ${index === 0 ? "border-transparent" : "border-line"}`}
                    style={{ top: index * HOUR }}
                  />
                ))}
                {lessons
                  .filter((lesson) => lesson.day === day)
                  .map((lesson, index) => {
                    const past = isToday && minutesOf(lesson.end) <= now;
                    return (
                      <div
                        key={index}
                        className={`tint ${CATEGORY[colour(lesson.moduleCode)].tint} absolute inset-x-1 overflow-hidden rounded-md px-2 py-1.5 text-[11px] leading-tight ${past ? "opacity-55" : ""}`}
                        style={{
                          top: `${((minutesOf(lesson.start) - first) / span) * 100}%`,
                          height: `calc(${((minutesOf(lesson.end) - minutesOf(lesson.start)) / span) * 100}% - 3px)`,
                        }}
                        title={`${lesson.moduleCode} ${lesson.lessonType} ${lesson.classNo} · ${lesson.start}–${lesson.end}${lesson.venue ? ` · ${lesson.venue}` : ""}`}
                      >
                        <p className="truncate text-xs font-semibold">
                          {lesson.moduleCode}
                        </p>
                        <p className="truncate">{lesson.lessonType}</p>
                        {lesson.venue && (
                          <p className="truncate text-muted">{lesson.venue}</p>
                        )}
                      </div>
                    );
                  })}
                {isToday && showNow && (
                  <div
                    aria-label={`Now, ${clockOf(now)}`}
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: `${((now - first) / span) * 100}%` }}
                  >
                    <span className="-ml-1 h-2 w-2 rounded-full bg-now" />
                    <span className="h-0.5 flex-1 bg-now" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// On a phone: the same lessons as a list per day, today first marked.
function DayList({
  lessons,
  colour,
}: {
  lessons: Lesson[];
  colour: (moduleCode: string) => Category;
}) {
  const now = useMinute();
  const today = todayWeekday();
  const days = [...new Set(lessons.map((l) => l.day))].sort();
  return (
    <div className="divide-y divide-line">
      {days.map((day) => (
        <section
          key={day}
          aria-label={DAY_LONG[day - 1]}
          className={`px-4 py-3 ${day === today ? "bg-now-soft/40" : ""}`}
        >
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
            {DAY_LONG[day - 1]}
            {day === today && <Badge tone="now">Today</Badge>}
          </h3>
          <ul className="space-y-1.5">
            {lessons
              .filter((lesson) => lesson.day === day)
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((lesson, index) => {
                const past = day === today && minutesOf(lesson.end) <= now;
                const current =
                  day === today &&
                  minutesOf(lesson.start) <= now &&
                  now < minutesOf(lesson.end);
                return (
                  <li
                    key={index}
                    className={`tint ${CATEGORY[colour(lesson.moduleCode)].tint} flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${past ? "opacity-55" : ""}`}
                  >
                    <span className="tnum w-[5.5rem] shrink-0 font-semibold">
                      {lesson.start}–{lesson.end}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {lesson.moduleCode} {lesson.lessonType}
                        {current && (
                          <Badge tone="now" className="ml-2 align-middle">
                            Now
                          </Badge>
                        )}
                      </span>
                      {lesson.venue && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-muted">
                          <MapPin {...ICON} size={12} />
                          {lesson.venue}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
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
    <Panel
      title="Finals"
      description="From NUSMods. Venues are on the NUS exam timetable."
    >
      <div className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : finals === null ? (
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
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
                  className={`tint ${CATEGORY[colour(final.moduleCode)].tint} rounded-lg px-3 py-2.5 text-sm ${daysLeft < 0 ? "opacity-55" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <PenLine {...ICON} size={14} />
                      {final.moduleCode}
                    </span>
                    {daysLeft >= 0 && daysLeft <= 3 ? (
                      <Badge tone="now">
                        {daysLeft === 0
                          ? "Today"
                          : daysLeft === 1
                            ? "Tomorrow"
                            : `In ${daysLeft} days`}
                      </Badge>
                    ) : (
                      <span className="tnum text-[13px] text-muted">
                        {daysLeft > 1 ? `in ${daysLeft} days` : "Done"}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[13px] text-muted">
                    {final.title}
                  </p>
                  <p className="tnum mt-0.5 text-[13px] font-medium">
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
          className="w-full"
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
    </Panel>
  );
}

export function TimetablePage() {
  const { data, error, reload } = useLoad(
    () => api<{ label: string | null; lessons: Lesson[] }>("timetable/week"),
    [],
  );

  const modules = [
    ...new Set((data?.lessons ?? []).map((l) => l.moduleCode)),
  ].sort();
  const colour = (moduleCode: string): Category =>
    MODULE_COLOURS[
      Math.max(0, modules.indexOf(moduleCode)) % MODULE_COLOURS.length
    ];

  if (error && !data) return <LoadError message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton label="Loading your timetable" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description={data.label ?? "Your NUSMods classes and finals."}
      />
      {data.lessons.length === 0 ? (
        <Panel>
          <EmptyState icon={GraduationCap} title="No timetable saved">
            Paste your NUSMods share link below to see your week and finals.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel
            title="This week's classes"
            description="Classes run in teaching weeks 1–13 only."
          >
            <div className="hidden border-t border-line p-4 md:block">
              <WeekGrid lessons={data.lessons} colour={colour} />
            </div>
            <div className="border-t border-line md:hidden">
              <DayList lessons={data.lessons} colour={colour} />
            </div>
          </Panel>
          <Finals colour={colour} />
        </div>
      )}
      <TimetableLink onSaved={reload} />
    </div>
  );
}
