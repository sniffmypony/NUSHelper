import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { Source } from "../api";
import { ICON } from "./icons";
import { useShake } from "./motion";

// Shared controls (web/DESIGN.md §3–4). Pages compose these rather than
// styling buttons, fields and panels themselves.

// A panel: a titled surface. The title sits on the panel (no coloured band);
// `aside` holds one control on the right; children are divided rows.
export function Panel({
  title,
  description,
  aside,
  id,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 rounded-xl border border-line bg-surface ${className}`}
    >
      {(title || aside) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-muted">{description}</p>
            )}
          </div>
          {aside}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// Settings-style panel: the same surface, its rows divided by hairlines.
export function Card({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <Panel
      id={id}
      title={title}
      description={description}
      bodyClassName="divide-y divide-line border-t border-line"
    >
      {children}
    </Panel>
  );
}

// A labelled setting: label and help on the left (above on phones), the
// control on the right.
export function Row({
  label,
  help,
  aside,
  children,
}: {
  label: string;
  help?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[15rem_1fr] md:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {label}
          {aside}
        </div>
        {help && (
          <p className="mt-1 text-[13px] leading-snug text-muted">{help}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type Variant = "primary" | "secondary" | "quiet" | "danger" | "danger-quiet";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press disabled:bg-pressed disabled:text-faint",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-hover active:bg-pressed disabled:text-faint",
  quiet:
    "text-muted hover:bg-hover hover:text-ink active:bg-pressed disabled:text-faint",
  danger:
    "bg-danger text-on-danger hover:brightness-110 active:brightness-95 disabled:bg-pressed disabled:text-faint",
  "danger-quiet":
    "text-danger hover:bg-danger-soft active:bg-danger-soft disabled:text-faint",
};

const SIZES: Record<Size, string> = {
  // 40 px tall on touch screens, 36 px with a mouse.
  md: "h-10 px-3.5 text-sm [@media(pointer:fine)]:h-9",
  sm: "h-9 px-2.5 text-[13px] [@media(pointer:fine)]:h-8",
};

// Pressed buttons shrink to 0.97 for 120 ms, like a physical click.
const PRESS =
  "transition-[transform,background-color,color,filter] duration-[var(--dur-fast)] ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button(
  {
    variant = "primary",
    size = "md",
    className = "",
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      className={`inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium disabled:cursor-not-allowed ${PRESS} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  );
});

// A square icon-only button. `label` is its accessible name (and tooltip
// text where the caller adds one).
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    variant?: "quiet" | "secondary" | "danger-quiet";
  }
>(function IconButton(
  { label, variant = "quiet", className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      {...props}
      className={`inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg [@media(pointer:fine)]:h-8 [@media(pointer:fine)]:w-8 disabled:cursor-not-allowed ${PRESS} ${VARIANTS[variant]} ${className}`}
    />
  );
});

export const FIELD =
  "rounded-lg border bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-out placeholder:text-faint focus-visible:outline-none focus:ring-3 disabled:bg-sunken disabled:text-faint";
const FIELD_OK =
  "border-field focus:border-accent focus:ring-accent/20 hover:border-muted";
const FIELD_BAD = "border-danger focus:border-danger focus:ring-danger/20";
const FIELD_HEIGHT = "h-10 [@media(pointer:fine)]:h-9";

export function fieldClass(invalid = false): string {
  return `${FIELD} ${invalid ? FIELD_BAD : FIELD_OK}`;
}

// `invalid` turns the field red; raising `shake` shakes it, for input the
// bot refused (web/DESIGN.md §5).
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; shake?: number }
>(function Input(
  { className = "", invalid = false, shake = 0, ...props },
  outer,
) {
  const ref = useShake<HTMLInputElement>(shake);
  // Full width unless the caller sets a width.
  const width = /(^|\s)w-/.test(className) ? "" : "w-full";
  return (
    <input
      ref={(node) => {
        ref.current = node;
        if (typeof outer === "function") outer(node);
        else if (outer) outer.current = node;
      }}
      {...props}
      aria-invalid={invalid || undefined}
      className={`${width} ${FIELD_HEIGHT} ${fieldClass(invalid)} ${className}`}
    />
  );
});

export function Textarea({
  className = "",
  invalid = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={`block w-full resize-y py-2 leading-relaxed ${fieldClass(invalid)} ${className}`}
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
      className={`${FIELD_HEIGHT} ${fieldClass(invalid)} pr-8 pl-2.5 ${className}`}
    />
  );
}

// A labelled form field: the label above, then the control, then a hint or
// the error (which replaces the hint and is announced).
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-[13px] text-faint">{hint}</p>
      )}
    </div>
  );
}

export type Tone =
  "neutral" | "accent" | "ok" | "warn" | "danger" | "info" | "now";

const BADGE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted ring-line",
  accent: "bg-accent-soft text-accent-text ring-accent/20",
  ok: "bg-ok-soft text-ok ring-ok/20",
  warn: "bg-warn-soft text-warn ring-warn/25",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
  now: "bg-now text-on-now ring-transparent",
};

// A small status label. States carry an icon or a word, never colour alone.
export function Badge({
  tone = "neutral",
  icon: Icon,
  className = "",
  children,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${BADGE[tone]} ${className}`}
    >
      {Icon && <Icon {...ICON} size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

const SOURCE: Record<Source, { label: string; tone: Tone }> = {
  website: { label: "Set here", tone: "accent" },
  vercel: { label: "From Vercel", tone: "neutral" },
  unset: { label: "Not set", tone: "warn" },
};

export function SourceBadge({ source }: { source: Source }) {
  return <Badge tone={SOURCE[source].tone}>{SOURCE[source].label}</Badge>;
}

const NOTICE = {
  ok: { icon: CircleCheck, tone: "text-ok" },
  error: { icon: CircleAlert, tone: "text-danger" },
  info: { icon: Info, tone: "text-muted" },
};

// One line of feedback after an action: an icon, then the message. Errors
// are announced at once; the others politely.
export function Notice({
  tone,
  className = "mt-2",
  children,
}: {
  tone: "ok" | "error" | "info";
  className?: string;
  children: ReactNode;
}) {
  const { icon: Icon, tone: colour } = NOTICE[tone];
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex animate-settle items-start gap-1.5 text-sm ${colour} ${className}`}
    >
      <Icon {...ICON} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
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
