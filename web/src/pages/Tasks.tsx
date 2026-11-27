import { Check, Repeat, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Birthdays } from "../components/Birthdays";
import { Pill } from "../components/category";
import { ICON } from "../components/icons";
import { Shake, Tooltip } from "../components/motion";
import { Empty, PageHeader, errorText } from "../components/page";
import { Todos } from "../components/Todos";
import { Button, Card, Input, Notice, Select } from "../components/ui";
import { formatDay, todayIso } from "../dates";

interface TasksView {
  tasks: Array<{
    id: number;
    description: string;
    module: string | null;
    dueDate: string | null;
  }>;
  todos: Array<{ id: number; description: string }>;
  repeating: Array<{ id: number; description: string; when: string }>;
}

type Status = { tone: "ok" | "error"; text: string } | null;

// Runs a change, shows its message, and shakes the form if it was refused.
function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [refused, setRefused] = useState(0);
  const run = async (work: () => Promise<{ message?: string }>) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await work();
      setStatus({ tone: "ok", text: result.message ?? "Done." });
      onDone();
      return true;
    } catch (failure) {
      setStatus({ tone: "error", text: errorText(failure) });
      setRefused((count) => count + 1);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, status, refused, run };
}

function dueLabel(
  dueDate: string | null,
): { text: string; late: boolean } | null {
  if (!dueDate) return null;
  const today = todayIso();
  if (dueDate < today) {
    return {
      text: `Overdue · ${formatDay(dueDate, { day: "numeric", month: "short" })}`,
      late: true,
    };
  }
  if (dueDate === today) return { text: "Due today", late: false };
  return {
    text: `Due ${formatDay(dueDate, { weekday: "short", day: "numeric", month: "short" })}`,
    late: false,
  };
}

function TaskList({
  data,
  onChanged,
}: {
  data: TasksView;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    description: "",
    module: "",
    dueDate: "",
  });
  const { busy, status, refused, run } = useAction(onChanged);

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(() =>
      api<{ message: string }>("tasks", { method: "POST", body: draft }),
    ).then(
      (ok) => ok && setDraft({ description: "", module: "", dueDate: "" }),
    );
  };

  return (
    <Card
      title="Tasks"
      description="Longer-term work. A task due today also joins today's to-dos."
    >
      <div className="space-y-4 px-5 py-4">
        {data.tasks.length === 0 ? (
          <Empty>Nothing on your list.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {data.tasks.map((task) => {
              const due = dueLabel(task.dueDate);
              return (
                <li
                  key={task.id}
                  className="flex animate-settle items-start gap-3 py-2.5"
                >
                  <Tooltip label="Mark done">
                    <button
                      type="button"
                      aria-label={`Mark done: ${task.description}`}
                      disabled={busy}
                      className="group mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-line-strong transition-[transform,border-color,background-color] duration-150 ease-out hover:border-ok hover:bg-ok-soft active:scale-[0.97]"
                      onClick={() =>
                        void run(() =>
                          api<{ message: string }>(`tasks/${task.id}/done`, {
                            method: "POST",
                          }),
                        )
                      }
                    >
                      <Check
                        {...ICON}
                        size={12}
                        strokeWidth={2.5}
                        className="text-ok opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                      />
                    </button>
                  </Tooltip>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{task.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {task.module && (
                        <Pill category="class" className="py-0.5 font-medium">
                          {task.module}
                        </Pill>
                      )}
                      {due && (
                        <span
                          className={
                            due.late
                              ? "font-semibold text-danger"
                              : "text-muted"
                          }
                        >
                          {due.text}
                        </span>
                      )}
                    </div>
                  </div>
                  <Tooltip label="Delete">
                    <Button
                      variant="ghost"
                      aria-label={`Delete: ${task.description}`}
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete "${task.description}"?`)) {
                          void run(() =>
                            api<{ message: string }>(`tasks/${task.id}`, {
                              method: "DELETE",
                            }),
                          );
                        }
                      }}
                    >
                      <Trash2 {...ICON} />
                    </Button>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        )}

        <Shake trigger={refused}>
          <form
            onSubmit={add}
            className="grid gap-2 rounded-xl bg-sunken p-3 sm:grid-cols-[1fr_8rem_10rem_auto]"
          >
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="New task"
              invalid={status?.tone === "error"}
            />
            <Input
              value={draft.module}
              onChange={(e) => setDraft({ ...draft, module: e.target.value })}
              placeholder="Module"
              aria-label="Module (optional)"
              autoCapitalize="characters"
            />
            <Input
              type="date"
              value={draft.dueDate}
              onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
              aria-label="Due date (optional)"
            />
            <Button type="submit" disabled={busy || !draft.description.trim()}>
              Add
            </Button>
          </form>
        </Shake>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Card>
  );
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function RepeatingList({
  data,
  onChanged,
}: {
  data: TasksView;
  onChanged: () => void;
}) {
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"day" | "weekdays" | "weekly" | "monthly">(
    "day",
  );
  const [days, setDays] = useState<string[]>(["mon"]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const { busy, status, refused, run } = useAction(onChanged);

  const when =
    kind === "weekly" ? days.join(",") : kind === "monthly" ? dayOfMonth : kind;

  return (
    <Card
      title="Repeating"
      description="Each one joins your to-do list at 8am on its days."
    >
      <div className="space-y-4 px-5 py-4">
        {data.repeating.length === 0 ? (
          <Empty>Nothing repeats yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {data.repeating.map((item) => (
              <li
                key={item.id}
                className="flex animate-settle items-center gap-3 py-2.5"
              >
                <Repeat {...ICON} className="shrink-0 text-cat-task" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted">{item.when}</p>
                </div>
                <Tooltip label="Stop repeating">
                  <Button
                    variant="ghost"
                    aria-label={`Stop repeating: ${item.description}`}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(`Stop repeating "${item.description}"?`)
                      ) {
                        void run(() =>
                          api<{ message: string }>(`repeating/${item.id}`, {
                            method: "DELETE",
                          }),
                        );
                      }
                    }}
                  >
                    <Trash2 {...ICON} />
                  </Button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}

        <Shake trigger={refused}>
          <form
            className="space-y-2 rounded-xl bg-sunken p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() =>
                api<{ message: string }>("repeating", {
                  method: "POST",
                  body: { when, description },
                }),
              ).then((ok) => ok && setDescription(""));
            }}
          >
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Gym"
              invalid={status?.tone === "error"}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                aria-label="How often"
              >
                <option value="day">Every day</option>
                <option value="weekdays">Every weekday</option>
                <option value="weekly">Weekly on…</option>
                <option value="monthly">Monthly on day…</option>
              </Select>
              {kind === "weekly" &&
                WEEKDAYS.map((day) => (
                  <label
                    key={day}
                    className={`cursor-pointer select-none rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors duration-150 ${
                      days.includes(day)
                        ? "bg-brand-soft text-brand-text ring-1 ring-line-strong"
                        : "text-muted hover:bg-hover"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={days.includes(day)}
                      onChange={(e) =>
                        setDays(
                          e.target.checked
                            ? WEEKDAYS.filter(
                                (d) => d === day || days.includes(d),
                              )
                            : days.filter((d) => d !== day),
                        )
                      }
                    />
                    {day}
                  </label>
                ))}
              {kind === "monthly" && (
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className="w-20"
                  aria-label="Day of the month"
                />
              )}
              <Button
                type="submit"
                disabled={
                  busy ||
                  !description.trim() ||
                  (kind === "weekly" && days.length === 0)
                }
              >
                Add
              </Button>
            </div>
          </form>
        </Shake>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Card>
  );
}

export function TasksPage() {
  const [data, setData] = useState<TasksView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<TasksView>("tasks")
      .then((view) => {
        setData(view);
        setError(null);
      })
      .catch((failure) => setError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-faint">Loading…</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="The same lists as /task, /todo and /every on Telegram."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <TaskList data={data} onChanged={load} />
          <RepeatingList data={data} onChanged={load} />
          <Birthdays />
        </div>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Todos todos={data.todos} onChanged={load} />
        </div>
      </div>
    </div>
  );
}
