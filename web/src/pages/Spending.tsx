import {
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Flame,
  Gauge,
  CircleCheck,
  CircleDashed,
  Clock,
  Minus,
  Plus,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ICON } from "../components/icons";
import { Shake } from "../components/motion";
import {
  EmptyState,
  LoadError,
  Metric,
  Skeleton,
  errorText,
} from "../components/page";
import {
  Badge,
  Button,
  Input,
  Notice,
  Panel,
  type Tone,
} from "../components/ui";
import { formatDay, formatMoney, todayIso } from "../dates";

interface SpendingDay {
  date: string;
  cents: number | null;
  status: string | null;
  future: boolean;
}

interface SpendingMonth {
  month: string;
  label: string;
  days: SpendingDay[];
  totalCents: number;
  recordedDays: number;
  averageCents: number | null;
  highest: { date: string; cents: number } | null;
  weeks: Array<{ start: string; end: string; cents: number }>;
  previousTotalCents: number;
  applePay: ApplePayPayment[];
}

interface ApplePayPayment {
  id: number;
  date: string;
  time: string;
  merchant: string;
  card: string;
  amountText: string;
  cents: number | null;
  // counted, undone, awaiting_sgd, awaiting_ok, skipped
  status: string;
  source: "applepay" | "email";
  // For bank emails: "PayLah! Scan & Pay", "PayNow", ...
  kind: string;
  readByAi: boolean;
}

const PAYMENT_STATUS: Record<string, string> = {
  undone: "Undone",
  awaiting_sgd: "Waiting for the S$ amount",
  awaiting_ok: "Waiting for your answer",
  skipped: "Skipped",
};

const isWaiting = (payment: ApplePayPayment) =>
  payment.status === "awaiting_ok" || payment.status === "awaiting_sgd";

// Payments recorded automatically (Apple Pay, bank emails): Undo while one
// counts; Count it or Skip while a bank payment waits for an answer.
function PaymentList({
  title,
  payments,
  onChanged,
  showDate = false,
}: {
  title?: string;
  payments: ApplePayPayment[];
  onChanged: () => void;
  // The waiting list across the month: the date goes under the name.
  showDate?: boolean;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (payments.length === 0) return null;

  const act = async (payment: ApplePayPayment, path: string) => {
    setBusy(payment.id);
    setError(null);
    try {
      await api(path, { method: "POST" });
      onChanged();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {title && (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted">
          <CreditCard {...ICON} size={14} />
          {title}
        </p>
      )}
      <ul className="divide-y divide-line rounded-lg bg-surface">
        {payments.map((payment) => {
          const counted = payment.status === "counted";
          const waiting = isWaiting(payment);
          const via =
            payment.source === "email"
              ? payment.kind || "Bank email"
              : "Apple Pay";
          return (
            <li
              key={payment.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm"
            >
              {!showDate && (
                <span className="shrink-0 tabular-nums text-muted">
                  {payment.time}
                </span>
              )}
              <span className="min-w-0 flex-1 basis-48 break-words">
                <span
                  className={
                    counted || waiting
                      ? "font-medium"
                      : "text-muted line-through"
                  }
                >
                  {payment.merchant || via}
                </span>
                <span
                  className={`text-xs text-muted ${showDate ? "block" : "ml-1.5"}`}
                >
                  {[
                    showDate &&
                      `${formatDay(payment.date, { day: "numeric", month: "short" })}, ${payment.time}`,
                    payment.merchant && via,
                    payment.card,
                    payment.readByAi && "read by AI",
                    // The waiting list's title already says it's waiting.
                    !counted &&
                      !showDate &&
                      (PAYMENT_STATUS[payment.status] ?? payment.status),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="tabular-nums">
                {payment.cents !== null
                  ? formatMoney(payment.cents)
                  : payment.amountText}
              </span>
              {counted && (
                <Button
                  variant="quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(payment, `applepay/${payment.id}/undo`)
                  }
                >
                  Undo
                </Button>
              )}
              {waiting && (
                <span className="ml-auto flex gap-1.5">
                  {payment.status === "awaiting_ok" && (
                    <Button
                      disabled={busy !== null}
                      onClick={() =>
                        void act(payment, `payments/${payment.id}/count`)
                      }
                    >
                      Count it
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(payment, `payments/${payment.id}/skip`)
                    }
                  >
                    Skip
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

// Each day's status: an icon and a word. Nothing logged isn't an error, so
// it stays neutral; only "waiting for your reply" asks for attention.
const STATUS: Record<
  string,
  { label: string; tone: Tone; icon: LucideIcon; help: string }
> = {
  logged: {
    label: "Logged",
    tone: "ok",
    icon: CircleCheck,
    help: "You logged this day.",
  },
  pending: {
    label: "Waiting",
    tone: "warn",
    icon: Clock,
    help: "Waiting for your reply to the 11:30pm check-in.",
  },
  auto_zero: {
    label: "No reply",
    tone: "neutral",
    icon: Minus,
    help: "No reply to the check-in, so it counts as S$0.",
  },
  auto: {
    label: "No reply",
    tone: "neutral",
    icon: Minus,
    help: "No reply to the check-in; only the payments the bot recorded count.",
  },
};
const NOT_LOGGED = {
  label: "Not logged",
  tone: "neutral" as Tone,
  icon: CircleDashed,
  help: "Nothing was logged for this day.",
};

function StatusPill({ status }: { status: string | null }) {
  const info = status ? (STATUS[status] ?? NOT_LOGGED) : NOT_LOGGED;
  return (
    <span title={info.help}>
      <Badge tone={info.tone} icon={info.icon}>
        {info.label}
      </Badge>
    </span>
  );
}

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString("en-SG", {
    month: "long",
    timeZone: "UTC",
  });
}

const dollars = (cents: number) =>
  `S$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

// A round top and step for the y-axis, with three or four gridlines, so
// the tallest bar fills most of the height: S$10 by 5, S$60 by 20, …
function niceScale(maxCents: number): { top: number; step: number } {
  const most = Math.max(maxCents / 100, 10);
  const rough = most / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10]
    .map((s) => s * magnitude)
    .find((s) => s >= rough)!;
  return { top: Math.ceil(most / step) * step * 100, step: step * 100 };
}

// Month-so-far spending as a tiny line (the Total card).
function Sparkline({ days }: { days: SpendingDay[] }) {
  const past = days.filter((day) => !day.future);
  if (past.length < 2) return null;
  let running = 0;
  const totals = past.map((day) => (running += day.cents ?? 0));
  const top = Math.max(running, 1);
  const points = totals
    .map(
      (total, index) =>
        `${((index / (past.length - 1)) * 64).toFixed(1)},${(22 - (total / top) * 20).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      width="64"
      height="24"
      viewBox="0 0 64 24"
      aria-hidden="true"
      // Left out on phones, where the label needs the room.
      className="hidden shrink-0 overflow-visible sm:block"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-focus)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const quietIcon = (Icon: typeof Gauge) => (
  <Icon {...ICON} size={16} className="shrink-0 text-faint" aria-hidden />
);

// Daily totals as columns: quiet orange bars, the hovered, focused or
// selected one in full orange, three or four faint gridlines, a dashed
// line at the daily average, and a tooltip. Every value is also in the
// table below. Bars are buttons, so the keyboard reaches each day.
function DailyChart({
  days,
  averageCents,
  selected,
  onPick,
}: {
  days: SpendingDay[];
  averageCents: number | null;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const { top, step } = niceScale(
    Math.max(0, ...days.map((day) => day.cents ?? 0)),
  );
  const ticks: number[] = [];
  for (let value = top; value >= 0; value -= step) ticks.push(value);
  const point = active === null ? null : days[active];
  const share = (cents: number) => Math.min(cents / top, 1);
  const place = active === null ? 0.5 : (active + 0.5) / days.length;

  return (
    <div className="relative pt-12">
      <div className="flex gap-2">
        {/* Y axis labels */}
        <div className="flex h-44 flex-col justify-between text-right text-[11px] tabular-nums text-muted">
          {ticks.map((value) => (
            <span
              key={value}
              className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0"
            >
              {dollars(value)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* Gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-44 flex-col justify-between">
            {ticks.map((value) => (
              <span
                key={value}
                className={`block h-px ${value === 0 ? "bg-line-strong" : "bg-line"}`}
              />
            ))}
          </div>
          {/* The daily average */}
          {averageCents !== null && averageCents > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-muted/60"
              style={{ top: `calc(${1 - share(averageCents)} * 11rem)` }}
            >
              <span className="absolute -top-2 right-0 -translate-y-full rounded bg-surface px-1 text-[11px] tabular-nums text-muted">
                Avg {formatMoney(averageCents)}
              </span>
            </div>
          )}
          {/* Columns */}
          <div
            className="relative flex h-44 items-end gap-[3px]"
            onPointerLeave={() => setActive(null)}
          >
            {days.map((day, index) => {
              const height = day.cents
                ? Math.max(share(day.cents) * 100, 1.5)
                : 0;
              const lit = active === index || selected === day.date;
              const label = `${formatDay(day.date, { weekday: "short", day: "numeric", month: "short" })}: ${
                day.future
                  ? "not yet"
                  : day.cents === null
                    ? "nothing logged"
                    : formatMoney(day.cents)
              }`;
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={day.future}
                  aria-label={label}
                  aria-pressed={selected === day.date}
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  onClick={() => onPick(day.date)}
                  // The hit area is the whole day slot, not just the bar.
                  className="flex h-full min-w-0 flex-1 items-end justify-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
                >
                  {/* Grows from the baseline when the month appears
                      (transform only); the colour change is instant. */}
                  <span
                    className={`bar-grow block w-full max-w-[18px] origin-bottom rounded-t-[3px] ${
                      lit ? "bg-chart-focus" : "bg-chart-bar"
                    }`}
                    style={{ height: `${height}%` }}
                  />
                </button>
              );
            })}
          </div>
          {/* Day numbers, weekly, so they never crowd */}
          <div className="mt-1.5 flex gap-[3px] text-[11px] tabular-nums text-muted">
            {days.map((day, index) => (
              <span key={day.date} className="min-w-0 flex-1 text-center">
                {index % 7 === 0 ? Number(day.date.slice(8)) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      {point && !point.future && (
        <div
          role="status"
          // Above the bar, kept inside the card at the top and the sides.
          className={`pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 shadow-pop ${
            place < 0.15
              ? "-translate-x-[15%]"
              : place > 0.85
                ? "-translate-x-[85%]"
                : "-translate-x-1/2"
          } -translate-y-full`}
          style={{
            left: `calc(2.75rem + (100% - 2.75rem) * ${place})`,
            top: `max(2.9rem, calc(3rem + ${1 - share(point.cents ?? 0)} * 11rem - 8px))`,
          }}
        >
          <p className="text-sm font-semibold tabular-nums">
            {point.cents === null ? "—" : formatMoney(point.cents)}
          </p>
          <p className="text-xs text-muted">
            {formatDay(point.date, {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
            {point.cents === null ? " · nothing logged" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function EditDay({
  date,
  payments,
  focus,
  onChanged,
}: {
  date: string;
  payments: ApplePayPayment[];
  // Opened with Add expense: put the cursor in the amount box.
  focus: boolean;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [refused, setRefused] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // Opened from the table further down: bring the editor into view.
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    box.current?.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, []);
  const send = async (mode: "add" | "remove") => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await api<{ message: string }>("spending", {
        method: "POST",
        body: { date, amount, mode },
      });
      setStatus({ tone: "ok", text: result.message });
      setAmount("");
      onChanged();
    } catch (failure) {
      setStatus({ tone: "error", text: errorText(failure) });
      setRefused((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={box}
      className="animate-settle scroll-m-6 rounded-xl border border-line bg-sunken p-3 sm:p-4"
    >
      <label htmlFor="spend-amount" className="text-sm font-medium">
        {formatDay(date, { weekday: "long", day: "numeric", month: "long" })}
      </label>
      <Shake trigger={refused} className="mt-2 flex gap-2">
        <Input
          id="spend-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 5.40 3"
          inputMode="decimal"
          autoFocus={focus}
          invalid={status?.tone === "error"}
          className="min-w-0 flex-1"
        />
        <Button disabled={busy || !amount} onClick={() => void send("add")}>
          Add
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !amount}
          onClick={() => void send("remove")}
        >
          Remove
        </Button>
      </Shake>
      {status && <Notice tone={status.tone}>{status.text}</Notice>}
      <div className="mt-3">
        <PaymentList
          title="Recorded automatically"
          payments={payments}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

function MonthPicker({
  label,
  canGoForward,
  onGo,
}: {
  label: string;
  canGoForward: boolean;
  onGo: (by: number) => void;
}) {
  const arrow =
    "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-[transform,background-color,color] duration-[var(--dur-fast)] ease-out hover:bg-hover hover:text-ink active:scale-[0.97] disabled:cursor-not-allowed disabled:text-faint disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100 [@media(pointer:fine)]:h-8 [@media(pointer:fine)]:w-8";
  return (
    // 8 px outer corners, 2 px padding → 6 px buttons.
    <div className="inline-flex items-center rounded-lg border border-line bg-surface p-0.5">
      <button
        type="button"
        className={arrow}
        aria-label="Previous month"
        onClick={() => onGo(-1)}
      >
        <ChevronLeft {...ICON} />
      </button>
      <span
        aria-live="polite"
        className="min-w-[8.5rem] px-1 text-center text-sm font-medium tabular-nums"
      >
        {label}
      </span>
      <button
        type="button"
        className={arrow}
        aria-label="Next month"
        disabled={!canGoForward}
        onClick={() => onGo(1)}
      >
        <ChevronRight {...ICON} />
      </button>
    </div>
  );
}

const weekdayContext = (date: string, today: string): string => {
  if (date === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return formatDay(date, { weekday: "long" });
};

export function SpendingPage() {
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [data, setData] = useState<SpendingMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped by Add expense, so the editor re-opens with the cursor in it.
  const [focusRequest, setFocusRequest] = useState(0);

  const load = useCallback(() => {
    api<SpendingMonth>(`spending/${month}`)
      .then((view) => {
        setData(view);
        setError(null);
      })
      .catch((failure) => setError(errorText(failure)));
  }, [month]);
  useEffect(load, [load]);

  const go = (by: number) => {
    setDirection(by > 0 ? "right" : "left");
    setEditing(null);
    setMonth((current) => shiftMonth(current, by));
  };

  // Add expense: today's editor, in this month.
  const addExpense = () => {
    if (month !== thisMonth) {
      setDirection("right");
      setMonth(thisMonth);
    }
    setEditing(today);
    setFocusRequest((count) => count + 1);
  };

  const toggle = (date: string) => {
    setFocusRequest(0);
    setEditing((current) => (current === date ? null : date));
  };

  const slide =
    direction === "right"
      ? "animate-slide-from-right"
      : direction === "left"
        ? "animate-slide-from-left"
        : "";

  const previousName = monthName(shiftMonth(month, -1));
  const pastDays = data ? data.days.filter((day) => !day.future) : [];
  const isThisMonth = month === thisMonth;
  const biggestWeek = data ? Math.max(1, ...data.weeks.map((w) => w.cents)) : 1;

  const totalDetail = () => {
    if (!data) return null;
    if (data.previousTotalCents <= 0) {
      return `Nothing logged in ${previousName}`;
    }
    const difference = data.totalCents - data.previousTotalCents;
    if (difference === 0) return `Same as ${previousName}`;
    const percent = Math.round(
      (Math.abs(difference) / data.previousTotalCents) * 100,
    );
    const Arrow = difference < 0 ? ArrowDown : ArrowUp;
    return (
      <span className="inline-flex items-center gap-1">
        <Arrow {...ICON} size={13} aria-hidden />
        <span>
          <span className="sr-only">{difference < 0 ? "Down" : "Up"} </span>
          {percent}% from {previousName}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.015em] md:text-[28px]">
            Spending
          </h1>
          <p className="mt-1 text-sm text-muted">
            Daily totals, as logged on Telegram or recorded automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <MonthPicker
            label={data?.month === month ? data.label : "…"}
            canGoForward={month < thisMonth}
            onGo={go}
          />
          <Button onClick={addExpense}>
            <Plus {...ICON} strokeWidth={2} />
            Add expense
          </Button>
        </div>
      </header>

      {error && <LoadError message={error} onRetry={load} />}
      {!data && !error && (
        <div aria-busy="true" className="space-y-5">
          <span className="sr-only" role="status">
            Loading spending…
          </span>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}
      {data && (
        <div key={month} className={`space-y-5 ${slide}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Total spent"
              value={formatMoney(data.totalCents)}
              detail={totalDetail()}
              aside={<Sparkline days={data.days} />}
            />
            <Metric
              label="Daily average"
              value={
                data.averageCents === null
                  ? "—"
                  : formatMoney(data.averageCents)
              }
              detail={`Over ${data.recordedDays} logged day${data.recordedDays === 1 ? "" : "s"}`}
              aside={quietIcon(Gauge)}
            />
            <Metric
              label="Highest day"
              value={data.highest ? formatMoney(data.highest.cents) : "—"}
              detail={
                data.highest
                  ? formatDay(data.highest.date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })
                  : "Nothing logged yet"
              }
              aside={quietIcon(Flame)}
            />
            {isThisMonth && data.averageCents !== null ? (
              <Metric
                label="Projected total"
                value={formatMoney(data.averageCents * data.days.length)}
                detail={`At this pace · ${data.recordedDays}/${pastDays.length} days logged`}
                aside={quietIcon(TrendingUp)}
              />
            ) : (
              <Metric
                label="Days logged"
                value={`${data.recordedDays}/${pastDays.length}`}
                detail={
                  data.recordedDays >= pastDays.length
                    ? "Every day logged"
                    : `${pastDays.length - data.recordedDays} not logged`
                }
                aside={quietIcon(CalendarCheck)}
              />
            )}
          </div>

          {data.applePay.some(isWaiting) && (
            <Panel
              title="Waiting for your answer"
              description="Bank payments aren't counted until you say so. Send the S$ amount of a foreign payment on Telegram."
            >
              <div className="px-5 pb-4">
                <PaymentList
                  payments={data.applePay.filter(isWaiting)}
                  onChanged={load}
                  showDate
                />
              </div>
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <Panel title="Daily spending" description="Tap a day to change it.">
              <div className="px-5 pb-4">
                {data.recordedDays === 0 ? (
                  <EmptyState icon={Wallet} title="Nothing logged this month">
                    Reply to the bot's 11:30pm check-in, or tap Add expense.
                  </EmptyState>
                ) : (
                  <DailyChart
                    days={data.days}
                    averageCents={data.averageCents}
                    selected={editing}
                    onPick={toggle}
                  />
                )}
                {editing && (
                  <div className="mt-4">
                    <EditDay
                      key={`${editing}-${focusRequest}`}
                      date={editing}
                      focus={focusRequest > 0}
                      payments={data.applePay.filter((p) => p.date === editing)}
                      onChanged={load}
                    />
                  </div>
                )}
              </div>
            </Panel>
            {data.weeks.some((week) => week.cents > 0) && (
              <Panel title="By week">
                <ul className="px-5 pb-3">
                  {data.weeks.map((week) => (
                    <li key={week.start} className="py-2">
                      <div className="flex items-baseline justify-between gap-3 text-[15px]">
                        <span className="text-muted">
                          {formatDay(week.start, {
                            day: "numeric",
                            month: "short",
                          })}
                          {week.end !== week.start &&
                            ` – ${formatDay(week.end, { day: "numeric", month: "short" })}`}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatMoney(week.cents)}
                        </span>
                      </div>
                      {/* Each week's share of the biggest week. */}
                      <div
                        aria-hidden="true"
                        className="mt-1.5 h-1 overflow-hidden rounded-full bg-hover"
                      >
                        <div
                          className="h-full origin-left rounded-full bg-chart-focus"
                          style={{
                            transform: `scaleX(${week.cents / biggestWeek})`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <Panel
            title="Day by day"
            description="Days can be changed for up to 365 days back."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="text-left text-xs font-medium uppercase tracking-[0.06em] text-muted">
                  <tr className="border-y border-line">
                    <th className="py-2 pl-5 pr-3 font-medium">Day</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="py-2 pl-3 pr-4">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pastDays
                    .slice()
                    .reverse()
                    .map((day) => {
                      const open = editing === day.date;
                      const waiting = data.applePay.filter(
                        (p) => p.date === day.date && isWaiting(p),
                      ).length;
                      return (
                        <tr
                          key={day.date}
                          onClick={() => toggle(day.date)}
                          className={`group cursor-pointer ${open ? "bg-accent-soft" : "hover:bg-hover"}`}
                        >
                          <td className="py-3 pl-5 pr-3">
                            <p className="font-medium leading-snug text-ink">
                              {formatDay(day.date, {
                                day: "numeric",
                                month: "short",
                              })}
                            </p>
                            <p className="text-[13px] leading-snug text-muted">
                              {weekdayContext(day.date, today)}
                              {waiting > 0 &&
                                ` · ${waiting} payment${waiting === 1 ? "" : "s"} waiting`}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums">
                            {day.cents === null ? "—" : formatMoney(day.cents)}
                          </td>
                          <td className="px-3 py-3">
                            <StatusPill status={day.status} />
                          </td>
                          <td className="py-2 pl-3 pr-4 text-right">
                            <Button
                              variant="quiet"
                              aria-expanded={open}
                              aria-label={`${open ? "Close" : "Edit"} ${formatDay(day.date, { day: "numeric", month: "long" })}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggle(day.date);
                              }}
                              // Shown on hover or focus where there is a
                              // pointer; always shown on touch screens.
                              className={
                                open
                                  ? ""
                                  : "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                              }
                            >
                              {open ? "Close" : "Edit"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
      <p className="text-xs text-muted">
        <a
          href="/api/web/export/spending.csv"
          className="inline-flex h-9 items-center gap-1 rounded font-medium text-accent-text hover:underline"
        >
          <Download {...ICON} size={14} />
          Download all spending (CSV)
        </a>
      </p>
    </div>
  );
}
