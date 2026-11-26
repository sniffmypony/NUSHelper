import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ICON } from "./icons";
import { SwapIcon } from "./motion";
import { Button } from "./ui";

// Pieces shared by the Settings cards that walk through a setup (Apple Pay,
// Bank emails): numbered steps, text to copy, and "5 min ago".

export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
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
    </Button>
  );
}

export function CopyText({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-lg bg-sunken px-2.5 py-1.5 text-xs">
        {value}
      </code>
      <CopyButton value={value} label={label} />
    </div>
  );
}

// Several lines of code, scrolling inside its own box.
export function CopyBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="relative rounded-xl bg-sunken ring-1 ring-line ring-inset">
      <pre className="max-h-64 overflow-auto p-3 pr-12 text-[11px] leading-relaxed">
        <code>{value}</code>
      </pre>
      <div className="absolute top-1 right-1 rounded-lg bg-sunken">
        <CopyButton value={value} label={label} />
      </div>
    </div>
  );
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">{children}</div>
    </li>
  );
}

export function OnOff({ on }: { on: boolean }) {
  return (
    <span
      className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-line ring-inset ${
        on ? "bg-ok-soft text-ok" : "bg-sunken text-muted"
      }`}
    >
      {on ? "On" : "Off"}
    </span>
  );
}
