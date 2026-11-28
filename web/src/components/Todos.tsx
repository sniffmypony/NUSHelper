import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { api } from "../api";
import { useFeedback, useRemovable } from "./feedback";
import { DUR, EASE_IN, SPRING } from "./motion";
import { errorText } from "./page";
import { Tick } from "./Tick";
import { Button, Input, Notice, Panel } from "./ui";

// Today's to-do list: tick one off (it leaves, with Undo; the bot deletes
// ticked to-dos, as on Telegram) or add one.
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
  const rows = useRemovable<number>();
  const { show } = useFeedback();

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("todos", { method: "POST", body: { description: text } });
      setText("");
      onChanged();
      show({ message: "Added to today's list", duration: 2500 });
    } catch (failure) {
      setError(errorText(failure));
      setRefused((count) => count + 1);
    } finally {
      setBusy(false);
    }
  };

  const visible = todos.filter((todo) => !rows.isHidden(todo.id));

  return (
    <Panel
      title="To-do today"
      description="Ticked items are cleared, as on Telegram."
      aside={
        visible.length > 0 && (
          <span className="tnum text-sm text-muted">{visible.length} left</span>
        )
      }
    >
      <div className="px-4 pb-4 sm:px-5">
        {visible.length === 0 && (
          <p className="pb-3 text-sm text-faint">
            Nothing left for today. Add one below, or send /todo on Telegram.
          </p>
        )}
        <ul className="-mx-1">
          <AnimatePresence initial={false}>
            {visible.map((todo) => {
              const ticked = rows.isTicked(todo.id);
              return (
                <m.li
                  key={todo.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{
                    opacity: 0,
                    transition: { duration: DUR.fast, ease: EASE_IN },
                  }}
                  transition={SPRING.snap}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-1"
                >
                  <span className="pl-1">
                    <Tick
                      checked={ticked}
                      label={`Done: ${todo.description}`}
                      disabled={ticked}
                      onToggle={() =>
                        rows.remove(
                          todo.id,
                          "To-do done",
                          () => api(`todos/${todo.id}`, { method: "DELETE" }),
                          { holdMs: 280, onDone: onChanged },
                        )
                      }
                    />
                  </span>
                  <span
                    className={`min-w-0 flex-1 py-2 text-sm transition-colors duration-[var(--dur-base)] ${ticked ? "text-faint line-through decoration-faint" : "text-ink"}`}
                  >
                    {todo.description}
                  </span>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void add();
          }}
        >
          <Input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            placeholder="Add a to-do"
            aria-label="New to-do"
            invalid={Boolean(error)}
            shake={refused}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || !text.trim()}
          >
            Add
          </Button>
        </form>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Panel>
  );
}
