import { AnimatePresence, m } from "motion/react";
import { CircleAlert, CircleCheck, Undo2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ICON } from "./icons";
import { DUR, EASE_IN, EASE_OUT, SPRING } from "./motion";
import { errorText } from "./page";

// Toasts and undo (web/DESIGN.md §4). A reversible change happens on screen
// at once and is sent to the server only when its toast closes, so Undo
// needs nothing from the server. Pending changes are sent straight away if
// the page is closed.

type Tone = "ok" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: Tone;
  duration: number;
  undo?: () => void;
  onExpire?: () => void;
}

interface Pending {
  hide: () => void;
  restore: () => void;
  commit: () => Promise<unknown>;
  onDone?: () => void;
}

interface Feedback {
  show: (toast: {
    message: string;
    tone?: Tone;
    duration?: number;
    undo?: () => void;
    onExpire?: () => void;
  }) => void;
  // Hides something now, offers Undo, and commits when the toast closes.
  defer: (message: string, change: Pending) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("FeedbackProvider is missing");
  return context;
}

const ICONS = { ok: CircleCheck, error: CircleAlert, info: CircleCheck };

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const pending = useRef(new Map<number, Pending>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show: Feedback["show"] = useCallback((toast) => {
    const id = next.current++;
    setToasts((list) =>
      [...list, { id, tone: "ok" as Tone, duration: 5000, ...toast }].slice(-3),
    );
    return id;
  }, []);

  const commit = useCallback(
    (id: number) => {
      const change = pending.current.get(id);
      if (!change) return;
      pending.current.delete(id);
      change
        .commit()
        .then(() => change.onDone?.())
        .catch((failure) => {
          change.restore();
          show({ message: errorText(failure), tone: "error", duration: 7000 });
        });
    },
    [show],
  );

  const defer: Feedback["defer"] = useCallback(
    (message, change) => {
      change.hide();
      const id = next.current;
      pending.current.set(id, change);
      show({
        message,
        tone: "ok",
        duration: 5000,
        undo: () => {
          pending.current.delete(id);
          change.restore();
        },
        onExpire: () => commit(id),
      });
    },
    [commit, show],
  );

  // Closing or reloading the page sends what is still waiting.
  useEffect(() => {
    const flush = () => {
      for (const id of [...pending.current.keys()]) commit(id);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commit]);

  const value = useMemo(() => ({ show, defer }), [show, defer]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastView
              key={toast.id}
              toast={toast}
              onClose={(expired) => {
                dismiss(toast.id);
                if (expired) toast.onExpire?.();
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </FeedbackContext.Provider>
  );
}

function ToastView({
  toast,
  onClose,
}: {
  toast: Toast;
  onClose: (expired: boolean) => void;
}) {
  const Icon = ICONS[toast.tone];
  const closed = useRef(false);
  const close = (expired: boolean) => {
    if (closed.current) return;
    closed.current = true;
    onClose(expired);
  };
  return (
    <m.div
      layout
      role={toast.tone === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: DUR.base, ease: EASE_OUT },
      }}
      exit={{
        opacity: 0,
        scale: 0.98,
        transition: { duration: DUR.fast, ease: EASE_IN },
      }}
      transition={SPRING.snap}
      // Hovering or focusing the toast pauses its countdown.
      className="group pointer-events-auto relative flex w-full max-w-sm items-center gap-2.5 overflow-hidden rounded-xl bg-ink py-2 pr-2 pl-3.5 text-sm text-canvas shadow-pop"
    >
      <Icon
        {...ICON}
        className={`shrink-0 ${toast.tone === "error" ? "text-danger-soft" : "opacity-80"}`}
      />
      <span className="min-w-0 flex-1 py-1">{toast.message}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            close(false);
          }}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 font-semibold text-now transition-[background-color,transform] duration-[var(--dur-fast)] hover:bg-canvas/10 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          <Undo2 {...ICON} size={15} />
          Undo
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => close(true)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg opacity-70 transition-[background-color,opacity] duration-[var(--dur-fast)] hover:bg-canvas/10 hover:opacity-100"
      >
        <X {...ICON} size={15} />
      </button>
      {/* The countdown: when this bar finishes shrinking, the toast closes
          and any waiting change is sent. */}
      <span
        aria-hidden
        onAnimationEnd={() => close(true)}
        style={{ animationDuration: `${toast.duration}ms` }}
        className="toast-countdown absolute inset-x-0 bottom-0 h-0.5 origin-left bg-canvas/35 group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused]"
      />
    </m.div>
  );
}

// Rows that can be ticked off or deleted with Undo. `remove` marks the row
// (ticked), holds it for `holdMs` so the tick is seen, then hides it and
// shows the Undo toast; the server change is sent when the toast closes.
export function useRemovable<K extends string | number>() {
  const { defer } = useFeedback();
  const [ticked, setTicked] = useState<Set<K>>(new Set());
  const [hidden, setHidden] = useState<Set<K>>(new Set());
  const edit = (set: typeof setTicked, key: K, on: boolean) =>
    set((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const remove = (
    key: K,
    message: string,
    commit: () => Promise<unknown>,
    { holdMs = 0, onDone }: { holdMs?: number; onDone?: () => void } = {},
  ) => {
    if (holdMs) edit(setTicked, key, true);
    window.setTimeout(() => {
      defer(message, {
        hide: () => edit(setHidden, key, true),
        restore: () => {
          edit(setHidden, key, false);
          edit(setTicked, key, false);
        },
        commit,
        onDone,
      });
    }, holdMs);
  };

  return {
    isTicked: (key: K) => ticked.has(key),
    isHidden: (key: K) => hidden.has(key),
    remove,
  };
}
