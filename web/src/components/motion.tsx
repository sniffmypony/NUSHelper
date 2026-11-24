import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ICON } from "./icons";

// Motion pieces from web/DESIGN.md §1–2. Everything moves with transform,
// opacity or filter only.

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Shakes its contents like a head shake each time `trigger` goes up: for
// input the bot refused. Pair it with a red field and the error text.
export function Shake({
  trigger,
  className = "",
  children,
}: {
  trigger: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useShake<HTMLDivElement>(trigger);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

// The same shake for one element (Input and Select take `shake`).
export function useShake<T extends HTMLElement>(trigger: number) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!trigger || !ref.current || reducedMotion()) return;
    ref.current.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-6px)" },
        { transform: "translateX(5px)" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [trigger]);
  return ref;
}

// Shows one of several icons; changing it blurs the old one away as the
// new one comes in, so the swap reads as a morph.
export function SwapIcon({
  show,
  icons,
}: {
  show: string;
  icons: Record<string, ReactNode>;
}) {
  return (
    <span className="inline-grid place-items-center" aria-hidden>
      {Object.entries(icons).map(([key, icon]) => (
        <span
          key={key}
          className="swap-icon col-start-1 row-start-1 inline-flex"
          data-on={key === show}
        >
          {icon}
        </span>
      ))}
    </span>
  );
}

// A section that opens and closes. Native <details>; its height animates
// where the browser supports interpolate-size (see styles.css).
export function Accordion({
  title,
  aside,
  open = true,
  className = "",
  summaryClassName = "",
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  open?: boolean;
  className?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  return (
    <details className={`accordion ${className}`} open={open}>
      <summary
        className={`flex select-none items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${summaryClassName}`}
      >
        <ChevronRight
          {...ICON}
          size={14}
          className="accordion-chevron shrink-0 text-faint"
        />
        <span className="min-w-0 flex-1">{title}</span>
        {aside}
      </summary>
      {children}
    </details>
  );
}

// A row that scrolls sideways and fades out on the side with more to see.
export function ScrollFade({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<"none" | "left" | "right" | "both">("none");
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const left = element.scrollLeft > 1;
      const right =
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setMore(
        left && right ? "both" : left ? "left" : right ? "right" : "none",
      );
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      data-more={more}
      className={`scroll-fade overflow-x-auto ${className}`}
    >
      {children}
    </div>
  );
}

// Tooltips: the first waits a moment; while one was just showing, the next
// appears at once (and without the entrance), so moving along feels quick.
const FIRST_DELAY_MS = 500;
const WARM_MS = 800;
let lastHidden = 0;
let showing = 0;

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const [state, setState] = useState<"hidden" | "settle" | "instant">("hidden");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = useRef(false);

  const show = () => {
    clearTimeout(timer.current);
    const warm = showing > 0 || Date.now() - lastHidden < WARM_MS;
    const open = () => {
      if (!visible.current) showing += 1;
      visible.current = true;
      setState(warm ? "instant" : "settle");
    };
    if (warm) open();
    else timer.current = setTimeout(open, FIRST_DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (visible.current) {
      visible.current = false;
      showing -= 1;
      lastHidden = Date.now();
    }
    setState("hidden");
  };
  useEffect(() => () => hide(), []);

  return (
    <span
      className="relative inline-flex"
      aria-describedby={state === "hidden" ? undefined : id}
      onPointerEnter={(event) => event.pointerType === "mouse" && show()}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {state !== "hidden" && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-xs font-medium text-ink shadow-pop ${state === "settle" ? "animate-settle" : ""}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
