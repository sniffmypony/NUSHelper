import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ICON } from "./icons";
import { Accordion } from "./motion";
import { errorText } from "./page";
import { ago, CopyBlock, CopyText, OnOff, Step } from "./setup";
import { useConfirm } from "./dialog";
import { Button, Card, Notice, Row } from "./ui";

interface BankEmailStatus {
  enabled: boolean;
  endpoint: string | null;
  waiting?: number;
  latest: { receivedAt: string; text: string; status: string } | null;
}

// The Google Apps Script that runs in the owner's own Google account: once a
// minute it looks for new DBS alert emails and sends each one to NUSHelper.
// Only these emails leave Gmail, and the bot never gets Gmail access.
export function bankEmailScript(endpoint: string): string {
  return `// NUSHelper: sends DBS payment alert emails to the bot.
// Runs in your Google account; nothing else in Gmail leaves it.
const NUSHELPER_URL = "${endpoint}";
const QUERY =
  "from:(paylah.alert@dbs.com OR ibanking.alert@dbs.com) newer_than:2d";
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

// Run this once. It notes the emails already there (without sending them)
// and starts the check every minute.
function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteProperty("SEEN");
  checkDbsEmails();
  ScriptApp.newTrigger("checkDbsEmails").timeBased().everyMinutes(1).create();
}

function checkDbsEmails() {
  const props = PropertiesService.getScriptProperties();
  const key = (props.getProperty("NUSHELPER_KEY") || "")
    .replace(/^Bearer\\s+/i, "")
    .trim();
  if (!key) throw new Error("Add the script property NUSHELPER_KEY first.");
  const firstRun = props.getProperty("SEEN") === null;
  const seen = JSON.parse(props.getProperty("SEEN") || "[]");
  const since = Date.now() - TWO_DAYS;
  let refused = null;

  for (const thread of GmailApp.search(QUERY, 0, 30)) {
    for (const message of thread.getMessages()) {
      const id = message.getId();
      if (seen.includes(id) || message.getDate().getTime() < since) continue;
      // Refused: keep the rest for after the key is fixed.
      if (refused) continue;
      if (!firstRun) {
        const raw = message.getRawContent();
        const auth = (raw.match(
          /^Authentication-Results:[\\s\\S]*?(?=\\r?\\n\\S)/im,
        ) || [""])[0];
        const response = UrlFetchApp.fetch(NUSHELPER_URL, {
          method: "post",
          contentType: "application/json",
          headers: { Authorization: "Bearer " + key },
          muteHttpExceptions: true,
          payload: JSON.stringify({
            id: id,
            from: message.getFrom(),
            subject: message.getSubject(),
            date: message.getDate().toISOString(),
            text: message.getPlainBody().slice(0, 20000),
            auth: auth.slice(0, 4000),
          }),
        });
        const code = response.getResponseCode();
        if (code === 401) refused = response.getContentText();
        // Busy or down: try this email again next minute.
        if (code === 401 || code === 429 || code >= 500) continue;
      }
      seen.push(id);
    }
  }
  props.setProperty("SEEN", JSON.stringify(seen.slice(-300)));
  if (refused) throw new Error(refused);
}
`;
}

// Settings → Bank emails: the key the Apps Script sends, the script itself
// and how to install it, and whether emails are arriving.
export function BankEmailCard({ fresh }: { fresh: boolean }) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<BankEmailStatus | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(() => {
    api<BankEmailStatus>("bankemail")
      .then(setStatus)
      .catch((failure) =>
        setMessage({ tone: "error", text: errorText(failure) }),
      );
  }, []);
  useEffect(load, [load]);

  const makeKey = async () => {
    if (status?.enabled) {
      const ok = await confirm({
        title: "Replace the key?",
        body: "A new key is made and the current one stops working at once. You'll need to paste the new key where the old one was.",
        confirmLabel: "Replace key",
      });
      if (!ok) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ key: string }>("bankemail/key", {
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
    const ok = await confirm({
      title: "Turn bank emails off?",
      body: "The script's key stops working, so its emails are refused until you make a new key.",
      confirmLabel: "Turn off",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      await api("bankemail/key", { method: "DELETE" });
      setKey(null);
      setMessage({
        tone: "ok",
        text: "Turned off. The script's emails are refused now; you can delete it at script.google.com.",
      });
      load();
    } catch (failure) {
      setMessage({ tone: "error", text: errorText(failure) });
    } finally {
      setBusy(false);
    }
  };

  const endpoint = status?.endpoint ?? "https://<your site>/api/bank-email";
  const waiting = status?.waiting ?? 0;

  return (
    <Card
      title="Bank emails"
      description="When a DBS PayLah! or digibank alert says money left your account, the bot asks on Telegram whether to count it. Money you receive is ignored."
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
                : "No bank emails received yet."}
            </p>
            {waiting > 0 && (
              <p className="text-muted">
                {waiting} {waiting === 1 ? "payment is" : "payments are"}{" "}
                waiting for Count it or Skip (on Telegram or the Spending page).
              </p>
            )}
          </div>
        )}
      </Row>

      <Row
        label="Script key"
        help="The script sends this with each email. It's shown once; make a new one if it's lost."
      >
        {!fresh ? (
          <Notice tone="info">
            Sign in again (in Keys above, or send /web to the bot) to make a
            key.
          </Notice>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={status?.enabled ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => void makeKey()}
            >
              <KeyRound {...ICON} />
              {status?.enabled ? "Replace key" : "Create key"}
            </Button>
            {status?.enabled && (
              <Button
                variant="danger-quiet"
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
              Copy it into the script's NUSHELPER_KEY property now. It won't be
              shown again.
            </p>
            <CopyText value={key} label="the key" />
          </div>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </Row>

      <Row
        label="Set up in Google"
        help="Once, about 3 minutes, on a computer. Use the Google account that gets the DBS emails."
      >
        <Accordion
          open={Boolean(status?.enabled && !status.latest)}
          summaryClassName="text-sm font-medium text-accent-text"
          title="Show the steps"
        >
          <ol className="mt-3 space-y-3 text-sm">
            <Step n={1}>
              <p>
                Open <b>script.google.com</b> → <b>New project</b>. Name it
                “NUSHelper bank emails”.
              </p>
            </Step>
            <Step n={2}>
              <p>Replace everything in the editor with this, then save:</p>
              <CopyBlock value={bankEmailScript(endpoint)} label="the script" />
            </Step>
            <Step n={3}>
              <p>
                <b>Project Settings</b> (the gear) → <b>Script Properties</b> →{" "}
                <b>Add script property</b>: name{" "}
                <code className="rounded bg-sunken px-1">NUSHELPER_KEY</code>,
                value the key above (starting{" "}
                <code className="rounded bg-sunken px-1">ap_</code>). Save.
              </p>
            </Step>
            <Step n={4}>
              <p>
                Back in <b>Editor</b>, pick <b>setup</b> in the function menu
                and tap <b>Run</b>. Allow access: Google warns the app isn't
                verified because you wrote it; tap <b>Advanced</b> →{" "}
                <b>Go to NUSHelper bank emails</b> → <b>Allow</b>.
              </p>
            </Step>
            <Step n={5}>
              <p>
                That's it. It now checks every minute; the next PayLah! or
                PayNow payment shows up on Telegram with <b>Count it</b>,{" "}
                <b>Skip</b> and <b>Edit amount</b>.
              </p>
            </Step>
          </ol>
          <p className="mt-3 text-xs text-muted">
            The script reads only DBS alert emails and sends only those. Emails
            that fail Google's check that DBS really sent them are ignored (and
            you're told). If DBS changes its format, AI reads the email and the
            message says so.
          </p>
        </Accordion>
      </Row>
    </Card>
  );
}
