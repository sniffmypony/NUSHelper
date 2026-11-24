import { useState, type ReactNode } from "react";
import { navigate } from "../navigation";

export const NAV = [
  { path: "/today", label: "Today", icon: "☀️", ready: false },
  { path: "/calendar", label: "Calendar", icon: "📅", ready: true },
  { path: "/chat", label: "Chat", icon: "💬", ready: true },
  { path: "/tasks", label: "Tasks", icon: "✅", ready: false },
  { path: "/spending", label: "Spending", icon: "💰", ready: false },
  { path: "/timetable", label: "Timetable", icon: "🏫", ready: false },
  { path: "/deadlines", label: "Deadlines", icon: "📌", ready: false },
  { path: "/settings", label: "Settings", icon: "⚙️", ready: true },
] as const;

function NavItems({ path, onPick }: { path: string; onPick: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = path.startsWith(item.path);
        return (
          <a
            key={item.path}
            href={item.path}
            onClick={(event) => {
              event.preventDefault();
              navigate(item.path);
              onPick();
            }}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <span aria-hidden className="w-5 text-center">
              {item.icon}
            </span>
            <span className="flex-1">{item.label}</span>
            {!item.ready && (
              <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Soon
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <div>
        <div className="text-sm font-semibold leading-tight">NUSHelper</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Planner & assistant
        </div>
      </div>
    </div>
  );
}

export function Shell({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-slate-200 bg-white px-3 py-5 md:flex dark:border-slate-800 dark:bg-slate-900">
        <Brand />
        <NavItems path={path} onPick={() => {}} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-900/90">
          <Brand />
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Menu"
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {open ? "Close" : "Menu"}
          </button>
        </header>
        {open && (
          <div className="border-b border-slate-200 bg-white px-3 py-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
            <NavItems path={path} onPick={() => setOpen(false)} />
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
