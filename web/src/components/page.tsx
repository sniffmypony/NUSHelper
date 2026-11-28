import { CircleAlert, RotateCw, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ICON } from "./icons";
import { Button } from "./ui";

// Page furniture shared by every page: header, figures, empty, loading and
// error states, and a loader hook.

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[13px] font-medium text-muted">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-[-0.015em] text-balance md:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

// A summary figure: a small label, the value, one line of context, and an
// optional icon or sparkline on the right. Not interactive, so no hover.
export function Metric({
  label,
  value,
  detail,
  aside,
  className = "",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface px-4 py-3.5 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-[0.06em] text-muted uppercase">
          {label}
        </p>
        {aside}
      </div>
      <p className="tnum mt-1 text-2xl leading-tight font-semibold tracking-tight text-ink">
        {value}
      </p>
      {detail && (
        <div className="mt-1 text-[13px] leading-snug text-muted">{detail}</div>
      )}
    </div>
  );
}

// "Nothing here" inside a list: one quiet line.
export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

// A whole empty section: an icon, what will appear here, and how to start.
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-6 py-8 text-center ${className}`}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-sunken text-muted">
        <Icon {...ICON} size={18} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && (
        <p className="max-w-xs text-[13px] text-muted">{children}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// Placeholder blocks shaped like the content, so nothing jumps when it
// arrives. The region is marked busy and announced once.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse-soft rounded-md bg-pressed ${className}`}
    />
  );
}

export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only" role="status">
        {label}…
      </span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
          {["w-3/4", "w-1/2", "w-2/3", "w-2/5", "w-3/5"].map((width) => (
            <div key={width} className="flex items-center gap-3">
              <Skeleton className="h-4 w-11" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

// A load that failed: what happened, and a way to try again.
export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex animate-settle flex-wrap items-center gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3"
    >
      <CircleAlert {...ICON} className="shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-sm text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCw {...ICON} size={14} />
          Try again
        </Button>
      )}
    </div>
  );
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// Loads a page's data. `reload` keeps the old data on screen while the new
// copy arrives, so refreshing after a change never flashes a skeleton.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    const ticket = ++latest.current;
    run()
      .then((value) => {
        if (ticket !== latest.current) return;
        setData(value);
        setError(null);
      })
      .catch((failure) => {
        if (ticket === latest.current) setError(errorText(failure));
      });
  }, [run]);
  useEffect(reload, [reload]);
  return { data, error, reload, setData };
}

// Counts refusals (each new error status), so a field shakes once per
// refusal, like a head shake (web/DESIGN.md §5).
export function useRefusals(
  status: { tone: string; text: string } | null,
): number {
  const [count, setCount] = useState(0);
  const [seen, setSeen] = useState(status);
  if (status !== seen) {
    setSeen(status);
    if (status?.tone === "error") setCount(count + 1);
  }
  return count;
}
