import { useState, type ReactNode } from "react";

// Page furniture shared by the planner pages.

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// A single headline number (no chart needed).
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="animate-settle rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-text">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// Counts refusals (each new error status), so a field shakes once per
// refusal, like a head shake (web/DESIGN.md §1).
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
