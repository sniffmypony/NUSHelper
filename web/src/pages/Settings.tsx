import { Check, Copy, Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AuditEntry,
  type Me,
  type SecretRow,
  type SettingRow,
  type SettingsResponse,
} from "../api";
import { ApplePayCard } from "../components/ApplePayCard";
import { BankEmailCard } from "../components/BankEmailCard";
import { TelegramCard } from "../components/TelegramCard";
import { ICON } from "../components/icons";
import { Accordion, SwapIcon } from "../components/motion";
import { ThemeSwitch } from "../components/ThemeSwitch";
import {
  Button,
  Card,
  Input,
  Notice,
  Row,
  Select,
  SourceBadge,
  formatDate,
} from "../components/ui";
import { useRefusals } from "../components/page";
import { navigate } from "../navigation";
import { SignIn } from "./Login";

type Status = { tone: "ok" | "error" | "info"; text: string } | null;

// Shown in the Google Calendar card rather than with the other keys.
const SERVICE_KEY = "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64";
// Shown in the assistant's Google access card.
const ASSISTANT_SECRET = "GOOGLE_OAUTH_CLIENT_SECRET";

interface GoogleAccessStatus {
  clientId: boolean;
  clientSecret: boolean;
  connected: boolean;
  account: string | null;
}

// Where Google's sign-in sent the browser back to: ?google=…
function googleReturn(): Status {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("google");
  if (!outcome) return null;
  window.history.replaceState(null, "", "/settings");
  if (outcome === "connected") {
    return { tone: "ok", text: "Connected. Press Check to try it." };
  }
  if (outcome === "denied") {
    return { tone: "error", text: "Google sign-in was cancelled." };
  }
  if (outcome === "expired") {
    return {
      tone: "error",
      text: "That sign-in expired or came from another browser. Press Connect again.",
    };
  }
  return {
    tone: "error",
    text: params.get("reason") ?? "Couldn't connect to Google.",
  };
}

// From February 2027 Google requires AI tools to reach Calendar through its
// MCP server, signed in as you: this connects that sign-in.
function AssistantGoogleCard({
  clientId,
  clientSecret,
  fresh,
  onSaved,
}: {
  clientId: SettingRow;
  clientSecret: SecretRow | undefined;
  fresh: boolean;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<GoogleAccessStatus | null>(null);
  const [message, setMessage] = useState<Status>(googleReturn);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<GoogleAccessStatus>("google")
      .then(setStatus)
      .catch((error) => setMessage({ tone: "error", text: errorText(error) }));
  }, []);
  useEffect(load, [load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(status?.clientId && status.clientSecret);

  return (
    <Card
      title="Assistant's calendar access"
      description="Lets the assistant look up your events and add, move or delete them when you ask, in Telegram or Chat. Connect your Google account once."
    >
      <TextSettingRow
        setting={clientId}
        onSaved={() => {
          onSaved();
          load();
        }}
        placeholder="…apps.googleusercontent.com"
        url
      />
      {clientSecret && (
        <KeyRow
          secret={clientSecret}
          fresh={fresh}
          onSaved={() => {
            onSaved();
            load();
          }}
        />
      )}
      <Row
        label="Google sign-in"
        help="Google warns the app isn't verified, because it's yours: choose Advanced → Go to NUSHelper."
      >
        <p className="text-sm text-muted">
          {status === null
            ? "Checking…"
            : status.connected
              ? `Connected${status.account ? ` as ${status.account}` : ""}.`
              : ready
                ? "Not connected."
                : "Add the client ID and secret first."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={status?.connected ? "secondary" : "primary"}
            disabled={busy || !ready || !fresh}
            onClick={() =>
              void run(async () => {
                const { url } = await api<{ url: string }>("google/connect", {
                  method: "POST",
                });
                window.location.assign(url);
              })
            }
          >
            {status?.connected ? "Reconnect" : "Connect"}
          </Button>
          {status?.connected && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{
                      ok: boolean;
                      count?: number | null;
                      error?: string;
                    }>("google/check", { method: "POST" });
                    setMessage(
                      result.ok
                        ? {
                            tone: "ok",
                            text:
                              typeof result.count === "number"
                                ? `Works: found ${result.count >= 5 ? "5 or more events" : `${result.count} event${result.count === 1 ? "" : "s"}`} in the next week.`
                                : "Works: Google Calendar answered.",
                          }
                        : { tone: "error", text: result.error ?? "Failed." },
                    );
                  })
                }
              >
                Check
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !fresh}
                onClick={() => {
                  if (!window.confirm("Disconnect the assistant from Google?"))
                    return;
                  void run(async () => {
                    await api("google/disconnect", { method: "POST" });
                    setMessage({ tone: "ok", text: "Disconnected." });
                    load();
                  });
                }}
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
        {!fresh && (
          <p className="mt-2 text-xs text-muted">
            Connecting needs a sign-in in the last 10 minutes (Keys above).
          </p>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </Row>
    </Card>
  );
}

const SETTING_LABELS: Record<string, string> = {
  LLM_MODEL: "Main AI model",
  LLM_FALLBACK_MODEL: "Backup AI model",
  NUS_MATRICULATION_YEAR: "Matriculation year",
  LLM_API_KEY: "AI provider API key",
  LLM_BASE_URL: "AI provider address",
  GOOGLE_OAUTH_CLIENT_ID: "Assistant's Google client ID",
  GOOGLE_OAUTH_CLIENT_SECRET: "Assistant's Google client secret",
  google: "Assistant's Google sign-in",
  CANVAS_BASE_URL: "Canvas address",
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: "Google service-account key",
  CANVAS_API_TOKEN: "Canvas access token",
  timetable: "NUSMods timetable",
  session: "Sign-in",
  applepay: "Apple Pay key",
  bankemail: "Bank emails key",
  telegram: "Telegram connection",
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
  const refusals = useRefusals(status);
  const refused = status?.tone === "error";
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
          <Select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            shake={refusals}
            invalid={refused}
            className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
          >
            {!value && <option value="">Choose a model…</option>}
            {options.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="e.g. qwen3.6:35b"
            shake={refusals}
            invalid={refused}
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

// Base64 of a file's text, as the server stores a service-account key.
function base64Text(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function KeyRow({
  secret,
  fresh,
  onSaved,
  file,
}: {
  secret: SecretRow;
  fresh: boolean;
  onSaved: () => void;
  // A key that comes as a file (the Google service-account JSON).
  file?: { accept: string; label: string };
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const refusals = useRefusals(status);

  const describe =
    secret.source === "website"
      ? `Saved here · ending ${secret.lastFour} · ${formatDate(secret.updatedAt)}`
      : secret.source === "vercel"
        ? "Using the key set in Vercel."
        : file
          ? "No key uploaded."
          : "No key set.";

  const save = async (method: "PUT" | "DELETE", given = value) => {
    setBusy(true);
    setStatus(null);
    try {
      await api(`secrets/${secret.key}`, {
        method,
        body: method === "PUT" ? { value: given } : undefined,
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
      <p className="text-sm text-muted">{describe}</p>
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
            shake={refusals}
            invalid={status?.tone === "error"}
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
          {file ? (
            <label
              className={`inline-flex select-none items-center justify-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-brand-text transition-[transform,background-color] duration-150 ease-out focus-within:outline-2 focus-within:outline-accent hover:bg-brand-soft active:scale-[0.97] motion-reduce:active:scale-100 ${
                !fresh || busy
                  ? "pointer-events-none opacity-50"
                  : "cursor-pointer"
              }`}
            >
              <input
                type="file"
                accept={file.accept}
                className="sr-only"
                disabled={!fresh || busy}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  event.target.value = "";
                  if (!chosen) return;
                  void chosen
                    .text()
                    .then((text) => save("PUT", base64Text(text.trim())));
                }}
              />
              {secret.source === "unset" ? file.label : "Replace key file"}
            </label>
          ) : (
            <Button
              variant="secondary"
              disabled={!fresh}
              onClick={() => setEditing(true)}
            >
              {secret.source === "unset" ? "Add key" : "Replace key"}
            </Button>
          )}
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
  url = false,
}: {
  setting: SettingRow;
  onSaved: () => void;
  placeholder: string;
  // An address: a full-width field instead of a short number box.
  url?: boolean;
}) {
  const [value, setValue] = useState(setting.value ?? "");
  const [status, setStatus] = useState<Status>(null);
  const refusals = useRefusals(status);
  useEffect(() => setValue(setting.value ?? ""), [setting.value]);

  const send = async (method: "PUT" | "DELETE") => {
    setStatus(null);
    try {
      await api(`settings/${setting.key}`, {
        method,
        body: method === "PUT" ? { value: value.trim() } : undefined,
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
          className={url ? "min-w-0 flex-1 basis-64" : "w-32"}
          inputMode={url ? "url" : "numeric"}
          spellCheck={url ? false : undefined}
          autoCapitalize={url ? "off" : undefined}
          shake={refusals}
          invalid={status?.tone === "error"}
        />
        <Button
          disabled={!value.trim() || value.trim() === setting.value}
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
  serviceKey,
  fresh,
  onSaved,
}: {
  calendar: SettingsResponse["calendar"];
  setting: SettingRow;
  serviceKey: SecretRow | undefined;
  fresh: boolean;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const refusals = useRefusals(status);
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
      {serviceKey && (
        <KeyRow
          secret={serviceKey}
          fresh={fresh}
          onSaved={onSaved}
          file={{ accept: ".json,application/json", label: "Upload JSON key" }}
        />
      )}
      {calendar.serviceAccountEmail && (
        <Row
          label="Bot's Google account"
          help="Share a calendar with this address (Make changes to events) for the bot to use it."
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-sunken px-2 py-1 text-xs">
              {calendar.serviceAccountEmail}
            </code>
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard
                  .writeText(calendar.serviceAccountEmail!)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
              }}
            >
              <SwapIcon
                show={copied ? "copied" : "copy"}
                icons={{
                  copy: <Copy {...ICON} />,
                  copied: <Check {...ICON} className="text-ok" />,
                }}
              />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Row>
      )}
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
          shake={refusals}
          invalid={status?.tone === "error"}
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
        {calendar.calendarId && (
          <Notice tone="info">
            Events already added stay on the old calendar. Upcoming Canvas
            deadlines are added to the new one at the next daily sync; send your
            NUSMods link again to add finals.
          </Notice>
        )}
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
          <p className="text-sm text-faint">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">No changes yet.</p>
        ) : (
          <Accordion
            open={false}
            summaryClassName="text-sm font-medium text-accent-text"
            title={`Show the last ${entries.length} change${entries.length === 1 ? "" : "s"}`}
          >
            <ul className="space-y-1.5 pt-2 text-sm">
              {entries.map((entry, index) => (
                <li
                  key={index}
                  className="flex flex-wrap justify-between gap-x-4"
                >
                  <span>
                    <span className="font-medium">
                      {SETTING_LABELS[entry.key] ?? entry.key}
                    </span>{" "}
                    <span className="text-muted">{entry.action}</span>
                  </span>
                  <span className="text-xs text-faint">
                    {formatDate(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Accordion>
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
  if (!data) return <p className="text-sm text-faint">Loading…</p>;

  const setting = (key: string) =>
    data.settings.find((row) => row.key === key)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Everything the bot uses. A value set here wins over the one in Vercel.
        </p>
      </div>

      <TelegramCard />

      <Card title="Appearance">
        <Row
          label="Theme"
          help="System follows your device. Saved in this browser."
        >
          <ThemeSwitch labels />
        </Row>
      </Card>

      <Card
        title="AI assistant"
        description="Your AI provider and its models, for replies on Telegram and in Chat."
      >
        <TextSettingRow
          setting={setting("LLM_BASE_URL")}
          onSaved={load}
          placeholder="https://api.openai.com/v1"
          url
        />
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
              Couldn't list your provider's models ({modelsError}). Check its
              address and API key, or type a model id instead.
            </Notice>
          </div>
        )}
      </Card>

      <Card
        title="Keys"
        description="Stored encrypted. Saved keys are never shown again."
      >
        {!me.fresh && (
          <div className="bg-warn-soft px-5 py-4">
            <SignIn
              onSignedIn={onSessionChange}
              title="Confirm it's you"
              description="Sign in again to change keys, or send /web to the bot and open its link. This lasts 10 minutes."
            />
          </div>
        )}
        {data.secrets
          .filter(
            (secret) =>
              secret.key !== SERVICE_KEY && secret.key !== ASSISTANT_SECRET,
          )
          .map((secret) => (
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
        serviceKey={data.secrets.find((secret) => secret.key === SERVICE_KEY)}
        fresh={me.fresh}
        onSaved={load}
      />
      <AssistantGoogleCard
        clientId={setting("GOOGLE_OAUTH_CLIENT_ID")}
        clientSecret={data.secrets.find(
          (secret) => secret.key === ASSISTANT_SECRET,
        )}
        fresh={me.fresh}
        onSaved={load}
      />
      <Card title="NUSMods timetable">
        <Row
          label="Timetable"
          help="Your classes and finals, and the NUSMods link."
        >
          <Button variant="secondary" onClick={() => navigate("/timetable")}>
            Open Timetable
          </Button>
        </Row>
      </Card>

      <Card title="School" description="NUS week labels and your Canvas.">
        <TextSettingRow
          setting={setting("NUS_MATRICULATION_YEAR")}
          onSaved={load}
          placeholder="2025"
        />
        <TextSettingRow
          setting={setting("CANVAS_BASE_URL")}
          onSaved={load}
          placeholder="https://canvas.nus.edu.sg"
          url
        />
      </Card>

      <ApplePayCard fresh={me.fresh} />

      <BankEmailCard fresh={me.fresh} />

      <Card
        title="Data"
        description="Download what the bot keeps, as CSV files for Excel or Sheets."
      >
        <Row label="Download" help="Each file is made when you click it.">
          <div className="flex flex-wrap gap-2">
            {[
              ["spending", "Spending"],
              ["tasks", "Tasks"],
              ["todos", "To-dos"],
              ["reminders", "Reminders"],
              ["repeating", "Repeating"],
              ["chats", "Chats"],
              ["applepay", "Automatic payments"],
            ].map(([kind, label]) => (
              <a
                key={kind}
                href={`/api/web/export/${kind}.csv`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-brand-text transition-[transform,background-color] duration-150 ease-out hover:bg-brand-soft active:scale-[0.97] motion-reduce:active:scale-100"
              >
                <Download {...ICON} />
                {label}
              </a>
            ))}
          </div>
        </Row>
      </Card>

      <SecurityCard onSessionChange={onSessionChange} />
    </div>
  );
}
