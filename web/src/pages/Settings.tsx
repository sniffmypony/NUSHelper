import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AuditEntry,
  type Me,
  type SecretRow,
  type SettingRow,
  type SettingsResponse,
} from "../api";
import {
  Button,
  Card,
  Input,
  Notice,
  Row,
  SourceBadge,
  formatDate,
} from "../components/ui";
import { SignIn } from "./Login";

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

const SETTING_LABELS: Record<string, string> = {
  LLM_MODEL: "Main AI model",
  LLM_FALLBACK_MODEL: "Backup AI model",
  NUS_MATRICULATION_YEAR: "Matriculation year",
  LLM_API_KEY: "SoCLaaS API key",
  CANVAS_API_TOKEN: "Canvas access token",
  timetable: "NUSMods timetable",
  session: "Sign-in",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function ModelRow({
  setting,
  models,
  onSaved,
}: {
  setting: SettingRow;
  models: string[] | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(setting.value ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => setValue(setting.value ?? ""), [setting.value]);

  const options = [
    ...new Set([...(models ?? []), ...(setting.value ? [setting.value] : [])]),
  ].sort();

  const run = async (work: () => Promise<Status>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await work());
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label={setting.label}
      help={setting.help}
      aside={<SourceBadge source={setting.source} />}
    >
      <div className="flex flex-wrap gap-2">
        {models ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-lg border sm:w-auto sm:min-w-0 sm:flex-1 border-slate-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {!value && <option value="">Choose a model…</option>}
            {options.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="e.g. qwen3.6:35b"
            className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
          />
        )}
        <Button
          disabled={busy || !value || value === setting.value}
          onClick={() =>
            run(async () => {
              await api(`settings/${setting.key}`, {
                method: "PUT",
                body: { value },
              });
              onSaved();
              return {
                tone: "ok",
                text: "Saved. The bot uses it within a minute.",
              };
            })
          }
        >
          Save
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !value}
          onClick={() =>
            run(async () => {
              const result = await api<{
                ok: boolean;
                ms?: number;
                error?: string;
              }>("ai/test", { method: "POST", body: { model: value } });
              return result.ok
                ? { tone: "ok", text: `${value} answered in ${result.ms} ms.` }
                : {
                    tone: "error",
                    text: `${value} didn't answer (${result.error}).`,
                  };
            })
          }
        >
          Test
        </Button>
        {setting.source === "website" && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`settings/${setting.key}`, { method: "DELETE" });
                onSaved();
                return {
                  tone: "info",
                  text: setting.vercelValue
                    ? `Back to Vercel's value (${setting.vercelValue}).`
                    : "Cleared.",
                };
              })
            }
          >
            Use Vercel's
          </Button>
        )}
      </div>
      {status && <Notice tone={status.tone}>{status.text}</Notice>}
    </Row>
  );
}

function KeyRow({
  secret,
  fresh,
  onSaved,
}: {
  secret: SecretRow;
  fresh: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const describe =
    secret.source === "website"
      ? `Saved here · ending ${secret.lastFour} · ${formatDate(secret.updatedAt)}`
      : secret.source === "vercel"
        ? "Using the key set in Vercel."
        : "No key set.";

  const save = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setStatus(null);
    try {
      await api(`secrets/${secret.key}`, {
        method,
        body: method === "PUT" ? { value } : undefined,
      });
      setEditing(false);
      setValue("");
      setStatus({
        tone: "ok",
        text:
          method === "PUT"
            ? "Saved, encrypted. The bot uses it within a minute."
            : "Removed. The bot uses Vercel's key again.",
      });
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label={secret.label}
      help={secret.help}
      aside={<SourceBadge source={secret.source} />}
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">{describe}</p>
      {editing ? (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save("PUT");
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste the new key"
            className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
          />
          <Button type="submit" disabled={busy || !value}>
            Save key
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!fresh}
            onClick={() => setEditing(true)}
          >
            Replace key
          </Button>
          {secret.source === "website" && (
            <Button
              variant="ghost"
              disabled={!fresh || busy}
              onClick={() => void save("DELETE")}
            >
              Use Vercel's
            </Button>
          )}
        </div>
      )}
      {status && <Notice tone={status.tone}>{status.text}</Notice>}
    </Row>
  );
}

function TextSettingRow({
  setting,
  onSaved,
  placeholder,
}: {
  setting: SettingRow;
  onSaved: () => void;
  placeholder: string;
}) {
  const [value, setValue] = useState(setting.value ?? "");
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => setValue(setting.value ?? ""), [setting.value]);

  const send = async (method: "PUT" | "DELETE") => {
    setStatus(null);
    try {
      await api(`settings/${setting.key}`, {
        method,
        body: method === "PUT" ? { value } : undefined,
      });
      setStatus({
        tone: "ok",
        text: method === "PUT" ? "Saved." : "Back to Vercel's value.",
      });
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    }
  };

  return (
    <Row
      label={setting.label}
      help={setting.help}
      aside={<SourceBadge source={setting.source} />}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="w-32"
          inputMode="numeric"
        />
        <Button
          disabled={!value || value === setting.value}
          onClick={() => void send("PUT")}
        >
          Save
        </Button>
        {setting.source === "website" && (
          <Button variant="ghost" onClick={() => void send("DELETE")}>
            Use Vercel's
          </Button>
        )}
      </div>
      {status && <Notice tone={status.tone}>{status.text}</Notice>}
    </Row>
  );
}

function CalendarCard({
  calendar,
  setting,
  onSaved,
}: {
  calendar: SettingsResponse["calendar"];
  setting: SettingRow;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [value, setValue] = useState(calendar.calendarId);
  useEffect(() => setValue(calendar.calendarId), [calendar.calendarId]);

  const send = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setStatus(null);
    try {
      await api(`settings/${setting.key}`, {
        method,
        body: method === "PUT" ? { value: value.trim() } : undefined,
      });
      setStatus({
        tone: "ok",
        text:
          method === "PUT"
            ? "Switched. The bot now uses this calendar."
            : "Back to Vercel's calendar.",
      });
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Google Calendar"
      description="The calendar the bot reads and adds events to."
    >
      <Row
        label="Calendar"
        help="A calendar id, e.g. you@gmail.com. Find it in Google Calendar under the calendar's Settings > Integrate calendar."
        aside={<SourceBadge source={setting.source} />}
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="you@gmail.com"
          spellCheck={false}
          autoCapitalize="off"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={
              busy || !value.trim() || value.trim() === calendar.calendarId
            }
            onClick={() => void send("PUT")}
          >
            Switch
          </Button>
          {setting.source === "website" && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void send("DELETE")}
            >
              Use Vercel's
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy || !calendar.calendarId}
            onClick={async () => {
              setBusy(true);
              setStatus(null);
              try {
                const result = await api<{ ok: boolean; error?: string }>(
                  "calendar/check",
                  { method: "POST" },
                );
                setStatus(
                  result.ok
                    ? { tone: "ok", text: "The bot can read this calendar." }
                    : {
                        tone: "error",
                        text: `The bot can't read it (${result.error}).`,
                      },
                );
              } catch (error) {
                setStatus({ tone: "error", text: errorText(error) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Check access
          </Button>
        </div>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Notice tone="info">
          Events already added stay on the old calendar. Upcoming Canvas
          deadlines are added to the new one at the next daily sync; send your
          NUSMods link again to add finals.
        </Notice>
      </Row>
      {calendar.serviceAccountEmail && (
        <Row
          label="Bot's Google account"
          help="Share a calendar with this address (Make changes to events) for the bot to use it."
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
              {calendar.serviceAccountEmail}
            </code>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard
                  .writeText(calendar.serviceAccountEmail!)
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Row>
      )}
    </Card>
  );
}

function TimetableCard() {
  const [current, setCurrent] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Status>(null);

  const load = useCallback(() => {
    api<{ text: string }>("timetable")
      .then((data) => setCurrent(data.text))
      .catch((error) => setCurrent(errorText(error)));
  }, []);
  useEffect(load, [load]);

  return (
    <Card
      title="NUSMods timetable"
      description="Classes in the 8am message and /classes, and finals on Google Calendar."
    >
      <Row label="Update" help="NUSMods → Share/Sync → copy link.">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setResult(null);
            try {
              const data = await api<{ text: string }>("timetable", {
                method: "POST",
                body: { link },
              });
              const saved = data.text.startsWith("Saved");
              setResult({ tone: saved ? "ok" : "error", text: data.text });
              if (saved) {
                setLink("");
                load();
              }
            } catch (error) {
              setResult({ tone: "error", text: errorText(error) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://nusmods.com/timetable/sem-2/share?…"
            className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
          />
          <Button type="submit" disabled={busy || !link}>
            {busy ? "Saving…" : "Save timetable"}
          </Button>
        </form>
        {result && (
          <pre
            className={`mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs ${
              result.tone === "ok"
                ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
            }`}
          >
            {result.text}
          </pre>
        )}
      </Row>
      <Row label="Saved now">
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
          {current ?? "Loading…"}
        </pre>
      </Row>
    </Card>
  );
}

function SecurityCard({ onSessionChange }: { onSessionChange: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>("audit")
      .then((data) => setEntries(data.entries))
      .catch(() => setEntries([]));
  }, []);

  return (
    <Card
      title="Security & activity"
      description="Recent changes made here. Values are never logged."
    >
      <Row label="Recent changes">
        {entries === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">No changes yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {entries.map((entry, index) => (
              <li
                key={index}
                className="flex flex-wrap justify-between gap-x-4"
              >
                <span>
                  <span className="font-medium">
                    {SETTING_LABELS[entry.key] ?? entry.key}
                  </span>{" "}
                  <span className="text-slate-500">{entry.action}</span>
                </span>
                <span className="text-xs text-slate-400">
                  {formatDate(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label="Sign out">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              void api("auth/logout", { method: "POST" }).then(onSessionChange)
            }
          >
            Sign out
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (
                window.confirm(
                  "Sign out of every browser and device, including this one?",
                )
              ) {
                void api("auth/logout-all", { method: "POST" }).then(
                  onSessionChange,
                );
              }
            }}
          >
            Sign out everywhere
          </Button>
        </div>
      </Row>
    </Card>
  );
}

export function SettingsPage({
  me,
  onSessionChange,
}: {
  me: Me;
  onSessionChange: () => void;
}) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SettingsResponse>("settings")
      .then(setData)
      .catch((failure) => setError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    api<{ models: string[] }>("ai/models")
      .then((result) => setModels(result.models))
      .catch((failure) => setModelsError(errorText(failure)));
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const setting = (key: string) =>
    data.settings.find((row) => row.key === key)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Everything the bot uses. A value set here wins over the one in Vercel.
        </p>
      </div>

      <Card
        title="AI assistant"
        description="Models on SoCLaaS, used for Telegram replies."
      >
        {["LLM_MODEL", "LLM_FALLBACK_MODEL"].map((key) => (
          <ModelRow
            key={key}
            setting={setting(key)}
            models={models}
            onSaved={load}
          />
        ))}
        {modelsError && (
          <div className="px-5 py-3">
            <Notice tone="info">
              Couldn't list SoCLaaS models ({modelsError}); type a model id
              instead.
            </Notice>
          </div>
        )}
      </Card>

      <Card
        title="Keys"
        description="Stored encrypted. Saved keys are never shown again."
      >
        {!me.fresh && (
          <div className="bg-amber-50 px-5 py-4 dark:bg-amber-950/40">
            <SignIn
              onSignedIn={onSessionChange}
              title="Confirm it's you"
              description="Sign in again to change keys, or send /web to the bot and open its link. This lasts 10 minutes."
            />
          </div>
        )}
        {data.secrets.map((secret) => (
          <KeyRow
            key={secret.key}
            secret={secret}
            fresh={me.fresh}
            onSaved={load}
          />
        ))}
      </Card>

      <CalendarCard
        calendar={data.calendar}
        setting={setting("GOOGLE_CALENDAR_ID")}
        onSaved={load}
      />
      <TimetableCard />

      <Card title="Profile">
        <TextSettingRow
          setting={setting("NUS_MATRICULATION_YEAR")}
          onSaved={load}
          placeholder="2025"
        />
      </Card>

      <SecurityCard onSessionChange={onSessionChange} />
    </div>
  );
}
