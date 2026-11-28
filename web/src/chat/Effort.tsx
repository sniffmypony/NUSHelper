import { AnimatePresence, m } from "motion/react";
import { Brain, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useFeedback } from "../components/feedback";
import { ICON } from "../components/icons";
import { DUR, EASE_IN, EASE_OUT } from "../components/motion";
import { errorText } from "../components/page";

export type Effort = "auto" | "low" | "medium" | "high";

const OPTIONS: Array<{ value: Effort; label: string; help: string }> = [
  {
    value: "auto",
    label: "Auto",
    help: "Low for bot actions, medium for study questions",
  },
  { value: "low", label: "Low", help: "Fastest replies" },
  { value: "medium", label: "Medium", help: "More careful working" },
  {
    value: "high",
    label: "High",
    help: "Slowest; a reply can take a few minutes",
  },
];

// How hard the assistant thinks: the same setting as /effort on Telegram.
// A menu above the composer's toolbar; the choice is saved at once.
export function EffortMenu() {
  const { show } = useFeedback();
  const [effort, setEffort] = useState<Effort | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api<{ effort: Effort }>("ai/effort")
      .then((result) => setEffort(result.effort))
      .catch(() => setEffort(null));
  }, []);

  // Outside clicks and Escape close the menu; Escape returns focus.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (effort === null) return null;
  const current = OPTIONS.find((option) => option.value === effort)!;

  const choose = async (value: Effort) => {
    setOpen(false);
    trigger.current?.focus();
    if (value === effort) return;
    const before = effort;
    setEffort(value);
    setSaving(true);
    try {
      await api("ai/effort", { method: "POST", body: { effort: value } });
      show({
        message: `Thinking effort: ${value}${value === "auto" ? "" : " for every message"}`,
        duration: 3000,
      });
    } catch (failure) {
      setEffort(before);
      show({ message: errorText(failure), tone: "error", duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thinking effort: ${current.label}`}
        title="Thinking effort, shared with /effort on Telegram"
        disabled={saving}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-out active:scale-[0.97] motion-reduce:active:scale-100 [@media(pointer:fine)]:h-8 ${
          open
            ? "bg-pressed text-ink"
            : effort === "auto"
              ? "text-muted hover:bg-hover hover:text-ink"
              : "bg-accent-soft text-accent-text hover:bg-pressed"
        }`}
      >
        <Brain {...ICON} size={15} />
        {current.label}
        <ChevronDown
          {...ICON}
          size={13}
          className={`transition-transform duration-[var(--dur-fast)] ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            role="menu"
            aria-label="Thinking effort"
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: DUR.base, ease: EASE_OUT },
            }}
            exit={{
              opacity: 0,
              scale: 0.97,
              transition: { duration: DUR.fast, ease: EASE_IN },
            }}
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const items = [
                ...(box.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitemradio"]',
                ) ?? []),
              ];
              const index = items.indexOf(
                document.activeElement as HTMLElement,
              );
              items[(index + step + items.length) % items.length]?.focus();
            }}
            className="absolute bottom-full left-0 z-30 mb-2 w-72 origin-bottom-left rounded-xl border border-line bg-raised p-1.5 shadow-pop"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted">
              Thinking effort · also /effort on Telegram
            </p>
            {OPTIONS.map((option) => {
              const on = option.value === effort;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => void choose(option.value)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-[var(--dur-fast)] focus-visible:outline-offset-0 ${on ? "bg-accent-soft" : "hover:bg-hover"}`}
                >
                  <span className="grid h-5 w-4 shrink-0 place-items-center text-accent-text">
                    {on && <Check {...ICON} size={15} strokeWidth={2.25} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">
                      {option.label}
                    </span>
                    <span className="block text-[13px] text-muted">
                      {option.help}
                    </span>
                  </span>
                </button>
              );
            })}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
