import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { navigate } from "../navigation";
import { ICON } from "./icons";

// "This feature isn't set up" with a way to fix it, in place of a control
// that would only fail.
export function FeatureOff({
  children,
  href = "/settings",
  action = "Open Settings",
}: {
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-sunken px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 basis-56 text-muted">{children}</p>
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          navigate(href);
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-1 font-medium text-accent-text hover:underline"
      >
        <Settings {...ICON} size={15} />
        {action}
      </a>
    </div>
  );
}
