import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ICON } from "./icons";
import { Accordion } from "./motion";
import { errorText } from "./page";
import { ago, CopyText, OnOff, Step } from "./setup";
import { Button, Card, Notice, Row } from "./ui";

interface ApplePayStatus {
  enabled: boolean;
  endpoint: string | null;
  latest: { receivedAt: string; text: string; status: string } | null;
}

// Settings → Apple Pay: the key the iPhone shortcut sends, how to set the
// shortcut up, and whether payments are arriving.
export function ApplePayCard({ fresh }: { fresh: boolean }) {
  const [status, setStatus] = useState<ApplePayStatus | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(() => {
    api<ApplePayStatus>("applepay")
      .then(setStatus)
      .catch((failure) =>
        setMessage({ tone: "error", text: errorText(failure) }),
      );
  }, []);
  useEffect(load, [load]);

  const makeKey = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ key: string }>("applepay/key", {
        method: "POST",
      });
      setKey(result.key);
      load();
    } catch (failure) {
      setMessage({ tone: "error", text: errorText(failure) });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (
      !window.confirm("Turn Apple Pay off? The shortcut's key stops working.")
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      await api("applepay/key", { method: "DELETE" });
      setKey(null);
      setMessage({
        tone: "ok",
        text: "Turned off. Payments from the shortcut are refused now.",
      });
      load();
    } catch (failure) {
      setMessage({ tone: "error", text: errorText(failure) });
    } finally {
      setBusy(false);
    }
  };

  const endpoint = status?.endpoint ?? "https://<your site>/api/applepay";

  return (
    <Card
      title="Apple Pay"
      description="Payments you tap with Apple Pay are added to that day's spending straight away, with an Undo on Telegram."
    >
      <Row label="Status">
        {status === null ? (
          <p className="text-sm text-faint">Loading…</p>
        ) : (
          <div className="space-y-1 text-sm">
            <p>
              <OnOff on={status.enabled} />
              {status.latest
                ? `Last payment ${ago(status.latest.receivedAt)}: ${status.latest.text}`
                : "No payments received yet."}
            </p>
          </div>
        )}
      </Row>

      <Row
        label="Shortcut key"
        help="The iPhone sends this with each payment. It's shown once; make a new one if it's lost."
      >
        {!fresh ? (
          <Notice tone="info">
            Sign in again (in Keys above, or send /web to the bot) to make a
            key.
          </Notice>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void makeKey()}>
              <KeyRound {...ICON} />
              {status?.enabled ? "Replace key" : "Create key"}
            </Button>
            {status?.enabled && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void turnOff()}
              >
                Turn off
              </Button>
            )}
          </div>
        )}
        {key && (
          <div className="mt-3 animate-settle space-y-1.5 rounded-xl bg-warn-soft p-3">
            <p className="text-sm font-semibold text-warn">
              Copy it into the shortcut now. It won't be shown again.
            </p>
            <CopyText value={`Bearer ${key}`} label="the key" />
          </div>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </Row>

      <Row
        label="Set up on iPhone"
        help="Once, about 2 minutes. Needs iOS 17 or later."
      >
        <Accordion
          open={!status?.latest}
          summaryClassName="text-sm font-medium text-accent-text"
          title="Show the steps"
        >
          <ol className="mt-3 space-y-3 text-sm">
            <Step n={1}>
              <p>
                Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> →{" "}
                <b>Wallet</b> (“When I tap a Wallet Card or Pass”; called{" "}
                <b>Transaction</b> on older iOS).
              </p>
            </Step>
            <Step n={2}>
              <p>
                Choose the cards you pay with, then <b>Run Immediately</b>, and
                turn off <b>Notify When Run</b>. Tap <b>Next</b> →{" "}
                <b>Create New Shortcut</b>.
              </p>
            </Step>
            <Step n={3}>
              <p>
                Add the action <b>Get Contents of URL</b> and set the URL to:
              </p>
              <CopyText value={endpoint} label="the address" />
            </Step>
            <Step n={4}>
              <p>
                Expand it: <b>Method</b> POST. Under <b>Headers</b>, add{" "}
                <code className="rounded bg-sunken px-1">Authorization</code>{" "}
                with the key above (starting{" "}
                <code className="rounded bg-sunken px-1">Bearer ap_</code>).
              </p>
            </Step>
            <Step n={5}>
              <p>
                <b>Request Body</b>: JSON, with three text fields from{" "}
                <b>Shortcut Input</b>:{" "}
                <code className="rounded bg-sunken px-1">amount</code> → Amount,{" "}
                <code className="rounded bg-sunken px-1">merchant</code> →
                Merchant, <code className="rounded bg-sunken px-1">card</code> →
                Card or Pass.
              </p>
            </Step>
            <Step n={6}>
              <p>
                Optional: add <b>Show Notification</b> with{" "}
                <b>Contents of URL</b> to see “Logged S$5.40 at …” on your
                phone. Tap <b>Done</b>.
              </p>
            </Step>
          </ol>
          <p className="mt-3 text-xs text-muted">
            It runs for Apple Pay taps at a terminal (phone or watch). In-app
            and online Apple Pay, card swipes and some transit taps don't
            trigger it; add those on Telegram or the Spending page.
          </p>
        </Accordion>
      </Row>
    </Card>
  );
}
