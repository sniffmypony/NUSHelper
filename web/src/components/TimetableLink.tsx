import { useState } from "react";
import { api } from "../api";
import { errorText, useRefusals } from "./page";
import { Button, Card, Input, Row } from "./ui";

type Status = { tone: "ok" | "error"; text: string } | null;

// Save a NUSMods share link: classes for the 8am message and /classes, and
// finals on Google Calendar (the same as sending the link to the bot).
export function TimetableLink({ onSaved }: { onSaved: () => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Status>(null);
  const refusals = useRefusals(result);

  return (
    <Card
      title="NUSMods link"
      description="Paste a new link whenever your timetable changes."
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
                onSaved();
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
            shake={refusals}
            invalid={result?.tone === "error"}
            className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
          />
          <Button type="submit" disabled={busy || !link}>
            {busy ? "Saving…" : "Save timetable"}
          </Button>
        </form>
        {result && (
          <pre
            className={`mt-3 max-h-80 animate-settle overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs ${
              result.tone === "ok"
                ? "bg-ok-soft text-ok"
                : "bg-danger-soft text-danger"
            }`}
          >
            {result.text}
          </pre>
        )}
      </Row>
    </Card>
  );
}
