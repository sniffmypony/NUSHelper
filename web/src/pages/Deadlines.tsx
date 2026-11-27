import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Pill } from "../components/category";
import { ICON } from "../components/icons";
import { Accordion } from "../components/motion";
import { Empty, PageHeader, errorText } from "../components/page";
import { FeatureOff } from "../components/FeatureOff";
import { useFeatures } from "../features";
import { Button, Card, Notice } from "../components/ui";

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

function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "within the hour";
  if (hours < 48) return `in ${hours} h`;
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

const STATE: Record<
  State,
  { label: string; icon: typeof CircleCheck; tone: string }
> = {
  submitted: { label: "Submitted", icon: CircleCheck, tone: "text-ok" },
  missing: { label: "Not submitted", icon: CircleDashed, tone: "text-danger" },
  unknown: { label: "Couldn't check", icon: CircleHelp, tone: "text-muted" },
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
  return (
    <li className="flex animate-settle flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
      <Pill category="deadline" className="py-0.5 text-xs font-semibold">
        {deadline.moduleCode}
      </Pill>
      <div className="min-w-0 flex-1">
        {deadline.url ? (
          <a
            href={deadline.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            {deadline.name}
            <ExternalLink {...ICON} size={12} className="text-faint" />
          </a>
        ) : (
          <span className="text-sm font-medium">{deadline.name}</span>
        )}
        <p className="text-xs text-muted tabular-nums">
          {sgt(deadline.dueAt, {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {!past && ` · ${countdown(deadline.dueAt)}`}
        </p>
      </div>
      {status && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${status.tone}`}
        >
          <status.icon {...ICON} size={14} />
          {status.label}
        </span>
      )}
    </li>
  );
}

export function DeadlinesPage() {
  const { canvas } = useFeatures();
  const [data, setData] = useState<{
    upcoming: Deadline[];
    recent: Deadline[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<Record<number, State>>({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    api<{ upcoming: Deadline[]; recent: Deadline[] }>("deadlines")
      .then(setData)
      .catch((failure) => setError(errorText(failure)));
  }, []);

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
    } catch (failure) {
      setCheckError(errorText(failure));
    } finally {
      setChecking(false);
    }
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-faint">Loading…</p>;

  const groups = ["This week", "Next week", "Later"]
    .map((name) => ({
      name,
      items: data.upcoming.filter((d) => groupOf(d.dueAt) === name),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deadlines"
        description="Canvas assignments, synced every morning. The bot checks each one an hour before it's due."
        actions={
          canvas && (
            <Button
              variant="secondary"
              disabled={checking || data.upcoming.length === 0}
              onClick={() => void check()}
            >
              <RefreshCw {...ICON} className={checking ? "animate-spin" : ""} />
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
      {Object.keys(states).length > 0 && (
        <Notice tone="info">
          Checked the next two weeks' deadlines on Canvas just now.
        </Notice>
      )}

      {!canvas && groups.length === 0 ? null : groups.length === 0 ? (
        <Card title="Upcoming">
          <div className="px-5 py-4">
            <Empty>Nothing due. Enjoy it.</Empty>
          </div>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.name} title={group.name}>
            <ul className="divide-y divide-line">
              {group.items.map((deadline) => (
                <Row
                  key={deadline.assignmentId}
                  deadline={deadline}
                  state={states[deadline.assignmentId]}
                />
              ))}
            </ul>
          </Card>
        ))
      )}

      {data.recent.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface shadow-card">
          <Accordion
            open={false}
            className="px-5 py-4"
            title={
              <span className="text-sm font-semibold text-brand-text">
                Past two weeks ({data.recent.length})
              </span>
            }
          >
            <ul className="-mx-5 mt-3 divide-y divide-line border-t border-line">
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
