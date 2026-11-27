import { RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ICON } from "./icons";
import { errorText } from "./page";
import { ago } from "./setup";
import { Button, Card, Notice, Row } from "./ui";

interface WebhookStatus {
  ok: boolean;
  error?: string;
  expectedUrl?: string | null;
  url?: string;
  connected?: boolean;
  pendingUpdates?: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
}

// Settings → Telegram: whether Telegram sends the bot's messages to this
// site, and a button to point it here (after deploying, moving the site or
// changing the bot token). Replaces running `pnpm setup:webhook`.
export function TelegramCard() {
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(() => {
    api<WebhookStatus>("telegram")
      .then(setStatus)
      .catch((failure) => setStatus({ ok: false, error: errorText(failure) }));
  }, []);
  useEffect(load, [load]);

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<WebhookStatus>("telegram/connect", {
        method: "POST",
      });
      setStatus(result);
      setMessage(
        result.ok
          ? { tone: "ok", text: "Connected. Send /help to your bot to check." }
          : { tone: "error", text: `Telegram refused: ${result.error}` },
      );
    } catch (failure) {
      setMessage({ tone: "error", text: errorText(failure) });
    } finally {
      setBusy(false);
    }
  };

  const state = !status
    ? null
    : !status.ok
      ? { label: "Unknown", tone: "bg-sunken text-muted" }
      : status.connected
        ? { label: "Connected", tone: "bg-ok-soft text-ok" }
        : status.url
          ? { label: "Points elsewhere", tone: "bg-warn-soft text-warn" }
          : { label: "Not connected", tone: "bg-danger-soft text-danger" };

  return (
    <Card
      title="Telegram"
      description="Telegram delivers your messages to the bot through this site."
    >
      <Row
        label="Connection"
        help="Connect once after deploying, and again if the site's address or the bot token changes."
      >
        {status === null ? (
          <p className="text-sm text-faint">Checking…</p>
        ) : (
          <div className="space-y-1.5 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              {state && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-line ring-inset ${state.tone}`}
                >
                  {state.label}
                </span>
              )}
              {!status.ok && (
                <span className="text-muted">
                  Couldn't ask Telegram ({status.error}). Check
                  TELEGRAM_BOT_TOKEN in Vercel.
                </span>
              )}
              {status.ok && status.url && !status.connected && (
                <span className="break-all text-muted">
                  Updates go to {status.url}
                </span>
              )}
            </p>
            {status.ok && (status.pendingUpdates ?? 0) > 0 && (
              <p className="text-muted">
                {status.pendingUpdates} message
                {status.pendingUpdates === 1 ? "" : "s"} waiting to be
                delivered.
              </p>
            )}
            {status.ok && status.lastError && status.lastErrorAt && (
              <p className="text-muted">
                Last delivery problem {ago(status.lastErrorAt)}:{" "}
                {status.lastError}
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant={status?.connected ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => void connect()}
          >
            <Send {...ICON} />
            {status?.connected ? "Reconnect" : "Connect"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={load}
            aria-label="Check again"
          >
            <RefreshCw {...ICON} />
            Check again
          </Button>
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </Row>
    </Card>
  );
}
