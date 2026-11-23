import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api";
import { Button, Input, Notice } from "../components/ui";
import {
  addDays,
  formatDay,
  formatMoney,
  fromIso,
  monthGrid,
  todayIso,
} from "../dates";

interface CalendarDay {
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

interface CalendarRange {
  days: Record<string, CalendarDay>;
  eventsError: string | null;
}

type Status = { tone: "ok" | "error"; text: string } | null;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REPEATS = ["", "daily", "weekdays", "weekly", "monthly", "yearly"];

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
  const items = day
    ? [
        ...day.deadlines.map((d) => ({
          text: `${d.moduleCode} due`,
          tone: "text-red-600 dark:text-red-400",
        })),
        ...day.events.map((e) => ({
          text: e.title,
          tone: "text-indigo-700 dark:text-indigo-300",
        })),
        ...day.reminders.map((r) => ({
          text: `${r.time} ${r.description}`,
          tone: "text-amber-700 dark:text-amber-300",
        })),
      ]
    : [];
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex min-h-16 flex-col gap-0.5 border-b border-r border-slate-100 p-1.5 text-left transition-colors md:min-h-28 md:p-2 dark:border-slate-800 ${
        selected
          ? "bg-indigo-50 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-950/60"
          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
      } ${inMonth ? "" : "bg-slate-50/60 text-slate-400 dark:bg-slate-950/40"}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
            today ? "bg-indigo-600 text-white" : ""
          }`}
        >
          {fromIso(date).getUTCDate()}
        </span>
        {isMonday && day && (
          <span className="hidden truncate text-[10px] font-medium text-slate-400 md:inline">
            {shortWeek(day.week)}
          </span>
        )}
      </div>
      {day?.spending && day.spending.cents > 0 && (
        <span className="w-fit max-w-full truncate rounded bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700 md:text-[11px] dark:bg-emerald-950 dark:text-emerald-300">
          <span className="hidden md:inline">S$</span>
          {(day.spending.cents / 100).toFixed(2)}
        </span>
      )}
      <div className="hidden flex-col gap-0.5 md:flex">
        {day && day.classes.length > 0 && (
          <span className="truncate text-[11px] text-slate-500">
            {day.classes.length} class{day.classes.length === 1 ? "" : "es"}
          </span>
        )}
        {items.slice(0, 3).map((item, index) => (
          <span key={index} className={`truncate text-[11px] ${item.tone}`}>
            {item.text}
          </span>
        ))}
        {items.length > 3 && (
          <span className="text-[11px] text-slate-400">
            +{items.length - 3} more
          </span>
        )}
      </div>
      {day && (
        <div className="mt-auto flex gap-0.5 md:hidden">
          {day.classes.length > 0 && <Dot className="bg-slate-400" />}
          {day.events.length > 0 && <Dot className="bg-indigo-500" />}
          {day.deadlines.length > 0 && <Dot className="bg-red-500" />}
          {day.reminders.length > 0 && <Dot className="bg-amber-500" />}
          {day.tasks.length > 0 && <Dot className="bg-sky-500" />}
        </div>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>;
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
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderText, setReminderText] = useState("");
  const [moving, setMoving] = useState<Record<number, string>>({});
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

  const spend = (mode: "add" | "remove") =>
    run(() =>
      api<{ message: string }>("spending", {
        method: "POST",
        body: { date, amount, mode },
      }),
    ).then((ok) => ok && setAmount(""));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="px-4 py-3">
        <h2 className="text-base font-semibold">
          {formatDay(date, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </h2>
        {day && <p className="text-xs text-slate-500">{day.week}</p>}
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </header>

      <Section title="Spending">
        <p className="text-sm">
          {day?.spending ? (
            <span className="font-semibold">
              {formatMoney(day.spending.cents)}
            </span>
          ) : (
            <span className="text-slate-400">Nothing logged</span>
          )}
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5.40 3"
            inputMode="decimal"
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
        </div>
      </Section>

      <Section title="Classes">
        {day && day.classes.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {day.classes.map((c, i) => (
              <li key={i}>
                <span className="font-medium">
                  {c.start}–{c.end}
                </span>{" "}
                {c.moduleCode} {c.lessonType}
                <span className="text-slate-500">
                  {" "}
                  · {c.venue || "no venue"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No classes</Empty>
        )}
      </Section>

      <Section title="Deadlines">
        {day && day.deadlines.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {day.deadlines.map((d, i) => (
              <li key={i} className="text-red-700 dark:text-red-300">
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

      <Section title="Events">
        {day && day.events.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {day.events.map((e) => (
              <li
                key={`${e.id}-${e.start}`}
                className="flex items-start justify-between gap-2"
              >
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
                <button
                  type="button"
                  className="shrink-0 text-xs text-red-600 hover:underline dark:text-red-400"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${e.title}" from Google Calendar?`,
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
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No events</Empty>
        )}
        <form
          className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"
          onSubmit={(submit) => {
            submit.preventDefault();
            void run(() =>
              api<{ message: string }>("events", {
                method: "POST",
                body: { date, ...event },
              }),
            ).then(
              (ok) => ok && setEvent((current) => ({ ...current, title: "" })),
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
                  onChange={(e) => setEvent({ ...event, end: e.target.value })}
                  className="w-36"
                />
              </>
            )}
            <select
              value={event.repeat}
              onChange={(e) => setEvent({ ...event, repeat: e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
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
      </Section>

      <Section title="Reminders">
        {day && day.reminders.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {day.reminders.map((r) => (
              <li key={r.id}>
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">{r.time}</span>{" "}
                    {r.description}
                    {r.status !== "pending" && (
                      <span className="ml-1 text-xs text-slate-400">
                        ({r.status})
                      </span>
                    )}
                  </span>
                  {r.status === "pending" && (
                    <span className="flex shrink-0 gap-2 text-xs">
                      <button
                        type="button"
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
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
                        className="text-red-600 hover:underline dark:text-red-400"
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
        <p className="mt-1.5 text-xs text-slate-400">
          The bot texts you at this time.
        </p>
      </Section>

      <Section title="Tasks due">
        {day && day.tasks.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {day.tasks.map((t) => (
              <li key={t.id}>
                {t.description}
                {t.module && (
                  <span className="text-slate-500"> [{t.module}]</span>
                )}
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
  const shift = (by: number) =>
    setMonth(({ year, month: m }) => {
      const next = new Date(Date.UTC(year, m + by, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
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
            ‹
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const date = fromIso(today);
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
            ›
          </Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {range?.eventsError && <Notice tone="error">{range.eventsError}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="py-2">
                {weekday}
              </div>
            ))}
          </div>
          <div className={`grid grid-cols-7 ${range ? "" : "opacity-50"}`}>
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
            date={selected}
            day={range?.days[selected]}
            onChanged={load}
          />
        </div>
      </div>
    </div>
  );
}
