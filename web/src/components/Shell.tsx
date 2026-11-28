import { AnimatePresence, m } from "motion/react";
import {
  CalendarDays,
  Ellipsis,
  Flag,
  GraduationCap,
  ListChecks,
  MessageSquare,
  Settings,
  Sun,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { navigate } from "../navigation";
import { ICON } from "./icons";
import { Logo } from "./Logo";
import { DUR, EASE_IN, EASE_OUT, SPRING, Tooltip } from "./motion";
import { ThemeButton, ThemeSwitch } from "./ThemeSwitch";

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}

export const NAV: NavItem[] = [
  { path: "/today", label: "Today", icon: Sun, hint: "Your day at a glance" },
  {
    path: "/calendar",
    label: "Calendar",
    icon: CalendarDays,
    hint: "Month, events and reminders",
  },
  {
    path: "/tasks",
    label: "Tasks",
    icon: ListChecks,
    hint: "Tasks, to-dos and birthdays",
  },
  {
    path: "/chat",
    label: "Chat",
    icon: MessageSquare,
    hint: "Ask the assistant",
  },
  {
    path: "/spending",
    label: "Spending",
    icon: Wallet,
    hint: "Daily and monthly totals",
  },
  {
    path: "/timetable",
    label: "Timetable",
    icon: GraduationCap,
    hint: "Classes and finals",
  },
  {
    path: "/deadlines",
    label: "Deadlines",
    icon: Flag,
    hint: "Canvas assignments",
  },
  {
    path: "/settings",
    label: "Settings",
    icon: Settings,
    hint: "Connections, keys and theme",
  },
];

// Phones show the four daily pages as tabs; the rest are under More.
const TABS = ["/today", "/calendar", "/tasks", "/chat"];
const MORE = NAV.filter((item) => !TABS.includes(item.path));

function go(event: React.MouseEvent, path: string, then?: () => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  navigate(path);
  then?.();
}

// Desktop sidebar (lg) and icon rail (md). The current page's background
// slides from the old item to the new one.
function SideNav({ path }: { path: string }) {
  const main = NAV.filter((item) => item.path !== "/settings");
  const settings = NAV.find((item) => item.path === "/settings")!;
  const link = (item: NavItem) => {
    const active = path.startsWith(item.path);
    const Icon = item.icon;
    const anchor = (
      <a
        href={item.path}
        onClick={(event) => go(event, item.path)}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        className={`relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-[color,transform] duration-[var(--dur-fast)] ease-out active:scale-[0.97] motion-reduce:active:scale-100 max-lg:w-10 max-lg:justify-center max-lg:px-0 ${
          active ? "text-ink" : "text-muted hover:bg-hover hover:text-ink"
        }`}
      >
        {active && (
          <m.span
            layoutId="side-nav-active"
            transition={SPRING.snap}
            className="absolute inset-0 rounded-lg border border-line bg-surface shadow-[0_1px_2px_oklch(0.3_0.02_75/0.06)]"
          />
        )}
        <Icon
          {...ICON}
          size={17}
          className={`relative ${active ? "text-accent" : ""}`}
        />
        <span className="relative max-lg:sr-only">{item.label}</span>
      </a>
    );
    return (
      <li key={item.path}>
        <span className="lg:hidden">
          <Tooltip label={item.label}>{anchor}</Tooltip>
        </span>
        <span className="max-lg:hidden">{anchor}</span>
      </li>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-canvas px-3 py-4 md:flex md:w-[68px] md:items-center lg:w-60 lg:items-stretch">
      <a
        href="/today"
        onClick={(event) => go(event, "/today")}
        className="mb-6 flex items-center gap-2.5 rounded-lg px-2 py-1 lg:px-3"
      >
        <Logo size={28} />
        <span className="text-[15px] font-semibold tracking-tight max-lg:sr-only">
          NUSHelper
        </span>
      </a>
      <nav aria-label="Main" className="flex flex-1 flex-col">
        <ul className="flex flex-col gap-0.5">{main.map(link)}</ul>
        <ul className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
          {link(settings)}
          <li>
            <span className="lg:hidden">
              <ThemeButton compact />
            </span>
            <span className="max-lg:hidden">
              <ThemeButton />
            </span>
          </li>
        </ul>
      </nav>
    </aside>
  );
}

// Phone tab bar, fixed to the bottom above the home indicator.
function TabBar({
  path,
  onMore,
  moreOpen,
}: {
  path: string;
  onMore: () => void;
  moreOpen: boolean;
}) {
  const inMore = MORE.some((item) => path.startsWith(item.path));
  const tab = (
    key: string,
    label: string,
    Icon: LucideIcon,
    active: boolean,
    props: Record<string, unknown>,
  ) => (
    <li key={key} className="flex-1">
      {(() => {
        const content = (
          <>
            <span className="relative grid h-7 w-12 place-items-center">
              {active && (
                <m.span
                  layoutId="tab-active"
                  transition={SPRING.snap}
                  className="absolute inset-0 rounded-full bg-accent-soft"
                />
              )}
              <Icon
                {...ICON}
                size={19}
                strokeWidth={active ? 2 : 1.75}
                className={`relative ${active ? "text-accent-text" : ""}`}
              />
            </span>
            <span className="text-[11px] leading-none font-medium">
              {label}
            </span>
          </>
        );
        const className = `flex h-14 w-full flex-col items-center justify-center gap-1 transition-[color,transform] duration-[var(--dur-fast)] active:scale-[0.96] motion-reduce:active:scale-100 ${active ? "text-ink" : "text-muted"}`;
        return "href" in props ? (
          <a
            {...props}
            className={className}
            aria-current={active ? "page" : undefined}
          >
            {content}
          </a>
        ) : (
          <button type="button" {...props} className={className}>
            {content}
          </button>
        );
      })()}
    </li>
  );
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      <ul className="flex px-[max(8px,env(safe-area-inset-left,0px))]">
        {TABS.map((tabPath) => {
          const item = NAV.find((entry) => entry.path === tabPath)!;
          return tab(
            item.path,
            item.label,
            item.icon,
            path.startsWith(item.path) && !moreOpen,
            {
              href: item.path,
              onClick: (event: React.MouseEvent) => go(event, item.path),
            },
          );
        })}
        {tab("more", "More", Ellipsis, inMore || moreOpen, {
          onClick: onMore,
          "aria-expanded": moreOpen,
          "aria-haspopup": "dialog",
        })}
      </ul>
    </nav>
  );
}

// The More sheet: rises from the bottom; drag it down, tap outside or press
// Escape to close.
function MoreSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <m.div
        className="fixed inset-0 z-40 bg-[oklch(0.2_0.01_75/0.35)] md:hidden"
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { duration: DUR.base, ease: EASE_OUT },
        }}
        exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE_IN } }}
        onClick={onClose}
      />
      <m.div
        role="dialog"
        aria-modal="true"
        aria-label="More pages"
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-line bg-raised px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] shadow-pop md:hidden"
        initial={{ y: "100%" }}
        animate={{ y: 0, transition: SPRING.sheet }}
        exit={{ y: "100%", transition: { duration: DUR.slow, ease: EASE_IN } }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 80 || info.velocity.y > 500) onClose();
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong"
        />
        <ul className="grid gap-1">
          {MORE.map((item, index) => {
            const Icon = item.icon;
            const active = path.startsWith(item.path);
            return (
              <li key={item.path}>
                <a
                  ref={index === 0 ? first : undefined}
                  href={item.path}
                  onClick={(event) => go(event, item.path, onClose)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 items-center gap-3 rounded-xl px-3 transition-[background-color,transform] duration-[var(--dur-fast)] active:scale-[0.98] motion-reduce:active:scale-100 ${active ? "bg-accent-soft" : "hover:bg-hover"}`}
                >
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-lg ${active ? "bg-surface text-accent-text" : "bg-sunken text-muted"}`}
                  >
                    <Icon {...ICON} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-ink">
                      {item.label}
                    </span>
                    <span className="block text-[13px] text-muted">
                      {item.hint}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line px-1 pt-3">
          <span className="text-sm font-medium text-muted">Theme</span>
          <ThemeSwitch />
        </div>
      </m.div>
    </>
  );
}

export function Shell({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const section = NAV.find((item) => path.startsWith(item.path))?.path ?? path;
  // A new page closes the sheet.
  useEffect(() => setMore(false), [section]);
  const fullHeight = section === "/chat";
  return (
    <div className="flex min-h-full">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SideNav path={path} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Each page fades and rises 4 px in; the old one leaves at once, so
            moving between pages never waits for an animation. */}
        <m.main
          id="main"
          key={section}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.base, ease: EASE_OUT }}
          className={
            fullHeight
              ? "mx-auto flex h-[calc(100dvh-57px-env(safe-area-inset-bottom,0px))] w-full max-w-6xl flex-col px-0 md:h-dvh md:px-6 md:py-6"
              : "mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+88px)] md:px-8 md:pt-9 md:pb-12"
          }
        >
          {children}
        </m.main>
      </div>
      <TabBar
        path={path}
        moreOpen={more}
        onMore={() => setMore((open) => !open)}
      />
      <AnimatePresence>
        {more && <MoreSheet path={path} onClose={() => setMore(false)} />}
      </AnimatePresence>
    </div>
  );
}
