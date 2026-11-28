import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  ExternalLink,
  PartyPopper,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Pill } from "../components/category";
import { ICON } from "../components/icons";
import { Accordion } from "../components/motion";
import {
  EmptyState,
  LoadError,
  PageHeader,
  PageSkeleton,
  errorText,
  useLoad,
} from "../components/page";
import { FeatureOff } from "../components/FeatureOff";
import { useFeatures } from "../features";
import { Badge, Button, Notice, Panel, type Tone } from "../components/ui";

interface Deadline {
  assignmentId: number;
  moduleCode: string;
  name: string;
  dueAt: string;
  url: string | null;
}

type State = "submitted" | "missing" | "unknown";

const sgt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    hour12: false,
    ...options,
  });

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

function countdown(iso: string): string {
  const hours = hoursUntil(iso);
  if (hours < 1) return "within the hour";
  if (hours < 48) return `in ${Math.round(hours)} h`;
  return `in ${Math.round(hours / 24)} days`;
}

// "This week" (to Sunday), "Next week", "Later".
function groupOf(iso: string): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const endOfWeek = new Date(now);
  endOfWeek.setHours(23, 59, 59, 999);
  endOfWeek.setDate(now.getDate() + (6 - day));
  const due = new Date(iso).getTime();
  if (due <= endOfWeek.getTime()) return "This week";
  if (due <= endOfWeek.getTime() + 7 * 86_400_000) return "Next week";
  return "Later";
}

const STATE: Record<State, { label: string; icon: LucideIcon; tone: Tone }> = {
  submitted: { label: "Submitted", icon: CircleCheck, tone: "ok" },
  missing: { label: "Not submitted", icon: CircleDashed, tone: "warn" },
  unknown: { label: "Couldn't check", icon: CircleHelp, tone: "neutral" },
};

function Row({
  deadline,
  state,
  past,
}: {
  deadline: Deadline;
  state?: State;
  past?: boolean;
}) {
  const status = state ? STATE[state] : null;
  const hours = hoursUntil(deadline.dueAt);
  // Urgency: within a day is marked; within two days is emphasised.
  const soon = !past && hours < 24;
  const near = !past && hours < 48;
  // Not submitted and due within a day is the one case worth alarm.
  const tone: Tone | undefined =
    state === "missing" && soon ? "danger" : status?.tone;
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:gap-4 sm:px-5">
      <div
        className={`tnum flex w-11 shrink-0 flex-col items-center rounded-lg py-1 ring-1 ring-inset ${soon ? "bg-now-soft ring-now/60" : "bg-sunken ring-line"} ${past ? "opacity-60" : ""}`}
        aria-hidden
      >
        <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">
          {sgt(deadline.dueAt, { weekday: "short" })}
        </span>
        <span className="text-base leading-tight font-semibold text-ink">
          {sgt(deadline.dueAt, { day: "numeric" })}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill category="class">{deadline.moduleCode}</Pill>
          {deadline.url ? (
            <a
              href={deadline.url}
              target="_blank"
              rel="noreferrer noopener"
              className={`inline-flex min-w-0 items-center gap-1 text-sm font-medium hover:underline ${past ? "text-muted" : "text-ink"}`}
            >
              <span className="min-w-0">{deadline.name}</span>
              <ExternalLink
                {...ICON}
                size={12}
                className="shrink-0 text-faint"
              />
              <span className="sr-only">(opens Canvas)</span>
            </a>
          ) : (
            <span
              className={`text-sm font-medium ${past ? "text-muted" : "text-ink"}`}
            >
              {deadline.name}
            </span>
          )}
        </div>
        <p className="tnum mt-1 text-[13px] text-muted">
          {sgt(deadline.dueAt, {
            weekday: "long",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {!past && (
            <span className={near ? "font-medium text-ink" : ""}>
              {" "}
              · {countdown(deadline.dueAt)}
            </span>
          )}
        </p>
      </div>
      {status && tone && (
        <Badge tone={tone} icon={status.icon} className="mt-0.5 animate-fade">
          {status.label}
        </Badge>
      )}
    </li>
  );
}

export function DeadlinesPage() {
  const { canvas } = useFeatures();
  const [states, setStates] = useState<Record<number, State>>({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const { data, error, reload } = useLoad(
    () => api<{ upcoming: Deadline[]; recent: Deadline[] }>("deadlines"),
    [],
  );
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const check = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await api<{
        states: Array<{ assignmentId: number; state: State }>;
      }>("deadlines/submissions", { method: "POST" });
      setStates(
        Object.fromEntries(result.states.map((s) => [s.assignmentId, s.state])),
      );
      setCheckedAt(result.states.length);
    } catch (failure) {
      setCheckError(errorText(failure));
    } finally {
      setChecking(false);
    }
  };

  if (error && !data) return <LoadError message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton label="Loading deadlines" />;

  const groups = ["This week", "Next week", "Later"]
    .map((name) => ({
      name,
      items: data.upcoming.filter((d) => groupOf(d.dueAt) === name),
    }))
    .filter((group) => group.items.length > 0);

  const thisWeek = groups.find((group) => group.name === "This week")?.items
    .length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Deadlines"
        description={
          data.upcoming.length === 0
            ? "Canvas assignments, synced every morning."
            : `${data.upcoming.length} upcoming${thisWeek ? ` · ${thisWeek} this week` : ""}. Synced from Canvas every morning; the bot checks each one an hour before it's due.`
        }
        actions={
          canvas &&
          data.upcoming.length > 0 && (
            <Button
              variant="secondary"
              disabled={checking}
              onClick={() => void check()}
            >
              <RefreshCw
                {...ICON}
                className={
                  checking ? "animate-spin motion-reduce:animate-none" : ""
                }
              />
              {checking ? "Asking Canvas…" : "Check submissions"}
            </Button>
          )
        }
      />
      {!canvas && (
        <FeatureOff>
          Canvas isn't connected, so there are no deadlines to show. Add your
          Canvas address and access token in Settings.
        </FeatureOff>
      )}
      {checkError && <Notice tone="error">{checkError}</Notice>}
      {checkedAt !== null && !checkError && (
        <Notice tone="ok">
          Checked {checkedAt} deadline{checkedAt === 1 ? "" : "s"} on Canvas
          just now.
        </Notice>
      )}

      {!canvas && groups.length === 0 ? null : groups.length === 0 ? (
        <Panel>
          <EmptyState icon={PartyPopper} title="Nothing due">
            New Canvas assignments appear here the morning after they're posted.
          </EmptyState>
        </Panel>
      ) : (
        groups.map((group) => (
          <Panel
            key={group.name}
            title={group.name}
            aside={
              <span className="tnum text-sm text-muted">
                {group.items.length}
              </span>
            }
            bodyClassName="border-t border-line"
          >
            <ul className="divide-y divide-line">
              {group.items.map((deadline) => (
                <Row
                  key={deadline.assignmentId}
                  deadline={deadline}
                  state={states[deadline.assignmentId]}
                />
              ))}
            </ul>
          </Panel>
        ))
      )}

      {data.recent.length > 0 && (
        <section className="rounded-xl border border-line bg-surface">
          <Accordion
            open={false}
            className="px-4 py-2 sm:px-5"
            title={
              <span className="text-sm font-semibold text-ink">
                Past two weeks{" "}
                <span className="tnum font-normal text-muted">
                  ({data.recent.length})
                </span>
              </span>
            }
          >
            <ul className="-mx-4 mt-2 divide-y divide-line border-t border-line sm:-mx-5">
              {data.recent.map((deadline) => (
                <Row key={deadline.assignmentId} deadline={deadline} past />
              ))}
            </ul>
          </Accordion>
        </section>
      )}
    </div>
  );
}
