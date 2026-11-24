import {
  CalendarDays,
  Flag,
  GraduationCap,
  ListChecks,
  Menu,
  MessageSquare,
  Settings,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { navigate } from "../navigation";
import { ICON } from "./icons";
import { Logo } from "./Logo";
import { SwapIcon } from "./motion";
import { ThemeButton, ThemeSwitch } from "./ThemeSwitch";

export const NAV = [
  { path: "/today", label: "Today", icon: Sun, ready: false },
  { path: "/calendar", label: "Calendar", icon: CalendarDays, ready: true },
  { path: "/chat", label: "Chat", icon: MessageSquare, ready: true },
  { path: "/tasks", label: "Tasks", icon: ListChecks, ready: false },
  { path: "/spending", label: "Spending", icon: Wallet, ready: false },
  { path: "/timetable", label: "Timetable", icon: GraduationCap, ready: false },
  { path: "/deadlines", label: "Deadlines", icon: Flag, ready: false },
  { path: "/settings", label: "Settings", icon: Settings, ready: true },
] as const;

function NavItems({ path, onPick }: { path: string; onPick: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = path.startsWith(item.path);
        const Icon = item.icon;
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
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 ${
              active
                ? "bg-accent-soft text-accent-text"
                : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            <Icon {...ICON} />
            <span className="flex-1">{item.label}</span>
            {!item.ready && (
              <span className="rounded bg-sunken px-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
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
      <Logo size={32} />
      <div>
        <div className="text-sm font-semibold leading-tight">NUSHelper</div>
        <div className="text-xs text-muted">Planner & assistant</div>
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-5 md:flex">
        <Brand />
        <NavItems path={path} onPick={() => {}} />
        <div className="mt-auto px-3">
          <ThemeSwitch />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeButton />
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Menu"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-[transform,background-color,color] duration-150 ease-out hover:bg-hover hover:text-ink active:scale-[0.97] motion-reduce:active:scale-100"
            >
              <SwapIcon
                show={open ? "close" : "menu"}
                icons={{
                  menu: <Menu {...ICON} size={18} />,
                  close: <X {...ICON} size={18} />,
                }}
              />
            </button>
          </div>
        </header>
        {open && (
          <div className="origin-top animate-settle border-b border-line bg-surface px-3 py-3 md:hidden">
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
