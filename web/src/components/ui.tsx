import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import type { Source } from "../api";
import { useShake } from "./motion";

export function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card">
      <header className="border-b border-line px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        )}
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export function Row({
  label,
  help,
  aside,
  children,
}: {
  label: string;
  help?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[14rem_1fr]">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          {label}
          {aside}
        </div>
        {help && <p className="mt-0.5 text-xs text-muted">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-hover",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
  ghost: "text-muted hover:bg-hover hover:text-ink",
};

// Pressed buttons shrink to 0.97 for 150 ms, like a physical click.
const PRESS =
  "transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex select-none items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${PRESS} ${VARIANTS[variant]} ${className}`}
    />
  );
}

export const FIELD =
  "rounded-lg border bg-surface px-3 py-2 text-sm shadow-card outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-faint focus:ring-2";
const FIELD_OK = "border-line-strong focus:border-accent focus:ring-accent/20";
const FIELD_BAD = "border-danger focus:border-danger focus:ring-danger/20";

// `invalid` turns the field red; raising `shake` shakes it, for input the
// bot refused (web/DESIGN.md §1).
export function Input({
  className = "",
  invalid = false,
  shake = 0,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  shake?: number;
}) {
  const ref = useShake<HTMLInputElement>(shake);
  // Full width unless the caller sets a width.
  const width = /(^|\s)w-/.test(className) ? "" : "w-full";
  return (
    <input
      ref={ref}
      {...props}
      aria-invalid={invalid || undefined}
      className={`${width} ${FIELD} ${invalid ? FIELD_BAD : FIELD_OK} ${className}`}
    />
  );
}

export function Select({
  className = "",
  invalid = false,
  shake = 0,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  shake?: number;
}) {
  const ref = useShake<HTMLSelectElement>(shake);
  return (
    <select
      ref={ref}
      {...props}
      aria-invalid={invalid || undefined}
      className={`${FIELD} ${invalid ? FIELD_BAD : FIELD_OK} px-2 ${className}`}
    />
  );
}

const SOURCE_LABELS: Record<Source, string> = {
  website: "Set here",
  vercel: "From Vercel",
  unset: "Not set",
};

const SOURCE_STYLES: Record<Source, string> = {
  website: "bg-accent-soft text-accent-text",
  vercel: "bg-sunken text-muted",
  unset: "bg-warn-soft text-warn",
};

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-line ring-inset ${SOURCE_STYLES[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "ok" | "error" | "info";
  children: ReactNode;
}) {
  const styles = {
    ok: "text-ok",
    error: "text-danger",
    info: "text-muted",
  }[tone];
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`mt-2 animate-settle text-sm ${styles}`}
    >
      {children}
    </p>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
