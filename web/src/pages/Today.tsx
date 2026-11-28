import { ArrowRight, CalendarCheck, Clock, MapPin, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import {
  CATEGORY,
  CategoryIcon,
  cleanTitle,
  isExam,
  type Category,
} from "../components/category";
import { ICON } from "../components/icons";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  useLoad,
} from "../components/page";
import { SetupChecklist } from "../components/SetupChecklist";
import { Todos } from "../components/Todos";
import { Badge, Notice, Panel } from "../components/ui";
import {
  addDays,
  clockOf,
  formatDay,
  formatMoney,
  inTime,
  minutesOf,
  nowMinutes,
  weekLabel,
} from "../dates";
import { navigate } from "../navigation";
import type { CalendarDay, CalendarRange } from "./Calendar";

interface TodayView {
  date: string;
  week: string;
  range: CalendarRange;
  todos: Array<{ id: number; description: string }>;
  spending: {
    todayCents: number | null;
    weekCents: number;
    monthCents: number;
    applePayCents: number;
  };
}

interface Item {
  key: string;
  start: number | null; // minutes after midnight; null = all day / no time
  end: number | null;
  title: string;
  detail?: string;
  venue?: string;
  category: Category;
  url?: string | null;
}

// Everything on one day, in time order (untimed items first).
function itemsOf(day: CalendarDay): Item[] {
  const items: Item[] = [
    ...day.classes.map((c, i) => ({
      key: `c${i}`,
      start: minutesOf(c.start),
      end: minutesOf(c.end),
      title: `${c.moduleCode} ${c.lessonType}`,
      detail: `until ${c.end}`,
      venue: c.venue || undefined,
      category: "class" as const,
    })),
    ...day.events.map((e) => ({
      key: `e${e.id}`,
      start: e.allDay || !e.start ? null : minutesOf(e.start),
      end: e.allDay || !e.end ? null : minutesOf(e.end),
      title: cleanTitle(e.title),
      detail: e.allDay ? "All day" : `until ${e.end}`,
      category: (isExam(e.title) ? "exam" : "event") as Category,
      url: e.url,
    })),
    ...day.reminders.map((r) => ({
      key: `r${r.id}`,
      start: minutesOf(r.time),
      end: null,
      title: r.description,
      detail: r.status === "sent" ? "Reminder sent" : "Reminder",
      category: "reminder" as const,
    })),
    ...day.deadlines.map((d, i) => ({
      key: `d${i}`,
      start: minutesOf(d.time),
      end: null,
      title: `${d.moduleCode}: ${d.name}`,
      detail: "Due",
      category: "deadline" as const,
      url: d.url,
    })),
    ...day.tasks.map((t) => ({
      key: `t${t.id}`,
      start: null,
      end: null,
      title: t.description,
      detail: t.module ? `Task due · ${t.module}` : "Task due",
      category: "task" as const,
    })),
  ];
  return items.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
}

function greeting(minutes: number): string {
  return minutes < 12 * 60
    ? "Good morning"
    : minutes < 18 * 60
      ? "Good afternoon"
      : "Good evening";
}

// The minute, refreshed every 30 seconds, so "now" and "next" stay right
// while the page is open.
function useMinute(): number {
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutes()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const isPast = (item: Item, now: number) =>
  item.start !== null && (item.end ?? item.start) <= now;
const isCurrent = (item: Item, now: number) =>
  item.start !== null &&
  item.end !== null &&
  item.start <= now &&
  now < item.end;

// The focal point: what's happening now and what comes next.
function NowNext({ items, now }: { items: Item[]; now: number }) {
  const current = items.find((item) => isCurrent(item, now));
  const next = items.find(
    (item) => item.start !== null && item.start > now && item !== current,
  );
  if (!current && !next) return null;
  const line = (item: Item, label: "Now" | "Next") => (
    <div className="flex min-w-0 items-start gap-3">
      <Badge tone={label === "Now" ? "now" : "neutral"} className="mt-0.5">
        {label}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink">
          <CategoryIcon category={item.category} />
          <span className="truncate">{item.title}</span>
        </p>
        <p className="tnum mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">
          <span>
            {clockOf(item.start!)}
            {item.end !== null && `–${clockOf(item.end)}`}
          </span>
          {label === "Next" && (
            <span className="font-medium text-ink">
              {inTime(item.start! - now)}
            </span>
          )}
          {label === "Now" && item.end !== null && (
            <span>{item.end - now} min left</span>
          )}
          {item.venue && (
            <span className="inline-flex items-center gap-1">
              <MapPin {...ICON} size={13} />
              {item.venue}
            </span>
          )}
        </p>
      </div>
    </div>
  );
  return (
    <section
      aria-label="Now and next"
      className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 sm:p-5"
      style={{ boxShadow: "inset 3px 0 0 var(--now)" }}
    >
      {current && line(current, "Now")}
      {next && line(next, "Next")}
    </section>
  );
}

// Deadlines and tasks due today or tomorrow: the things that can't slip.
function DueSoon({
  today,
  tomorrow,
}: {
  today: CalendarDay | undefined;
  tomorrow: CalendarDay | undefined;
}) {
  const rows = [
    ...(today?.deadlines ?? []).map((d) => ({
      key: `t-${d.moduleCode}-${d.name}`,
      when: `Today ${d.time}`,
      title: d.name,
      module: d.moduleCode,
      url: d.url,
      urgent: true,
    })),
    ...(tomorrow?.deadlines ?? []).map((d) => ({
      key: `m-${d.moduleCode}-${d.name}`,
      when: `Tomorrow ${d.time}`,
      title: d.name,
      module: d.moduleCode,
      url: d.url,
      urgent: false,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="due-soon" className="space-y-2">
      <h2
        id="due-soon"
        className="text-xs font-semibold tracking-[0.06em] text-muted uppercase"
      >
        Due soon
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.key}>
            <a
              href={row.url ?? "/deadlines"}
              target={row.url ? "_blank" : undefined}
              rel={row.url ? "noreferrer noopener" : undefined}
              onClick={(event) => {
                if (row.url) return;
                event.preventDefault();
                navigate("/deadlines");
              }}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 transition-[background-color,transform] duration-[var(--dur-fast)] hover:bg-hover active:scale-[0.99] motion-reduce:active:scale-100"
            >
              <CategoryIcon category="deadline" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {row.module} · {row.title}
                </span>
                <span
                  className={`tnum block text-[13px] ${row.urgent ? "font-medium text-danger" : "text-muted"}`}
                >
                  {row.when}
                </span>
              </span>
              <ArrowRight {...ICON} className="shrink-0 text-faint" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Today's timeline. Finished items are muted; a marigold line marks now.
function Agenda({ items, now }: { items: Item[]; now: number }) {
  if (items.length === 0) {
    return (
      <EmptyState icon={CalendarCheck} title="Nothing scheduled today">
        Classes, events, reminders and deadlines appear here.
      </EmptyState>
    );
  }
  // Where the "now" line goes: before the first item that hasn't ended.
  const nowIndex = items.findIndex(
    (item) => item.start !== null && !isPast(item, now),
  );
  const timed = items.some((item) => item.start !== null);
  return (
    <ol className="relative">
      {items.map((item, index) => {
        const past = isPast(item, now);
        const current = isCurrent(item, now);
        return (
          <li key={item.key}>
            {timed && index === nowIndex && item.start !== null && (
              <div
                aria-label={`Now, ${clockOf(now)}`}
                className="relative my-1 flex items-center gap-2 pl-1"
              >
                <span className="tnum w-11 text-right text-[11px] font-semibold text-on-now">
                  <span className="rounded bg-now px-1 py-px">
                    {clockOf(now)}
                  </span>
                </span>
                <span aria-hidden className="h-px flex-1 bg-now" />
              </div>
            )}
            <div
              className={`flex items-start gap-3 rounded-lg px-1 py-2.5 ${current ? "bg-now-soft" : ""}`}
            >
              <span
                className={`tnum w-11 shrink-0 pt-px text-right text-[13px] font-semibold ${past ? "text-faint" : "text-ink"}`}
              >
                {item.start === null ? (
                  <span className="text-[11px] font-medium text-muted">
                    {item.category === "task" ? "Due" : "All day"}
                  </span>
                ) : (
                  clockOf(item.start)
                )}
              </span>
              <span className="pt-0.5" title={CATEGORY[item.category].label}>
                <CategoryIcon
                  category={item.category}
                  className={past ? "opacity-50" : ""}
                />
                <span className="sr-only">
                  {CATEGORY[item.category].label}:{" "}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-medium ${past ? "text-muted" : "text-ink"}`}
                >
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:underline"
                    >
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </span>
                <span className="tnum mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                  {item.detail && <span>{item.detail}</span>}
                  {item.venue && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin {...ICON} size={12} />
                      {item.venue}
                    </span>
                  )}
                </span>
              </span>
            </div>
          </li>
        );
      })}
      {timed && nowIndex === -1 && (
        <li
          aria-label={`Now, ${clockOf(now)}`}
          className="mt-1 flex items-center gap-2 pl-1"
        >
          <span className="tnum w-11 text-right text-[11px] font-semibold text-on-now">
            <span className="rounded bg-now px-1 py-px">{clockOf(now)}</span>
          </span>
          <span aria-hidden className="h-px flex-1 bg-now" />
        </li>
      )}
    </ol>
  );
}

// The six days after today: one line each, classes counted, the rest named.
function NextDays({ range, today }: { range: CalendarRange; today: string }) {
  const dates = Array.from({ length: 6 }, (_, i) => addDays(today, i + 1));
  return (
    <ul className="divide-y divide-line">
      {dates.map((date) => {
        const day = range.days[date];
        if (!day) return null;
        const items = itemsOf(day).filter((item) => item.category !== "class");
        const classes = day.classes.length;
        return (
          <li
            key={date}
            className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[6.5rem_1fr] sm:px-5"
          >
            <div className="flex items-baseline gap-2 sm:block">
              <p className="text-sm font-semibold text-ink">
                {formatDay(date, { weekday: "short", day: "numeric" })}
              </p>
              <p className="text-[13px] text-muted">
                {classes > 0
                  ? `${classes} class${classes === 1 ? "" : "es"}`
                  : weekLabel(day.week)}
              </p>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-faint sm:pt-px">
                Nothing else planned
              </p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li
                    key={item.key}
                    className="flex min-w-0 items-center gap-2 text-sm"
                  >
                    <CategoryIcon category={item.category} size={14} />
                    <span className="sr-only">
                      {CATEGORY[item.category].label}:{" "}
                    </span>
                    <span className="tnum w-12 shrink-0 text-[13px] text-muted">
                      {item.start === null
                        ? item.category === "task"
                          ? "Due"
                          : "All day"
                        : clockOf(item.start)}
                    </span>
                    <span className="min-w-0 truncate text-ink">
                      {item.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SpendingSummary({ spending }: { spending: TodayView["spending"] }) {
  const figure = (label: string, cents: number | null) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-base font-semibold text-ink">
        {cents === null ? "—" : formatMoney(cents)}
      </dd>
    </div>
  );
  return (
    <Panel
      title="Spending"
      aside={
        <a
          href="/spending"
          onClick={(event) => {
            event.preventDefault();
            navigate("/spending");
          }}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-accent-text hover:bg-hover"
        >
          Open
          <ArrowRight {...ICON} size={14} />
        </a>
      }
    >
      <dl className="grid grid-cols-3 gap-3 px-4 pb-4 sm:px-5">
        {figure("Today", spending.todayCents)}
        {figure("This week", spending.weekCents)}
        {figure("This month", spending.monthCents)}
      </dl>
      <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-[13px] text-muted sm:px-5">
        <Wallet {...ICON} size={14} />
        {spending.todayCents === null
          ? "Today isn't logged yet. The bot asks at 11:30pm."
          : spending.applePayCents > 0
            ? `${formatMoney(spending.applePayCents)} of today came in automatically.`
            : "Logged for today."}
      </p>
    </Panel>
  );
}

export function TodayPage() {
  const { data, error, reload } = useLoad(() => api<TodayView>("today"), []);
  const now = useMinute();

  if (error && !data) return <LoadError message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton label="Loading today" />;

  const today = data.range.days[data.date];
  const items = today ? itemsOf(today) : [];
  const remaining = items.filter((item) => !isPast(item, now)).length;

  return (
    <div className="space-y-6">
      <SetupChecklist />
      <PageHeader
        eyebrow={greeting(now)}
        title={formatDay(data.date, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{weekLabel(data.week)}</Badge>
            <span className="inline-flex items-center gap-1">
              <Clock {...ICON} size={14} />
              {items.length === 0
                ? "A free day"
                : remaining === 0
                  ? "All done for today"
                  : `${remaining} of ${items.length} still to come`}
            </span>
          </span>
        }
      />

      {data.range.eventsError && (
        <Notice tone="error">{data.range.eventsError}</Notice>
      )}

      <div className="today-grid">
        <div className="today-now space-y-6 empty:hidden">
          <NowNext items={items} now={now} />
          <DueSoon
            today={today}
            tomorrow={data.range.days[addDays(data.date, 1)]}
          />
        </div>

        <Panel
          title="Today"
          description="Classes, events, reminders and what's due"
          className="today-agenda"
          bodyClassName="px-3 pb-3 sm:px-4"
        >
          <Agenda items={items} now={now} />
        </Panel>

        <div className="today-side">
          <div className="today-todo">
            <Todos todos={data.todos} onChanged={reload} />
          </div>
          <div className="today-money">
            <SpendingSummary spending={data.spending} />
          </div>
        </div>

        <Panel
          title="Next 6 days"
          className="today-week"
          bodyClassName="border-t border-line"
        >
          <NextDays range={data.range} today={data.date} />
        </Panel>
      </div>
    </div>
  );
}
