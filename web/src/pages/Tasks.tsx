import { AnimatePresence, m } from "motion/react";
import { AlertCircle, ListChecks, Plus, Repeat, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Birthdays } from "../components/Birthdays";
import { Pill } from "../components/category";
import { useFeedback, useRemovable } from "../components/feedback";
import { ICON } from "../components/icons";
import { DUR, EASE_IN, SPRING, Tooltip } from "../components/motion";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  errorText,
  useLoad,
} from "../components/page";
import { Tick } from "../components/Tick";
import { Todos } from "../components/Todos";
import {
  Badge,
  Button,
  IconButton,
  Input,
  Notice,
  Panel,
  Select,
} from "../components/ui";
import { addDays, formatDay, todayIso } from "../dates";

interface Task {
  id: number;
  description: string;
  module: string | null;
  dueDate: string | null;
}

interface TasksView {
  tasks: Task[];
  todos: Array<{ id: number; description: string }>;
  repeating: Array<{ id: number; description: string; when: string }>;
}

type Group = "Overdue" | "Today" | "Next 7 days" | "Later" | "No date";
const GROUPS: Group[] = ["Overdue", "Today", "Next 7 days", "Later", "No date"];

function groupOf(task: Task, today: string): Group {
  if (!task.dueDate) return "No date";
  if (task.dueDate < today) return "Overdue";
  if (task.dueDate === today) return "Today";
  if (task.dueDate <= addDays(today, 7)) return "Next 7 days";
  return "Later";
}

function dueText(dueDate: string, today: string): string {
  if (dueDate === today) return "Due today";
  if (dueDate === addDays(today, 1)) return "Due tomorrow";
  const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);
  const date = formatDay(dueDate, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return dueDate < today ? `Was due ${date}` : `Due ${date}`;
}

// The quick-add bar: what, then optionally the module and the due date.
function AddTask({ onAdded }: { onAdded: () => void }) {
  const empty = { description: "", module: "", dueDate: "" };
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(0);
  const { show } = useFeedback();

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ message?: string }>("tasks", {
        method: "POST",
        body: draft,
      });
      setDraft(empty);
      onAdded();
      show({ message: result.message ?? "Task added", duration: 3000 });
    } catch (failure) {
      setError(errorText(failure));
      setRefused((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={add} className="px-4 pb-4 sm:px-5">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_10.5rem_auto]">
        <Input
          value={draft.description}
          onChange={(e) => {
            setDraft({ ...draft, description: e.target.value });
            setError(null);
          }}
          placeholder="New task, e.g. Draft ER diagram"
          aria-label="New task"
          invalid={Boolean(error)}
          shake={refused}
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
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
        </div>
        <Button type="submit" disabled={busy || !draft.description.trim()}>
          <Plus {...ICON} strokeWidth={2} />
          Add task
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}

function TaskList({
  tasks,
  onChanged,
}: {
  tasks: Task[];
  onChanged: () => void;
}) {
  const today = todayIso();
  const rows = useRemovable<number>();
  const visible = tasks.filter((task) => !rows.isHidden(task.id));
  const groups = GROUPS.map((name) => ({
    name,
    items: visible
      .filter((task) => groupOf(task, today) === name)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
  })).filter((group) => group.items.length > 0);

  if (visible.length === 0) {
    return (
      <EmptyState icon={ListChecks} title="No tasks">
        Add longer-term work above. A task due today also joins today's to-dos.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-1 pb-2">
      {groups.map((group) => (
        <section key={group.name} aria-labelledby={`group-${group.name}`}>
          <h3
            id={`group-${group.name}`}
            className={`flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-semibold tracking-[0.06em] uppercase sm:px-5 ${group.name === "Overdue" ? "text-danger" : "text-muted"}`}
          >
            {group.name === "Overdue" && <AlertCircle {...ICON} size={13} />}
            {group.name}
            <span className="tnum font-medium text-faint">
              {group.items.length}
            </span>
          </h3>
          <ul>
            <AnimatePresence initial={false}>
              {group.items.map((task) => {
                const ticked = rows.isTicked(task.id);
                const late = group.name === "Overdue";
                return (
                  <m.li
                    key={task.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{
                      opacity: 0,
                      transition: { duration: DUR.fast, ease: EASE_IN },
                    }}
                    transition={SPRING.snap}
                    className="group flex items-start gap-3 px-4 py-2 hover:bg-hover sm:px-5"
                  >
                    <span className="pt-1 pl-0.5">
                      <Tick
                        checked={ticked}
                        disabled={ticked}
                        label={`Mark done: ${task.description}`}
                        onToggle={() =>
                          rows.remove(
                            task.id,
                            "Task done",
                            () =>
                              api(`tasks/${task.id}/done`, { method: "POST" }),
                            { holdMs: 280, onDone: onChanged },
                          )
                        }
                      />
                    </span>
                    <div className="min-w-0 flex-1 py-1.5">
                      <p
                        className={`text-sm font-medium transition-colors duration-[var(--dur-base)] ${ticked ? "text-faint line-through" : "text-ink"}`}
                      >
                        {task.description}
                      </p>
                      {(task.module || task.dueDate) && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                          {task.module && (
                            <Pill category="class">{task.module}</Pill>
                          )}
                          {task.dueDate &&
                            (late ? (
                              <Badge tone="danger" icon={AlertCircle}>
                                {dueText(task.dueDate, today)}
                              </Badge>
                            ) : (
                              <span className="tnum text-muted">
                                {dueText(task.dueDate, today)}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                    <span className="pt-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                      <Tooltip label="Delete">
                        <IconButton
                          label={`Delete: ${task.description}`}
                          disabled={ticked}
                          onClick={() =>
                            rows.remove(
                              task.id,
                              "Task deleted",
                              () =>
                                api(`tasks/${task.id}`, { method: "DELETE" }),
                              { onDone: onChanged },
                            )
                          }
                        >
                          <Trash2 {...ICON} />
                        </IconButton>
                      </Tooltip>
                    </span>
                  </m.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
  );
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function RepeatingList({
  items,
  onChanged,
}: {
  items: TasksView["repeating"];
  onChanged: () => void;
}) {
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"day" | "weekdays" | "weekly" | "monthly">(
    "day",
  );
  const [days, setDays] = useState<string[]>(["mon"]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(0);
  const rows = useRemovable<number>();
  const { show } = useFeedback();
  const visible = items.filter((item) => !rows.isHidden(item.id));

  const when =
    kind === "weekly" ? days.join(",") : kind === "monthly" ? dayOfMonth : kind;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ message?: string }>("repeating", {
        method: "POST",
        body: { when, description },
      });
      setDescription("");
      onChanged();
      show({
        message: result.message ?? "Repeating item added",
        duration: 3000,
      });
    } catch (failure) {
      setError(errorText(failure));
      setRefused((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Repeating"
      description="Each joins your to-do list at 8am on its days."
    >
      {visible.length > 0 && (
        <ul className="border-t border-line">
          <AnimatePresence initial={false}>
            {visible.map((item) => (
              <m.li
                key={item.id}
                layout
                exit={{
                  opacity: 0,
                  transition: { duration: DUR.fast, ease: EASE_IN },
                }}
                transition={SPRING.snap}
                className="group flex items-center gap-3 border-b border-line px-4 py-2 sm:px-5"
              >
                <Repeat {...ICON} className="shrink-0 text-cat-task" />
                <div className="min-w-0 flex-1 py-1">
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-[13px] text-muted">{item.when}</p>
                </div>
                <Tooltip label="Stop repeating">
                  <IconButton
                    label={`Stop repeating: ${item.description}`}
                    onClick={() =>
                      rows.remove(
                        item.id,
                        "Stopped repeating",
                        () => api(`repeating/${item.id}`, { method: "DELETE" }),
                        { onDone: onChanged },
                      )
                    }
                  >
                    <Trash2 {...ICON} />
                  </IconButton>
                </Tooltip>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <form className="space-y-2 px-4 py-4 sm:px-5" onSubmit={add}>
        <Input
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          placeholder="e.g. Gym"
          aria-label="Repeating to-do"
          invalid={Boolean(error)}
          shake={refused}
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
            variant="secondary"
            className="ml-auto"
            disabled={
              busy ||
              !description.trim() ||
              (kind === "weekly" && days.length === 0)
            }
          >
            Add
          </Button>
        </div>
        {kind === "weekly" && (
          <div role="group" aria-label="Days" className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => {
              const on = days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDays(
                      on
                        ? days.filter((d) => d !== day)
                        : WEEKDAYS.filter((d) => d === day || days.includes(d)),
                    )
                  }
                  className={`h-9 min-w-11 rounded-lg px-2 text-[13px] font-medium capitalize ring-1 transition-[background-color,color,transform] duration-[var(--dur-fast)] ring-inset active:scale-[0.97] motion-reduce:active:scale-100 ${
                    on
                      ? "bg-accent-soft text-accent-text ring-accent/30"
                      : "text-muted ring-line hover:bg-hover"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Panel>
  );
}

export function TasksPage() {
  const { data, error, reload } = useLoad(() => api<TasksView>("tasks"), []);

  if (error && !data) return <LoadError message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton label="Loading tasks" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="The same lists as /task, /todo and /every on Telegram."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Panel
            title="Tasks"
            description="Longer-term work, by when it's due."
            aside={
              <span className="tnum text-sm text-muted">
                {data.tasks.length} open
              </span>
            }
          >
            <AddTask onAdded={reload} />
            <div className="border-t border-line">
              <TaskList tasks={data.tasks} onChanged={reload} />
            </div>
          </Panel>
          <RepeatingList items={data.repeating} onChanged={reload} />
        </div>
        <div className="space-y-6">
          <Todos todos={data.todos} onChanged={reload} />
          <Birthdays />
        </div>
      </div>
    </div>
  );
}
