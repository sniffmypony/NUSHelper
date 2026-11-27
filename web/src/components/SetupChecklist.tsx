import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleHelp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { navigate } from "../navigation";
import { ICON } from "./icons";
import { Button, Card } from "./ui";

interface SetupItem {
  key: string;
  label: string;
  done: boolean | null;
  detail: string;
  href: string | null;
  optional: boolean;
}

const HIDDEN = "nh-setup-optional-hidden";

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN) === "1";
  } catch {
    return false;
  }
}

function Item({ item }: { item: SetupItem }) {
  const Icon =
    item.done === true
      ? CircleCheck
      : item.done === null
        ? CircleHelp
        : CircleDashed;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon
        {...ICON}
        aria-hidden
        className={`mt-0.5 shrink-0 ${
          item.done === true
            ? "text-ok"
            : item.done === null
              ? "text-warn"
              : "text-faint"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${item.done ? "text-muted line-through decoration-line-strong" : ""}`}
        >
          {item.label}
          <span className="sr-only">
            {item.done === true
              ? " (done)"
              : item.done === null
                ? " (couldn't check)"
                : " (to do)"}
          </span>
        </p>
        {!item.done && <p className="text-xs text-muted">{item.detail}</p>}
      </div>
      {!item.done && item.href && (
        <Button
          variant="ghost"
          className="shrink-0"
          onClick={() => navigate(item.href!)}
          aria-label={`${item.label}: open`}
        >
          Open
          <ArrowRight {...ICON} size={15} />
        </Button>
      )}
    </li>
  );
}

// Today: what a new copy still needs. Shown until the essentials are done;
// the optional ones can be hidden.
export function SetupChecklist() {
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [hidden, setHidden] = useState(readHidden);

  useEffect(() => {
    api<{ items: SetupItem[] }>("setup")
      .then((result) => setItems(result.items))
      .catch(() => setItems(null));
  }, []);

  if (!items) return null;
  const required = items.filter((item) => !item.optional);
  const optional = items.filter((item) => item.optional);
  // Something that couldn't be checked doesn't keep the list up.
  const essentialsDone = required.every((item) => item.done !== false);
  const optionalLeft = optional.filter((item) => !item.done).length;
  if (essentialsDone && (optionalLeft === 0 || hidden)) return null;

  const doneCount = items.filter((item) => item.done).length;
  return (
    <Card
      title={essentialsDone ? "A few optional extras" : "Finish setting up"}
      description={`${doneCount} of ${items.length} done.`}
    >
      <div className="px-5 py-2">
        <ul className="divide-y divide-line">
          {required.map((item) => (
            <Item key={item.key} item={item} />
          ))}
        </ul>
        <p className="mt-3 text-xs font-medium uppercase tracking-[0.06em] text-muted">
          Optional
        </p>
        <ul className="divide-y divide-line">
          {optional.map((item) => (
            <Item key={item.key} item={item} />
          ))}
        </ul>
        {essentialsDone && (
          <div className="flex justify-end py-2">
            <Button
              variant="ghost"
              onClick={() => {
                try {
                  localStorage.setItem(HIDDEN, "1");
                } catch {
                  // Hidden for this visit only.
                }
                setHidden(true);
              }}
            >
              Hide
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
