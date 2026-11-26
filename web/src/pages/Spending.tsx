import { ChevronLeft, ChevronRight, CreditCard, Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ICON } from "../components/icons";
import { Shake } from "../components/motion";
import { Empty, PageHeader, StatTile, errorText } from "../components/page";
import { Button, Card, Input, Notice } from "../components/ui";
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
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-text">
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
                  variant="ghost"
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
                    variant="ghost"
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

const STATUS: Record<string, string> = {
  logged: "Logged",
  auto_zero: "No reply (S$0)",
  auto: "Recorded automatically",
  pending: "Waiting",
};

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

// A round top for the y-axis: S$10, 20, 50, 100, 200…
function niceMax(cents: number): number {
  const dollars = Math.max(cents / 100, 10);
  const magnitude = 10 ** Math.floor(Math.log10(dollars));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= dollars)!;
  return step * magnitude * 100;
}

// Daily totals as columns: one series, thin bars (at most 24 px, 4 px round
// tops on the baseline, 2 px gaps), recessive gridlines, and a tooltip on
// hover or keyboard focus. Every value is also in the table below.
function DailyChart({
  days,
  onPick,
}: {
  days: SpendingDay[];
  onPick: (date: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...days.map((day) => day.cents ?? 0)));
  const grid = [max, max / 2, 0];
  const point = active === null ? null : days[active];

  return (
    <div className="relative">
      <div className="flex gap-2">
        {/* Y axis labels */}
        <div className="flex h-48 flex-col justify-between text-right text-[10px] tabular-nums text-faint">
          {grid.map((value) => (
            <span
              key={value}
              className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0"
            >
              S${(value / 100).toFixed(0)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* Gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-48 flex-col justify-between">
            {grid.map((value) => (
              <span
                key={value}
                className={`block h-px ${value === 0 ? "bg-line-strong" : "bg-line"}`}
              />
            ))}
          </div>
          {/* Columns */}
          <div
            className="relative flex h-48 items-end gap-[2px]"
            onPointerLeave={() => setActive(null)}
          >
            {days.map((day, index) => {
              const height =
                day.cents && max ? Math.max((day.cents / max) * 100, 1.5) : 0;
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
                  onPointerEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  onClick={() => onPick(day.date)}
                  // The hit area is the whole day slot, not just the bar.
                  className="group flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:bg-hover disabled:cursor-default"
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] bg-chart-spend transition-[filter,transform] duration-150 ease-out ${
                      active === index ? "brightness-110" : ""
                    }`}
                    style={{ height: `${height}%` }}
                  />
                </button>
              );
            })}
          </div>
          {/* Day numbers: every few days, so they never collide */}
          <div className="mt-1 flex gap-[2px] text-[10px] tabular-nums text-faint">
            {days.map((day, index) => (
              <span key={day.date} className="min-w-0 flex-1 text-center">
                {index === 0 || (index + 1) % 5 === 0
                  ? Number(day.date.slice(8))
                  : ""}
              </span>
            ))}
          </div>
          {point && !point.future && (
            <div
              role="status"
              // Just above the hovered bar (the bars area is 12rem tall).
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-raised px-2.5 py-1.5 shadow-pop"
              style={{
                left: `${((active! + 0.5) / days.length) * 100}%`,
                top: `calc(${1 - Math.min((point.cents ?? 0) / max, 1)} * 12rem - 8px)`,
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
      </div>
    </div>
  );
}

function EditDay({
  date,
  payments,
  onChanged,
}: {
  date: string;
  payments: ApplePayPayment[];
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [refused, setRefused] = useState(0);
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
    <div className="animate-settle rounded-xl bg-sunken p-3">
      <p className="text-sm font-medium">
        {formatDay(date, { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <Shake trigger={refused} className="mt-2 flex gap-2">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 5.40 3"
          inputMode="decimal"
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

export function SpendingPage() {
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [data, setData] = useState<SpendingMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

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

  const difference = data ? data.totalCents - data.previousTotalCents : 0;
  const slide =
    direction === "right"
      ? "animate-slide-from-right"
      : direction === "left"
        ? "animate-slide-from-left"
        : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spending"
        description="Your daily totals, as logged on Telegram or here."
        actions={
          <>
            <Button
              variant="secondary"
              aria-label="Previous month"
              onClick={() => go(-1)}
            >
              <ChevronLeft {...ICON} />
            </Button>
            <span className="grid min-w-36 place-items-center text-sm font-semibold">
              {data?.label ?? "…"}
            </span>
            <Button
              variant="secondary"
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => go(1)}
            >
              <ChevronRight {...ICON} />
            </Button>
          </>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {data && (
        <div key={month} className={`space-y-6 ${slide}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Total"
              value={formatMoney(data.totalCents)}
              hint={
                data.previousTotalCents > 0
                  ? `${formatMoney(Math.abs(difference))} ${difference >= 0 ? "more" : "less"} than last month`
                  : undefined
              }
            />
            <StatTile
              label="Daily average"
              value={
                data.averageCents === null
                  ? "—"
                  : formatMoney(data.averageCents)
              }
              hint={`over ${data.recordedDays} logged day${data.recordedDays === 1 ? "" : "s"}`}
            />
            <StatTile
              label="Highest day"
              value={data.highest ? formatMoney(data.highest.cents) : "—"}
              hint={
                data.highest
                  ? formatDay(data.highest.date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })
                  : undefined
              }
            />
            <StatTile
              label="Days logged"
              value={`${data.recordedDays}/${data.days.filter((d) => !d.future).length}`}
            />
          </div>

          {data.applePay.some(isWaiting) && (
            <Card
              title="Waiting for your answer"
              description="Bank payments aren't counted until you say so. Send the S$ amount of a foreign payment on Telegram."
            >
              <div className="px-5 py-4">
                <PaymentList
                  payments={data.applePay.filter(isWaiting)}
                  onChanged={load}
                  showDate
                />
              </div>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <Card title="Daily spending" description="Tap a day to change it.">
              <div className="px-5 pb-4 pt-14">
                {data.recordedDays === 0 ? (
                  <Empty>Nothing logged this month.</Empty>
                ) : (
                  <DailyChart days={data.days} onPick={setEditing} />
                )}
                {editing && (
                  <div className="mt-4">
                    <EditDay
                      key={editing}
                      date={editing}
                      payments={data.applePay.filter((p) => p.date === editing)}
                      onChanged={load}
                    />
                  </div>
                )}
              </div>
            </Card>
            <Card title="By week">
              <ul className="divide-y divide-line">
                {data.weeks.map((week) => (
                  <li
                    key={week.start}
                    className="flex items-baseline justify-between px-5 py-2.5 text-sm"
                  >
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
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card
            title="Day by day"
            description="Days can be changed for up to 365 days back."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-brand-text">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2 font-semibold">Day</th>
                    <th className="px-5 py-2 text-right font-semibold">
                      Total
                    </th>
                    <th className="px-5 py-2 font-semibold">Status</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.days
                    .filter((day) => !day.future)
                    .reverse()
                    .map((day) => (
                      <tr
                        key={day.date}
                        className={editing === day.date ? "bg-brand-soft" : ""}
                      >
                        <td className="px-5 py-2">
                          {formatDay(day.date, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td className="px-5 py-2 text-right font-medium tabular-nums">
                          {day.cents === null ? "—" : formatMoney(day.cents)}
                          {(() => {
                            const automatic = data.applePay
                              .filter(
                                (p) =>
                                  p.date === day.date && p.status === "counted",
                              )
                              .reduce((sum, p) => sum + (p.cents ?? 0), 0);
                            return automatic > 0 ? (
                              <span className="block text-xs font-normal text-muted">
                                {formatMoney(automatic)} automatic
                              </span>
                            ) : null;
                          })()}
                        </td>
                        <td className="px-5 py-2 text-muted">
                          {day.status
                            ? (STATUS[day.status] ?? day.status)
                            : "Not logged"}
                        </td>
                        <td className="px-5 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setEditing(editing === day.date ? null : day.date)
                            }
                          >
                            {editing === day.date ? "Close" : "Edit"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      <p className="text-xs text-muted">
        <a
          href="/api/web/export/spending.csv"
          className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
        >
          <Download {...ICON} size={14} />
          Download all spending (CSV)
        </a>
      </p>
    </div>
  );
}
