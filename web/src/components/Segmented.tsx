import { m } from "motion/react";
import { useId, type ReactNode } from "react";
import { SPRING } from "./motion";

// A segmented control (radio group): the selected segment's background
// slides to the new choice (a shared layoutId, unique per control).
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-line bg-sunken p-0.5"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={option.title}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const index = options.findIndex((o) => o.value === value);
              const step =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next =
                options[(index + step + options.length) % options.length];
              onChange(next.value);
              (
                event.currentTarget.parentElement?.querySelector(
                  `[data-value="${next.value}"]`,
                ) as HTMLElement | null
              )?.focus();
            }}
            data-value={option.value}
            tabIndex={on ? 0 : -1}
            className={`relative inline-flex items-center gap-1.5 rounded-md font-medium transition-colors duration-[var(--dur-fast)] ${size === "sm" ? "h-8 px-2.5 text-[13px] [@media(pointer:fine)]:h-7" : "h-9 px-3 text-sm [@media(pointer:fine)]:h-8"} ${on ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {on && (
              <m.span
                layoutId={`segment-${id}`}
                transition={SPRING.snap}
                className="absolute inset-0 rounded-md border border-line bg-surface shadow-[0_1px_2px_oklch(0.3_0.02_75/0.08)]"
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
