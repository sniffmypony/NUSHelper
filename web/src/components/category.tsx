import {
  Bell,
  CalendarDays,
  CircleCheck,
  Flag,
  GraduationCap,
  PenLine,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

// Calendar categories (web/DESIGN.md §2): each type has its own hue at one
// lightness and chroma, and its own icon, so colour is never the only cue.

export type Category =
  "event" | "exam" | "deadline" | "reminder" | "class" | "task" | "spend";

export const CATEGORY: Record<
  Category,
  { label: string; icon: LucideIcon; dot: string; text: string; tint: string }
> = {
  class: {
    label: "Class",
    icon: GraduationCap,
    dot: "bg-cat-class",
    text: "text-cat-class",
    tint: "tint-class",
  },
  event: {
    label: "Event",
    icon: CalendarDays,
    dot: "bg-cat-event",
    text: "text-cat-event",
    tint: "tint-event",
  },
  exam: {
    label: "Exam",
    icon: PenLine,
    dot: "bg-cat-exam",
    text: "text-cat-exam",
    tint: "tint-exam",
  },
  deadline: {
    label: "Deadline",
    icon: Flag,
    dot: "bg-cat-deadline",
    text: "text-cat-deadline",
    tint: "tint-deadline",
  },
  reminder: {
    label: "Reminder",
    icon: Bell,
    dot: "bg-cat-reminder",
    text: "text-cat-reminder",
    tint: "tint-reminder",
  },
  task: {
    label: "Task",
    icon: CircleCheck,
    dot: "bg-cat-task",
    text: "text-cat-task",
    tint: "tint-task",
  },
  spend: {
    label: "Spending",
    icon: Wallet,
    dot: "bg-cat-spend",
    text: "text-cat-spend",
    tint: "tint-spend",
  },
};

// Exams (finals the bot added, or any event called an exam) get their own
// colour; other Google Calendar events share the event colour.
export function isExam(title: string): boolean {
  return /\b(final|finals|exam|midterm|quiz)\b/i.test(title);
}

// Calendar titles the bot writes start with an emoji ("📝 Final: …"); the
// category icon already says it, so it's dropped from the UI.
export function cleanTitle(title: string): string {
  return title.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
}

export function Dot({
  category,
  className = "",
}: {
  category: Category;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY[category].dot} ${className}`}
    />
  );
}

export function CategoryIcon({
  category,
  size = 15,
  className = "",
}: {
  category: Category;
  size?: number;
  className?: string;
}) {
  const Icon = CATEGORY[category].icon;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-hidden
      className={`shrink-0 ${CATEGORY[category].text} ${className}`}
    />
  );
}

// A module code or category label: neutral chip with a coloured dot.
export function Pill({
  category,
  className = "",
  children,
}: {
  category: Category;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md bg-sunken px-1.5 py-0.5 text-xs font-medium text-ink ring-1 ring-line ring-inset ${className}`}
    >
      <Dot category={category} />
      <span className="truncate">{children}</span>
    </span>
  );
}
