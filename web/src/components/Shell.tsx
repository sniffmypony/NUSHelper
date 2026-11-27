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
import { ThemeButton } from "./ThemeSwitch";

export const NAV = [
  { path: "/today", label: "Today", icon: Sun },
  { path: "/calendar", label: "Calendar", icon: CalendarDays },
  { path: "/chat", label: "Chat", icon: MessageSquare },
  { path: "/tasks", label: "Tasks", icon: ListChecks },
  { path: "/spending", label: "Spending", icon: Wallet },
  { path: "/timetable", label: "Timetable", icon: GraduationCap },
  { path: "/deadlines", label: "Deadlines", icon: Flag },
  { path: "/settings", label: "Settings", icon: Settings },
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
            // The active page: a slightly lighter fill, white text, an orange
            // icon and a 2 px orange marker; the rest stay quiet.
            className={`relative flex items-center gap-3 rounded-[10px] px-3 py-[7px] text-sm font-medium transition-[transform,background-color,color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97] motion-reduce:active:scale-100 ${
              active
                ? "bg-nav-active text-nav-ink before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-accent"
                : "text-nav-muted hover:bg-nav-hover hover:text-nav-ink"
            }`}
          >
            <Icon {...ICON} className={active ? "text-accent" : ""} />
            <span className="flex-1">{item.label}</span>
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
        <div className="text-sm font-semibold leading-tight text-nav-ink">
          NUSHelper
        </div>
        <div className="text-xs text-nav-muted">Planner & assistant</div>
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 border-r border-line bg-nav px-3 py-4 md:flex">
        <Brand />
        <NavItems path={path} onPick={() => {}} />
        <div className="mt-auto">
          <ThemeButton labelled />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-nav px-4 py-3 md:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeButton />
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Menu"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-nav-muted transition-[transform,background-color,color] duration-150 ease-out hover:bg-nav-hover hover:text-nav-ink active:scale-[0.97] motion-reduce:active:scale-100"
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
          <div className="origin-top animate-settle bg-nav px-3 pb-3 md:hidden">
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
