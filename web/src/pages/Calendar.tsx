import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { FeatureOff } from "../components/FeatureOff";
import { useFeatures } from "../features";
import { isExam } from "../components/category";
import { ICON } from "../components/icons";
import { Accordion, Shake } from "../components/motion";
import { Button, Input, Notice } from "../components/ui";
import {
  addDays,
  formatDay,
  formatMoney,
  fromIso,
  monthGrid,
  todayIso,
} from "../dates";

export interface CalendarDay {
  week: string;
  spending: { cents: number; status: string } | null;
  events: Array<{
    id: string;
    title: string;
    allDay: boolean;
    start: string | null;
    end: string | null;
    url: string | null;
  }>;
  reminders: Array<{
    id: number;
    description: string;
    time: string;
    status: string;
    eventId: string | null;
  }>;
  tasks: Array<{ id: number; description: string; module: string | null }>;
  deadlines: Array<{
    moduleCode: string;
    name: string;
    time: string;
    url: string | null;
  }>;
  classes: Array<{
    moduleCode: string;
    lessonType: string;
    start: string;
    end: string;
    venue: string;
  }>;
}

export interface CalendarRange {
  days: Record<string, CalendarDay>;
  eventsError: string | null;
}

type Status = { tone: "ok" | "error"; text: string } | null;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REPEATS = ["", "daily", "weekdays", "weekly", "monthly", "yearly"];
// "Remind me" choices, in minutes before the event (all-day events: 9am).
const TIMED_OFFSETS: Array<[number, string]> = [
  [0, "When it starts"],
  [10, "10 min before"],
  [30, "30 min before"],
  [60, "1 hour before"],
  [1440, "1 day before"],
];
const ALL_DAY_OFFSETS: Array<[number, string]> = [
  [0, "9am on the day"],
  [1440, "9am the day before"],
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// "Y2S1W12, AY 26/27" -> "S1W12"; "Y2S1 Reading Week, AY 26/27" -> "Reading"
function shortWeek(label: string): string {
  const head = label.split(",")[0].replace(/^Y\d+/, "");
  const named = /\s(\w+)/.exec(head);
  return named ? named[1] : head;
}

function Dot({ className }: { className: string }) {
  return (
    <span className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} />
  );
}

function DayCell({
  date,
  day,
  inMonth,
  selected,
  today,
  onPick,
}: {
  date: string;
  day: CalendarDay | undefined;
  inMonth: boolean;
  selected: boolean;
  today: boolean;
  onPick: () => void;
}) {
  const isMonday = fromIso(date).getUTCDay() === 1;
  // Each item is a pill in its category's colour (styles.css).
  const items = day
    ? [
        ...day.deadlines.map((d) => ({
          text: `${d.moduleCode} due`,
          pill: "pill-deadline",
        })),
        ...day.events.map((e) => ({
          text: e.allDay || !e.start ? e.title : `${e.start} ${e.title}`,
          pill: isExam(e.title) ? "pill-exam" : "pill-event",
        })),
        ...day.reminders.map((r) => ({
          text: `${r.time} ${r.description}`,
          pill: "pill-reminder",
        })),
        ...day.tasks.map((t) => ({ text: t.description, pill: "pill-task" })),
      ]
    : [];
  const exams = day?.events.some((e) => isExam(e.title)) ?? false;
  const otherEvents = day?.events.some((e) => !isExam(e.title)) ?? false;
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex min-h-16 flex-col gap-0.5 border-b border-r border-line p-1.5 text-left transition-[background-color] duration-150 ease-out md:min-h-28 md:p-2 ${
        selected
          ? "bg-brand-soft ring-2 ring-inset ring-accent"
          : "hover:bg-hover"
      } ${inMonth ? "" : "bg-sunken text-faint "}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
            today ? "bg-accent text-on-accent" : inMonth ? "text-ink" : ""
          }`}
        >
          {fromIso(date).getUTCDate()}
        </span>
        {isMonday && day && (
          <span className="hidden truncate rounded bg-brand-soft px-1 text-[10px] font-semibold text-brand-text md:inline">
            {shortWeek(day.week)}
          </span>
        )}
      </div>
      {day?.spending && day.spending.cents > 0 && (
        <span className="pill pill-spend w-fit max-w-full truncate rounded px-1 text-[10px] font-semibold md:text-[11px]">
          <span className="hidden md:inline">S$</span>
          {(day.spending.cents / 100).toFixed(2)}
        </span>
      )}
      <div className="hidden flex-col gap-0.5 md:flex">
        {day && day.classes.length > 0 && (
          <span className="pill pill-class truncate rounded px-1 text-[11px]">
            {day.classes.length} class{day.classes.length === 1 ? "" : "es"}
          </span>
        )}
        {items.slice(0, 3).map((item, index) => (
          <span
            key={index}
            className={`pill ${item.pill} truncate rounded px-1 text-[11px]`}
          >
            {item.text}
          </span>
        ))}
        {items.length > 3 && (
          <span className="text-[11px] text-faint">
            +{items.length - 3} more
          </span>
        )}
      </div>
      {day && (
        <div className="mt-auto flex gap-0.5 md:hidden">
          {day.classes.length > 0 && <Dot className="bg-cat-class" />}
          {exams && <Dot className="bg-cat-exam" />}
          {otherEvents && <Dot className="bg-cat-event" />}
          {day.deadlines.length > 0 && <Dot className="bg-cat-deadline" />}
          {day.reminders.length > 0 && <Dot className="bg-cat-reminder" />}
          {day.tasks.length > 0 && <Dot className="bg-cat-task" />}
        </div>
      )}
    </button>
  );
}

// Each part of the day panel opens and closes (an accordion).
function Section({
  title,
  dot,
  children,
}: {
  title: string;
  // The category colour, matching the calendar's pills and dots.
  dot: string;
  children: ReactNode;
}) {
  return (
    <Accordion
      className="border-t border-line px-4 py-3"
      title={
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-text">
          <Dot className={dot} />
          {title}
        </h3>
      }
    >
      <div className="pt-2">{children}</div>
    </Accordion>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

function DayPanel({
  date,
  day,
  onChanged,
}: {
  date: string;
  day: CalendarDay | undefined;
  onChanged: () => void;
}) {
  const { calendar: calendarOn } = useFeatures();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderText, setReminderText] = useState("");
  const [moving, setMoving] = useState<Record<number, string>>({});
  // The event whose "Remind me" picker is open, and the chosen offset.
  const [remindFor, setRemindFor] = useState<{
    id: string;
    offset: number;
  } | null>(null);
  const [event, setEvent] = useState({
    title: "",
    allDay: false,
    start: "09:00",
    end: "10:00",
    repeat: "",
  });

  useEffect(() => {
    setStatus(null);
    setAmount("");
    setMoving({});
    setRemindFor(null);
  }, [date]);

  const run = async (work: () => Promise<{ message?: string }>) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await work();
      setStatus({ tone: "ok", text: result.message ?? "Done." });
      onChanged();
      return true;
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // A refused amount turns the field red and shakes it.
  const [amountRefused, setAmountRefused] = useState(0);
  const [amountInvalid, setAmountInvalid] = useState(false);
  const spend = (mode: "add" | "remove") =>
    run(() =>
      api<{ message: string }>("spending", {
        method: "POST",
        body: { date, amount, mode },
      }),
    ).then((ok) => {
      if (ok) {
        setAmount("");
      } else {
        setAmountInvalid(true);
        setAmountRefused((count) => count + 1);
      }
    });

  return (
    <div className="animate-settle rounded-2xl border border-line bg-surface shadow-card">
      {/* 15 px top corners: the panel's 16 px minus its 1 px border. */}
      <header className="rounded-t-[15px] bg-brand-soft px-4 py-3">
        <h2 className="text-base font-semibold">
          {formatDay(date, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </h2>
        {day && <p className="text-xs text-muted">{day.week}</p>}
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </header>

      <Section title="Spending" dot="bg-cat-spend">
        <p className="text-sm">
          {day?.spending ? (
            <span className="font-semibold">
              {formatMoney(day.spending.cents)}
            </span>
          ) : (
            <span className="text-faint">Nothing logged</span>
          )}
        </p>
        <Shake trigger={amountRefused} className="mt-2 flex gap-2">
          <Input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountInvalid(false);
            }}
            placeholder="e.g. 5.40 3"
            inputMode="decimal"
            invalid={amountInvalid}
            className="min-w-0 flex-1"
          />
          <Button disabled={busy || !amount} onClick={() => void spend("add")}>
            Add
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !amount}
            onClick={() => void spend("remove")}
          >
            Remove
          </Button>
        </Shake>
      </Section>

      <Section title="Classes" dot="bg-cat-class">
        {day && day.classes.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {day.classes.map((c, i) => (
              <li key={i}>
                <span className="font-medium">
                  {c.start}–{c.end}
                </span>{" "}
                {c.moduleCode} {c.lessonType}
                <span className="text-muted"> · {c.venue || "no venue"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No classes</Empty>
        )}
      </Section>

      <Section title="Deadlines" dot="bg-cat-deadline">
        {day && day.deadlines.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {day.deadlines.map((d, i) => (
              <li key={i} className="text-danger">
                {d.time} · {d.moduleCode}:{" "}
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {d.name}
                  </a>
                ) : (
                  d.name
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No deadlines</Empty>
        )}
      </Section>

      <Section title="Events" dot="bg-cat-event">
        {day && day.events.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {day.events.map((e) => (
              <li key={`${e.id}-${e.start}`}>
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">
                      {e.allDay ? "All day" : `${e.start}–${e.end}`}
                    </span>{" "}
                    {e.url ? (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {e.title}
                      </a>
                    ) : (
                      e.title
                    )}
                  </span>
                  <span className="flex shrink-0 gap-2 text-xs">
                    {date >= todayIso() && (
                      <button
                        type="button"
                        className="text-accent-text hover:underline"
                        onClick={() =>
                          setRemindFor(
                            remindFor?.id === e.id
                              ? null
                              : { id: e.id, offset: e.allDay ? 0 : 30 },
                          )
                        }
                      >
                        Remind me
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-danger hover:underline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${e.title}" from Google Calendar? Its reminders are cancelled too.`,
                          )
                        ) {
                          void run(() =>
                            api<{ message: string }>(
                              `events/${encodeURIComponent(e.id)}`,
                              {
                                method: "DELETE",
                              },
                            ),
                          );
                        }
                      }}
                    >
                      Delete
                    </button>
                  </span>
                </div>
                {remindFor?.id === e.id && (
                  <form
                    className="mt-1.5 flex flex-wrap gap-2"
                    onSubmit={(submit) => {
                      submit.preventDefault();
                      void run(() =>
                        api<{ message: string }>(
                          `events/${encodeURIComponent(e.id)}/remind`,
                          {
                            method: "POST",
                            body: { offset: remindFor.offset },
                          },
                        ),
                      ).then((ok) => ok && setRemindFor(null));
                    }}
                  >
                    <select
                      value={remindFor.offset}
                      onChange={(change) =>
                        setRemindFor({
                          id: e.id,
                          offset: Number(change.target.value),
                        })
                      }
                      className="rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm"
                    >
                      {(e.allDay ? ALL_DAY_OFFSETS : TIMED_OFFSETS).map(
                        ([minutes, label]) => (
                          <option key={minutes} value={minutes}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    <Button type="submit" disabled={busy}>
                      Set reminder
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No events</Empty>
        )}
        {calendarOn ? (
          <form
            className="mt-3 space-y-2 rounded-lg bg-sunken p-3"
            onSubmit={(submit) => {
              submit.preventDefault();
              void run(() =>
                api<{ message: string }>("events", {
                  method: "POST",
                  body: { date, ...event },
                }),
              ).then(
                (ok) =>
                  ok && setEvent((current) => ({ ...current, title: "" })),
              );
            }}
          >
            <Input
              value={event.title}
              onChange={(e) => setEvent({ ...event, title: e.target.value })}
              placeholder="New event title"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={event.allDay}
                  onChange={(e) =>
                    setEvent({ ...event, allDay: e.target.checked })
                  }
                />
                All day
              </label>
              {!event.allDay && (
                <>
                  <Input
                    type="time"
                    value={event.start}
                    onChange={(e) =>
                      setEvent({ ...event, start: e.target.value })
                    }
                    className="w-36"
                  />
                  <span>to</span>
                  <Input
                    type="time"
                    value={event.end}
                    onChange={(e) =>
                      setEvent({ ...event, end: e.target.value })
                    }
                    className="w-36"
                  />
                </>
              )}
              <select
                value={event.repeat}
                onChange={(e) => setEvent({ ...event, repeat: e.target.value })}
                className="rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm"
              >
                {REPEATS.map((repeat) => (
                  <option key={repeat} value={repeat}>
                    {repeat ? `Repeats ${repeat}` : "Doesn't repeat"}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={busy || !event.title}>
              Add to Google Calendar
            </Button>
          </form>
        ) : (
          <div className="mt-3">
            <FeatureOff>
              Connect Google Calendar in Settings to add events here.
            </FeatureOff>
          </div>
        )}
      </Section>

      <Section title="Reminders" dot="bg-cat-reminder">
        {day && day.reminders.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {day.reminders.map((r) => (
              <li key={r.id}>
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">{r.time}</span>{" "}
                    {r.description}
                    {r.status !== "pending" && (
                      <span className="ml-1 text-xs text-faint">
                        ({r.status})
                      </span>
                    )}
                    {r.eventId && (
                      <span
                        className="ml-1 text-xs text-faint"
                        title="Moves with its Google Calendar event, and is cancelled if the event is deleted. Moving it here unlinks it."
                      >
                        (follows event)
                      </span>
                    )}
                  </span>
                  {r.status === "pending" && (
                    <span className="flex shrink-0 gap-2 text-xs">
                      <button
                        type="button"
                        className="text-accent-text hover:underline"
                        onClick={() =>
                          setMoving({
                            ...moving,
                            [r.id]: moving[r.id] ?? r.time,
                          })
                        }
                      >
                        Move
                      </button>
                      <button
                        type="button"
                        className="text-danger hover:underline"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api<{ message: string }>(`reminders/${r.id}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                </div>
                {moving[r.id] !== undefined && (
                  <form
                    className="mt-1.5 flex gap-2"
                    onSubmit={(submit) => {
                      submit.preventDefault();
                      void run(() =>
                        api<{ message: string }>(`reminders/${r.id}`, {
                          method: "PATCH",
                          body: { date, time: moving[r.id] },
                        }),
                      ).then((ok) => {
                        if (ok) {
                          const next = { ...moving };
                          delete next[r.id];
                          setMoving(next);
                        }
                      });
                    }}
                  >
                    <Input
                      type="time"
                      value={moving[r.id]}
                      onChange={(e) =>
                        setMoving({ ...moving, [r.id]: e.target.value })
                      }
                      className="w-36"
                    />
                    <Button type="submit" disabled={busy}>
                      Save time
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No reminders</Empty>
        )}
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(submit) => {
            submit.preventDefault();
            void run(() =>
              api<{ message: string }>("reminders", {
                method: "POST",
                body: { date, time: reminderTime, description: reminderText },
              }),
            ).then((ok) => ok && setReminderText(""));
          }}
        >
          <Input
            type="time"
            value={reminderTime}
            onChange={(e) => setReminderTime(e.target.value)}
            className="w-36"
          />
          <Input
            value={reminderText}
            onChange={(e) => setReminderText(e.target.value)}
            placeholder="Remind me to…"
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={busy || !reminderText}>
            Add
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-faint">
          The bot texts you at this time.
        </p>
      </Section>

      <Section title="Tasks due" dot="bg-cat-task">
        {day && day.tasks.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {day.tasks.map((t) => (
              <li key={t.id}>
                {t.description}
                {t.module && <span className="text-muted"> [{t.module}]</span>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No tasks due</Empty>
        )}
      </Section>
    </div>
  );
}

export function CalendarPage() {
  const today = todayIso();
  const [month, setMonth] = useState(() => {
    const date = new Date(`${today}T00:00:00Z`);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  });
  const [selected, setSelected] = useState(today);
  // Which way the month moved: the new one slides in from that side.
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [range, setRange] = useState<CalendarRange | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [start, end] = useMemo(
    () => monthGrid(month.year, month.month),
    [month],
  );

  const load = useCallback(() => {
    api<CalendarRange>(`calendar/${start}/${end}`)
      .then((data) => {
        setRange(data);
        setError(null);
      })
      .catch((failure) => setError(errorText(failure)));
  }, [start, end]);
  useEffect(load, [load]);

  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  const inMonth = (date: string) => fromIso(date).getUTCMonth() === month.month;
  const shift = (by: number) => {
    setDirection(by > 0 ? "right" : "left");
    setMonth(({ year, month: m }) => {
      const next = new Date(Date.UTC(year, m + by, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };
  const title = new Date(
    Date.UTC(month.year, month.month, 1),
  ).toLocaleDateString("en-SG", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => shift(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft {...ICON} />
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const date = fromIso(today);
              const target = date.getUTCFullYear() * 12 + date.getUTCMonth();
              const shown = month.year * 12 + month.month;
              setDirection(
                target > shown ? "right" : target < shown ? "left" : null,
              );
              setMonth({
                year: date.getUTCFullYear(),
                month: date.getUTCMonth(),
              });
              setSelected(today);
            }}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            onClick={() => shift(1)}
            aria-label="Next month"
          >
            <ChevronRight {...ICON} />
          </Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {range?.eventsError && <Notice tone="error">{range.eventsError}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid grid-cols-7 border-b border-line bg-brand-soft text-center text-[11px] font-semibold uppercase tracking-wide text-brand-text">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="py-2">
                {weekday}
              </div>
            ))}
          </div>
          <div
            key={`${month.year}-${month.month}`}
            className={`grid grid-cols-7 transition-opacity duration-150 ${range ? "" : "opacity-50"} ${
              direction === "right"
                ? "animate-slide-from-right"
                : direction === "left"
                  ? "animate-slide-from-left"
                  : ""
            }`}
          >
            {dates.map((date) => (
              <DayCell
                key={date}
                date={date}
                day={range?.days[date]}
                inMonth={inMonth(date)}
                selected={date === selected}
                today={date === today}
                onPick={() => setSelected(date)}
              />
            ))}
          </div>
        </div>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <DayPanel
            key={selected}
            date={selected}
            day={range?.days[selected]}
            onChanged={load}
          />
        </div>
      </div>
    </div>
  );
}
