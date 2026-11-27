import { Cake, Check, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ICON } from "./icons";
import { Shake, Tooltip } from "./motion";
import { Empty, errorText } from "./page";
import { Button, Card, FIELD, Notice } from "./ui";

interface Birthday {
  id: string;
  name: string;
  date: string;
  year: number | null;
  next: string;
  daysUntil: number;
  turns: number | null;
}

interface LineCheck {
  birthdays: Array<{ name: string; date: string; year: number | null }>;
  rejected: Array<{ line: number; text: string; reason: string }>;
}

type Status = { tone: "ok" | "error"; text: string } | null;

// Shown at first; the rest behind "Show all".
const FIRST = 8;

function when(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

const PLACEHOLDER = `Alice Tan 14/03
Bob 2 Dec 2004
Charlie, 29 Feb`;

// Tasks → Birthdays: yearly all-day events in Google Calendar, added a
// batch at a time from pasted lines (checked first), each with a reminder.
export function Birthdays() {
  const [list, setList] = useState<{
    configured: boolean;
    birthdays: Birthday[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [check, setCheck] = useState<LineCheck | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [refused, setRefused] = useState(0);

  const load = useCallback(() => {
    api<{ configured: boolean; birthdays: Birthday[] }>("birthdays")
      .then((view) => {
        setList(view);
        setLoadError(null);
      })
      .catch((failure) => setLoadError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await work();
    } catch (failure) {
      setStatus({ tone: "error", text: errorText(failure) });
      setRefused((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  const checkLines = () =>
    run(async () => {
      const result = await api<LineCheck>("birthdays/check", {
        method: "POST",
        body: { text },
      });
      setCheck(result);
      if (result.birthdays.length === 0) setRefused((count) => count + 1);
    });

  const addAll = () =>
    run(async () => {
      const result = await api<{
        message: string;
        rejected: LineCheck["rejected"];
      }>("birthdays", { method: "POST", body: { text } });
      setStatus({ tone: "ok", text: result.message });
      // Keep only the lines that weren't used, to fix and add again.
      setText(result.rejected.map((line) => line.text).join("\n"));
      setCheck(null);
      load();
    });

  const remove = (birthday: Birthday) => {
    if (
      !window.confirm(
        `Remove ${birthday.name}'s birthday from Google Calendar?`,
      )
    )
      return;
    void run(async () => {
      const result = await api<{ message: string }>(
        `birthdays/${birthday.id}`,
        { method: "DELETE" },
      );
      setStatus({ tone: "ok", text: result.message });
      load();
    });
  };

  const birthdays = list?.birthdays ?? [];
  const shown = showAll ? birthdays : birthdays.slice(0, FIRST);

  return (
    <Card
      title="Birthdays"
      description="Each one repeats yearly in Google Calendar, with a reminder at 9am the day before."
    >
      <div className="space-y-4 px-5 py-4">
        {loadError ? (
          <Notice tone="error">{loadError}</Notice>
        ) : list === null ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : !list.configured ? (
          <Notice tone="info">
            Set up Google Calendar in Settings to add birthdays.
          </Notice>
        ) : birthdays.length === 0 ? (
          <Empty>No birthdays yet.</Empty>
        ) : (
          <div>
            <ul className="divide-y divide-line">
              {shown.map((birthday) => (
                <li
                  key={birthday.id}
                  className="flex animate-settle items-center gap-3 py-2.5"
                >
                  <Cake {...ICON} className="shrink-0 text-cat-task" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{birthday.name}</p>
                    <p className="text-xs text-muted">
                      {birthday.date}
                      {birthday.turns !== null && ` · turns ${birthday.turns}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs tabular-nums ${
                      birthday.daysUntil <= 7
                        ? "font-semibold text-accent-text"
                        : "text-muted"
                    }`}
                  >
                    {when(birthday.daysUntil)}
                  </span>
                  <Tooltip label="Remove">
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${birthday.name}'s birthday`}
                      disabled={busy}
                      onClick={() => remove(birthday)}
                    >
                      <Trash2 {...ICON} />
                    </Button>
                  </Tooltip>
                </li>
              ))}
            </ul>
            {birthdays.length > FIRST && (
              <button
                type="button"
                className="mt-1 text-sm font-medium text-accent-text hover:underline"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? "Show fewer" : `Show all ${birthdays.length}`}
              </button>
            )}
          </div>
        )}

        {list?.configured && (
          <Shake trigger={refused}>
            <form
              className="space-y-2 rounded-xl bg-sunken p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void (check ? addAll() : checkLines());
              }}
            >
              <label className="block text-xs text-muted" htmlFor="birthdays">
                One per line: a name and a date, day first. The year is
                optional.
              </label>
              <textarea
                id="birthdays"
                value={text}
                rows={4}
                onChange={(event) => {
                  setText(event.target.value);
                  setCheck(null);
                }}
                placeholder={PLACEHOLDER}
                className={`block w-full resize-y ${FIELD} border-line-strong focus:border-accent focus:ring-accent/20`}
              />

              {check && (
                <div className="animate-settle space-y-1.5 text-sm">
                  {check.birthdays.map((birthday) => (
                    <p
                      key={`${birthday.name}-${birthday.date}`}
                      className="flex items-center gap-2"
                    >
                      <Check {...ICON} size={14} className="shrink-0 text-ok" />
                      <span className="font-medium">{birthday.name}</span>
                      <span className="text-muted">
                        {birthday.date}
                        {birthday.year && ` ${birthday.year}`}
                      </span>
                    </p>
                  ))}
                  {check.rejected.map((line) => (
                    <p key={line.line} className="flex items-start gap-2">
                      <TriangleAlert
                        {...ICON}
                        size={14}
                        className="mt-0.5 shrink-0 text-warn"
                      />
                      <span>
                        <span className="text-muted">
                          Line {line.line} “{line.text}”:
                        </span>{" "}
                        {line.reason}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {check && check.birthdays.length > 0 ? (
                  <>
                    <Button type="submit" disabled={busy}>
                      Add {check.birthdays.length} to Google Calendar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setCheck(null)}
                    >
                      Edit
                    </Button>
                  </>
                ) : (
                  <Button type="submit" disabled={busy || !text.trim()}>
                    Check
                  </Button>
                )}
              </div>
            </form>
          </Shake>
        )}
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Card>
  );
}
