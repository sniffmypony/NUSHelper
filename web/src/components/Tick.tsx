import { AnimatePresence, m } from "motion/react";
import { Check } from "lucide-react";
import { SPRING } from "./motion";

// A round tick box: 22 px circle inside a 40 px touch target. Ticking fills
// it with a spring; the list then removes the row (with Undo).
export function Tick({
  checked,
  label,
  disabled,
  onToggle,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="group -m-2.5 grid h-10 w-10 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed"
    >
      <span
        className={`relative grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] transition-[border-color,background-color,transform] duration-[var(--dur-fast)] ease-out group-active:scale-90 motion-reduce:group-active:scale-100 ${
          checked
            ? "border-accent bg-accent"
            : "border-field group-hover:border-accent group-hover:bg-accent-soft"
        }`}
      >
        <AnimatePresence initial={false}>
          {checked && (
            <m.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={SPRING.tick}
              className="text-on-accent"
            >
              <Check size={13} strokeWidth={3} aria-hidden />
            </m.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
