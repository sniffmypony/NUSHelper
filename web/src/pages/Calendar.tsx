import {
  BellRing,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Trash2,
  Wallet,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import {
  CATEGORY,
  CategoryIcon,
  cleanTitle,
  Dot,
  isExam,
  type Category,
} from "../components/category";
import { useConfirm } from "../components/dialog";
import { useFeedback, useRemovable } from "../components/feedback";
import { FeatureOff } from "../components/FeatureOff";
import { ICON } from "../components/icons";
import { Tooltip } from "../components/motion";
import { LoadError, Skeleton, errorText, useLoad } from "../components/page";
import { Segmented } from "../components/Segmented";
import {
  Badge,
  Button,
  IconButton,
  Input,
  Notice,
  Select,
} from "../components/ui";
import {
  addDays,
  formatDay,
  formatMoney,
  fromIso,
  monthGrid,
  todayIso,
  weekLabel,
} from "../dates";
import { useFeatures } from "../features";

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

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "es" : "s"}`;

// A cell's items, most important first: deadlines, exams, events,
// reminders, tasks.
function cellItems(day: CalendarDay) {
  return [
    ...day.deadlines.map((d) => ({
      text: `${d.moduleCode} due`,
      category: "deadline" as Category,
    })),
    ...day.events.map((e) => ({
      text:
        e.allDay || !e.start
          ? cleanTitle(e.title)
          : `${e.start} ${cleanTitle(e.title)}`,
      category: (isExam(e.title) ? "exam" : "event") as Category,
    })),
    ...day.reminders.map((r) => ({
      text: `${r.time} ${r.description}`,
      category: "reminder" as Category,
    })),
    ...day.tasks.map((t) => ({
      text: t.description,
      category: "task" as Category,
    })),
  ];
}

// What a screen reader hears for a day: the date and what's on it.
function describeDay(date: string, day: CalendarDay | undefined): string {
  const name = formatDay(date, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (!day) return name;
  const parts = [
    day.classes.length && plural(day.classes.length, "class"),
    day.events.length && plural(day.events.length, "event"),
    day.deadlines.length && plural(day.deadlines.length, "deadline"),
    day.reminders.length && plural(day.reminders.length, "reminder"),
    day.tasks.length && plural(day.tasks.length, "task"),
    day.spending &&
      day.spending.cents > 0 &&
      `spent ${formatMoney(day.spending.cents)}`,
  ].filter(Boolean);
  return parts.length ? `${name}: ${parts.join(", ")}` : name;
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
  const items = day ? cellItems(day) : [];
  const categories = day
    ? ([
        day.classes.length > 0 && "class",
        day.events.some((e) => isExam(e.title)) && "exam",
        day.events.some((e) => !isExam(e.title)) && "event",
        day.deadlines.length > 0 && "deadline",
        day.reminders.length > 0 && "reminder",
        day.tasks.length > 0 && "task",
      ].filter(Boolean) as Category[])
    : [];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-current={today ? "date" : undefined}
      aria-label={describeDay(date, day)}
      className={`relative flex min-h-14 min-w-0 flex-col gap-1 border-r border-b border-line p-1 text-left transition-[background-color] duration-[var(--dur-fast)] ease-out focus-visible:z-10 focus-visible:outline-offset-[-2px] md:min-h-28 md:p-1.5 ${
        selected
          ? "bg-accent-soft"
          : inMonth
            ? "hover:bg-hover"
            : "bg-sunken/60 hover:bg-hover"
      }`}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 ring-2 ring-accent ring-inset"
        />
      )}
      <span className="flex items-center justify-between gap-1">
        <span
          className={`tnum grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold ${
            today ? "bg-now text-on-now" : inMonth ? "text-ink" : "text-faint"
          }`}
        >
          {fromIso(date).getUTCDate()}
        </span>
        {day?.spending && day.spending.cents > 0 && (
          <span className="tnum hidden truncate text-[11px] text-muted md:inline">
            {formatMoney(day.spending.cents)}
          </span>
        )}
      </span>
      <span className="hidden min-w-0 flex-col gap-0.5 md:flex">
        {day && day.classes.length > 0 && (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
            <Dot category="class" />
            <span className="truncate">
              {plural(day.classes.length, "class")}
            </span>
          </span>
        )}
        {items.slice(0, 3).map((item, index) => (
          <span
            key={index}
            className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink"
          >
            <Dot category={item.category} />
            <span className="truncate">{item.text}</span>
          </span>
        ))}
        {items.length > 3 && (
          <span className="pl-3 text-[11px] text-muted">
            +{items.length - 3} more
          </span>
        )}
      </span>
      {categories.length > 0 && (
        <span aria-hidden className="mt-auto flex flex-wrap gap-0.5 md:hidden">
          {categories.map((category) => (
            <Dot key={category} category={category} />
          ))}
        </span>
      )}
    </button>
  );
}

type Status = { tone: "ok" | "error"; text: string } | null;

function Row({
  time,
  category,
  title,
  detail,
  actions,
  muted,
  children,
}: {
  time: ReactNode;
  category: Category;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="py-2">
      <div className="flex items-start gap-3">
        <span
          className={`tnum w-11 shrink-0 pt-0.5 text-right text-[13px] font-semibold ${muted ? "text-faint" : "text-ink"}`}
        >
          {time}
        </span>
        <span className="pt-0.5" title={CATEGORY[category].label}>
          <CategoryIcon category={category} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium ${muted ? "text-muted" : "text-ink"}`}
          >
            <span className="sr-only">{CATEGORY[category].label}: </span>
            {title}
          </p>
          {detail && (
            <p className="tnum mt-0.5 text-[13px] text-muted">{detail}</p>
          )}
        </div>
        {actions && (
          <div className="-my-1 flex shrink-0 items-center">{actions}</div>
        )}
      </div>
      {children}
    </li>
  );
}

function DayPanel({
  date,
  day,
  loading,
  onChanged,
}: {
  date: string;
  day: CalendarDay | undefined;
  loading: boolean;
  onChanged: () => void;
}) {
  const { calendar: calendarOn } = useFeatures();
  const confirm = useConfirm();
  const { show } = useFeedback();
  const reminders = useRemovable<number>();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"event" | "reminder" | "spending">(
    calendarOn ? "event" : "reminder",
  );
  const [amount, setAmount] = useState("");
  const [amountRefused, setAmountRefused] = useState(0);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderText, setReminderText] = useState("");
  const [moving, setMoving] = useState<Record<number, string>>({});
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

  // Runs a change; success is a toast, a refusal stays next to the form.
  const run = async (work: () => Promise<{ message?: string }>) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await work();
      show({ message: result.message ?? "Done", duration: 3500 });
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
    ).then((ok) => {
      if (ok) setAmount("");
      else setAmountRefused((count) => count + 1);
    });

  const future = date >= todayIso();
  const visibleReminders = (day?.reminders ?? []).filter(
    (r) => !reminders.isHidden(r.id),
  );
  const entries: Array<{ sort: number; node: ReactNode }> = [];

  for (const [i, c] of (day?.classes ?? []).entries()) {
    entries.push({
      sort: Number(c.start.replace(":", "")),
      node: (
        <Row
          key={`c${i}`}
          time={c.start}
          category="class"
          title={`${c.moduleCode} ${c.lessonType}`}
          detail={
            <span className="inline-flex flex-wrap items-center gap-x-3">
              <span>until {c.end}</span>
              <span className="inline-flex items-center gap-1">
                <MapPin {...ICON} size={12} />
                {c.venue || "No venue"}
              </span>
            </span>
          }
        />
      ),
    });
  }
  for (const [i, d] of (day?.deadlines ?? []).entries()) {
    entries.push({
      sort: Number(d.time.replace(":", "")),
      node: (
        <Row
          key={`d${i}`}
          time={d.time}
          category="deadline"
          title={
            d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {d.moduleCode}: {d.name}
              </a>
            ) : (
              `${d.moduleCode}: ${d.name}`
            )
          }
          detail="Due on Canvas"
        />
      ),
    });
  }
  for (const e of day?.events ?? []) {
    const category: Category = isExam(e.title) ? "exam" : "event";
    entries.push({
      sort: e.allDay || !e.start ? -1 : Number(e.start.replace(":", "")),
      node: (
        <Row
          key={`e${e.id}-${e.start}`}
          time={
            e.allDay ? (
              <span className="text-[11px] text-muted">All day</span>
            ) : (
              e.start
            )
          }
          category={category}
          title={
            e.url ? (
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {cleanTitle(e.title)}
              </a>
            ) : (
              cleanTitle(e.title)
            )
          }
          detail={e.allDay ? undefined : `until ${e.end}`}
          actions={
            <>
              {future && (
                <Tooltip label="Remind me">
                  <IconButton
                    label={`Remind me about ${cleanTitle(e.title)}`}
                    aria-expanded={remindFor?.id === e.id}
                    onClick={() =>
                      setRemindFor(
                        remindFor?.id === e.id
                          ? null
                          : { id: e.id, offset: e.allDay ? 0 : 30 },
                      )
                    }
                  >
                    <BellRing {...ICON} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip label="Delete event">
                <IconButton
                  label={`Delete ${cleanTitle(e.title)}`}
                  variant="danger-quiet"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete this event?",
                      body: `"${cleanTitle(e.title)}" is removed from Google Calendar, and its reminders are cancelled. This can't be undone.`,
                      confirmLabel: "Delete event",
                      danger: true,
                    });
                    if (ok) {
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
                  <Trash2 {...ICON} />
                </IconButton>
              </Tooltip>
            </>
          }
        >
          {remindFor?.id === e.id && (
            <form
              className="mt-2 ml-14 flex animate-settle flex-wrap gap-2"
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
              <Select
                value={remindFor.offset}
                aria-label="When to remind you"
                onChange={(change) =>
                  setRemindFor({
                    id: e.id,
                    offset: Number(change.target.value),
                  })
                }
              >
                {(e.allDay ? ALL_DAY_OFFSETS : TIMED_OFFSETS).map(
                  ([minutes, label]) => (
                    <option key={minutes} value={minutes}>
                      {label}
                    </option>
                  ),
                )}
              </Select>
              <Button type="submit" variant="secondary" disabled={busy}>
                Set reminder
              </Button>
            </form>
          )}
        </Row>
      ),
    });
  }
  for (const r of visibleReminders) {
    const pending = r.status === "pending";
    entries.push({
      sort: Number(r.time.replace(":", "")),
      node: (
        <Row
          key={`r${r.id}`}
          time={r.time}
          category="reminder"
          muted={!pending}
          title={r.description}
          detail={
            <span className="inline-flex flex-wrap items-center gap-2">
              {pending ? (
                "Reminder"
              ) : (
                <Badge>{r.status === "sent" ? "Sent" : r.status}</Badge>
              )}
              {r.eventId && (
                <span title="Moves with its Google Calendar event, and is cancelled if the event is deleted. Moving it here unlinks it.">
                  Follows its event
                </span>
              )}
            </span>
          }
          actions={
            pending && (
              <>
                <Tooltip label="Move">
                  <IconButton
                    label={`Move reminder: ${r.description}`}
                    aria-expanded={moving[r.id] !== undefined}
                    onClick={() =>
                      setMoving({ ...moving, [r.id]: moving[r.id] ?? r.time })
                    }
                  >
                    <Clock {...ICON} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Cancel reminder">
                  <IconButton
                    label={`Cancel reminder: ${r.description}`}
                    variant="danger-quiet"
                    onClick={() =>
                      reminders.remove(
                        r.id,
                        "Reminder cancelled",
                        () => api(`reminders/${r.id}`, { method: "DELETE" }),
                        { onDone: onChanged },
                      )
                    }
                  >
                    <Trash2 {...ICON} />
                  </IconButton>
                </Tooltip>
              </>
            )
          }
        >
          {moving[r.id] !== undefined && (
            <form
              className="mt-2 ml-14 flex animate-settle gap-2"
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
                aria-label="New time"
                onChange={(change) =>
                  setMoving({ ...moving, [r.id]: change.target.value })
                }
                className="w-36"
              />
              <Button type="submit" variant="secondary" disabled={busy}>
                Save time
              </Button>
            </form>
          )}
        </Row>
      ),
    });
  }
  for (const t of day?.tasks ?? []) {
    entries.push({
      sort: -2,
      node: (
        <Row
          key={`t${t.id}`}
          time={<span className="text-[11px] text-muted">Due</span>}
          category="task"
          title={t.description}
          detail={t.module ? `Task · ${t.module}` : "Task"}
        />
      ),
    });
  }
  entries.sort((a, b) => a.sort - b.sort);

  return (
    <section
      aria-label={formatDay(date, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}
      className="rounded-xl border border-line bg-surface"
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div key={date} className="min-w-0 animate-fade">
          <h2 className="text-base font-semibold tracking-tight">
            {formatDay(date, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>
          {day && (
            <p className="text-[13px] text-muted">{weekLabel(day.week)}</p>
          )}
        </div>
        <div className="tnum flex shrink-0 items-center gap-1.5 rounded-lg bg-sunken px-2 py-1 text-[13px] ring-1 ring-line ring-inset">
          <Wallet {...ICON} size={14} className="text-cat-spend" />
          {loading ? (
            <span className="text-muted">…</span>
          ) : day?.spending ? (
            <span className="font-semibold">
              {formatMoney(day.spending.cents)}
            </span>
          ) : (
            <span className="text-muted">Not logged</span>
          )}
        </div>
      </header>

      <div key={date} className="animate-fade border-t border-line px-4">
        {loading ? (
          <div aria-busy="true" className="space-y-3 py-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : entries.length === 0 ? (
          <p className="flex items-center gap-2 py-4 text-sm text-faint">
            <CalendarX2 {...ICON} />
            Nothing on this day.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((entry) => entry.node)}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-line px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Add to this day</h3>
          <Segmented
            label="What to add"
            size="sm"
            value={tab}
            onChange={(value) => {
              setTab(value);
              setStatus(null);
            }}
            options={[
              { value: "event", label: "Event" },
              { value: "reminder", label: "Reminder" },
              { value: "spending", label: "Spending" },
            ]}
          />
        </div>

        {tab === "event" &&
          (calendarOn ? (
            <form
              key="event"
              className="animate-fade space-y-2"
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
                placeholder="Event title"
                aria-label="Event title"
              />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="inline-flex h-10 items-center gap-2 pr-1">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
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
                      aria-label="Starts"
                      onChange={(e) =>
                        setEvent({ ...event, start: e.target.value })
                      }
                      className="w-32"
                    />
                    <span className="text-muted">to</span>
                    <Input
                      type="time"
                      value={event.end}
                      aria-label="Ends"
                      onChange={(e) =>
                        setEvent({ ...event, end: e.target.value })
                      }
                      className="w-32"
                    />
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={event.repeat}
                  aria-label="Repeats"
                  onChange={(e) =>
                    setEvent({ ...event, repeat: e.target.value })
                  }
                >
                  {REPEATS.map((repeat) => (
                    <option key={repeat} value={repeat}>
                      {repeat ? `Repeats ${repeat}` : "Doesn't repeat"}
                    </option>
                  ))}
                </Select>
                <Button
                  type="submit"
                  className="ml-auto"
                  disabled={busy || !event.title}
                >
                  Add event
                </Button>
              </div>
            </form>
          ) : (
            <FeatureOff>
              Connect Google Calendar in Settings to add events here.
            </FeatureOff>
          ))}

        {tab === "reminder" && (
          <form
            key="reminder"
            className="animate-fade space-y-2"
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
            <div className="flex gap-2">
              <Input
                type="time"
                value={reminderTime}
                aria-label="Time"
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-32"
              />
              <Input
                value={reminderText}
                onChange={(e) => setReminderText(e.target.value)}
                placeholder="Remind me to…"
                aria-label="Reminder"
                className="min-w-0 flex-1"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-muted">
                The bot texts you at this time.
              </p>
              <Button type="submit" disabled={busy || !reminderText}>
                Add reminder
              </Button>
            </div>
          </form>
        )}

        {tab === "spending" && (
          <div key="spending" className="animate-fade space-y-2">
            <div className="flex gap-2">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5.40 3"
                aria-label="Amounts in S$"
                inputMode="decimal"
                invalid={status?.tone === "error"}
                shake={amountRefused}
                className="min-w-0 flex-1"
              />
              <Button
                disabled={busy || !amount}
                onClick={() => void spend("add")}
              >
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
            <p className="text-[13px] text-muted">
              Several amounts are added up. Remove takes them off this day's
              total.
            </p>
          </div>
        )}

        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </section>
  );
}

export function CalendarPage() {
  const today = todayIso();
  const [month, setMonth] = useState(() => {
    const date = fromIso(today);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  });
  const [selected, setSelected] = useState(today);
  // Which way the month moved: the new one slides in from that side.
  const [direction, setDirection] = useState<"left" | "right" | null>(null);

  const [start, end] = useMemo(
    () => monthGrid(month.year, month.month),
    [month],
  );
  const {
    data: range,
    error,
    reload,
  } = useLoad(
    () => api<CalendarRange>(`calendar/${start}/${end}`),
    [start, end],
  );
  // A range from another month is kept on screen (faded) until the new one
  // arrives, so the grid never collapses.
  const fresh =
    range && Object.prototype.hasOwnProperty.call(range.days, start);

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
  const showingToday =
    month.year * 12 + month.month ===
    fromIso(today).getUTCFullYear() * 12 + fromIso(today).getUTCMonth();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1
          aria-live="polite"
          className="text-2xl font-semibold tracking-[-0.015em] md:text-[28px]"
        >
          {title}
        </h1>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            disabled={showingToday && selected === today}
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
          <IconButton
            variant="secondary"
            label="Previous month"
            onClick={() => shift(-1)}
          >
            <ChevronLeft {...ICON} />
          </IconButton>
          <IconButton
            variant="secondary"
            label="Next month"
            onClick={() => shift(1)}
          >
            <ChevronRight {...ICON} />
          </IconButton>
        </div>
      </header>
      {error && <LoadError message={error} onRetry={reload} />}
      {range?.eventsError && <Notice tone="error">{range.eventsError}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div
            aria-hidden
            className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold tracking-[0.06em] text-muted uppercase"
          >
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="py-2">
                <span className="md:hidden">{weekday[0]}</span>
                <span className="max-md:hidden">{weekday}</span>
              </div>
            ))}
          </div>
          <div
            key={`${month.year}-${month.month}`}
            aria-busy={!fresh}
            className={`-mr-px -mb-px grid grid-cols-7 transition-opacity duration-[var(--dur-base)] ${fresh ? "" : "opacity-50"} ${
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
                day={fresh ? range?.days[date] : undefined}
                inMonth={inMonth(date)}
                selected={date === selected}
                today={date === today}
                onPick={() => setSelected(date)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-muted">
            {(
              [
                "class",
                "event",
                "exam",
                "deadline",
                "reminder",
                "task",
              ] as Category[]
            ).map((category) => (
              <span key={category} className="inline-flex items-center gap-1.5">
                <Dot category={category} />
                {CATEGORY[category].label}
              </span>
            ))}
          </div>
        </div>
        <div className="lg:sticky lg:top-8">
          <DayPanel
            key={selected}
            date={selected}
            day={fresh ? range?.days[selected] : undefined}
            loading={!fresh}
            onChanged={reload}
          />
        </div>
      </div>
    </div>
  );
}
