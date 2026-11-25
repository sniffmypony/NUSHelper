import { MapPin } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Dot, Pill, isExam, type Category } from "../components/category";
import { ICON } from "../components/icons";
import { Empty, PageHeader, StatTile, errorText } from "../components/page";
import { Todos } from "../components/Todos";
import { Button, Card, Notice } from "../components/ui";
import { formatDay, formatMoney } from "../dates";
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
  };
}

type Item = { time: string; text: string; detail?: string; category: Category };

// Everything on one day, in time order (all-day items first).
function itemsOf(day: CalendarDay): Item[] {
  return [
    ...day.classes.map((c) => ({
      time: c.start,
      text: `${c.moduleCode} ${c.lessonType}`,
      detail: c.venue || undefined,
      category: "class" as const,
    })),
    ...day.events.map((e) => ({
      time: e.allDay ? "" : (e.start ?? ""),
      text: e.title,
      detail: e.allDay ? "All day" : `until ${e.end}`,
      category: (isExam(e.title) ? "exam" : "event") as Category,
    })),
    ...day.reminders.map((r) => ({
      time: r.time,
      text: r.description,
      detail: "Reminder",
      category: "reminder" as const,
    })),
    ...day.deadlines.map((d) => ({
      time: d.time,
      text: `${d.moduleCode}: ${d.name}`,
      detail: "Due",
      category: "deadline" as const,
    })),
    ...day.tasks.map((t) => ({
      time: "",
      text: t.description,
      detail: t.module ? `Task · ${t.module}` : "Task due",
      category: "task" as const,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-SG", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Singapore",
    }).format(new Date()),
  );
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}

function Agenda({ items }: { items: Item[] }) {
  if (items.length === 0) return <Empty>Nothing scheduled.</Empty>;
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li
          key={index}
          className={`pill pill-${item.category} flex items-baseline gap-3 rounded-lg px-3 py-2 text-sm`}
        >
          <span className="w-11 shrink-0 font-semibold tabular-nums">
            {item.time || "—"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{item.text}</span>
            {item.detail && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
                {item.category === "class" && <MapPin {...ICON} size={12} />}
                {item.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TodayPage() {
  const [data, setData] = useState<TodayView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TodayView>("today")
      .then((view) => {
        setData(view);
        setError(null);
      })
      .catch((failure) => setError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-faint">Loading…</p>;

  const dates = Object.keys(data.range.days).sort();
  const today = data.range.days[data.date];
  const upcoming = dates.filter((date) => date !== data.date);
  const deadlineCount = dates.reduce(
    (count, date) => count + data.range.days[date].deadlines.length,
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={greeting()}
        description={
          <>
            {formatDay(data.date, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            <span className="ml-1 rounded bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand-text">
              {data.week}
            </span>
          </>
        }
        actions={
          <Button variant="secondary" onClick={() => navigate("/calendar")}>
            Open calendar
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Spent today"
          value={
            data.spending.todayCents === null
              ? "—"
              : formatMoney(data.spending.todayCents)
          }
          hint={
            data.spending.todayCents === null ? "Not logged yet" : undefined
          }
        />
        <StatTile
          label="This week"
          value={formatMoney(data.spending.weekCents)}
        />
        <StatTile
          label="This month"
          value={formatMoney(data.spending.monthCents)}
        />
        <StatTile
          label="Due in 7 days"
          value={deadlineCount}
          hint={deadlineCount === 1 ? "Canvas deadline" : "Canvas deadlines"}
        />
      </div>

      {data.range.eventsError && (
        <Notice tone="error">{data.range.eventsError}</Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card
            title="Today"
            description="Classes, events, reminders and what's due."
          >
            <div className="px-5 py-4">
              <Agenda items={today ? itemsOf(today) : []} />
            </div>
          </Card>

          <Card title="Next 6 days">
            <div className="divide-y divide-line">
              {upcoming.map((date) => {
                const items = itemsOf(data.range.days[date]).filter(
                  (item) => item.category !== "class",
                );
                const classes = data.range.days[date].classes.length;
                return (
                  <div
                    key={date}
                    className="grid gap-2 px-5 py-3 sm:grid-cols-[8rem_1fr]"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {formatDay(date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                      {classes > 0 && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          <Dot category="class" />
                          {classes} class{classes === 1 ? "" : "es"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {items.length === 0 ? (
                        <Empty>Nothing else.</Empty>
                      ) : (
                        items.map((item, index) => (
                          <Pill
                            key={index}
                            category={item.category}
                            className="py-0.5 text-xs"
                          >
                            {item.time && (
                              <span className="mr-1 font-semibold tabular-nums">
                                {item.time}
                              </span>
                            )}
                            {item.text}
                          </Pill>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Todos todos={data.todos} onChanged={load} />
        </div>
      </div>
    </div>
  );
}
