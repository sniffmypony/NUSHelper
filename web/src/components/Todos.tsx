import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { ICON } from "./icons";
import { Shake } from "./motion";
import { Empty, errorText } from "./page";
import { Button, Card, Input, Notice } from "./ui";

// Today's to-do list: tick one off (it's removed, as on Telegram) or add one.
export function Todos({
  todos,
  onChanged,
}: {
  todos: Array<{ id: number; description: string }>;
  onChanged: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(0);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("todos", { method: "POST", body: { description: text } });
      setText("");
      onChanged();
    } catch (failure) {
      setError(errorText(failure));
      setRefused((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="To-do today"
      description="Cleared each night, like on Telegram."
    >
      <div className="space-y-3 px-5 py-4">
        {todos.length === 0 ? (
          <Empty>Nothing on today's list.</Empty>
        ) : (
          <ul className="space-y-1">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex animate-settle items-center gap-3"
              >
                <button
                  type="button"
                  aria-label={`Done: ${todo.description}`}
                  className="group grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-line-strong transition-[transform,border-color,background-color] duration-150 ease-out hover:border-ok hover:bg-ok-soft active:scale-[0.97]"
                  onClick={async () => {
                    try {
                      await api(`todos/${todo.id}`, { method: "DELETE" });
                      onChanged();
                    } catch (failure) {
                      setError(errorText(failure));
                    }
                  }}
                >
                  <Check
                    {...ICON}
                    size={12}
                    strokeWidth={2.5}
                    className="text-ok opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  />
                </button>
                <span className="text-sm">{todo.description}</span>
              </li>
            ))}
          </ul>
        )}
        <Shake trigger={refused}>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) void add();
            }}
          >
            <Input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a to-do"
              invalid={Boolean(error)}
            />
            <Button type="submit" disabled={busy || !text.trim()}>
              Add
            </Button>
          </form>
        </Shake>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Card>
  );
}
