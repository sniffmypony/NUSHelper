import type { ReactNode } from "react";

// Calendar categories (web/DESIGN.md §3): each type has its own colour,
// shown as a dot or as a tinted pill with a bar of the colour.

export type Category =
  "event" | "exam" | "deadline" | "reminder" | "class" | "task" | "spend";

// Exams (finals the bot added, or any event called an exam) get their own
// colour; other Google Calendar events share the event colour.
export function isExam(title: string): boolean {
  return /\b(final|finals|exam|midterm|quiz)\b/i.test(title);
}

const DOT: Record<Category, string> = {
  event: "bg-cat-event",
  exam: "bg-cat-exam",
  deadline: "bg-cat-deadline",
  reminder: "bg-cat-reminder",
  class: "bg-cat-class",
  task: "bg-cat-task",
  spend: "bg-cat-spend",
};

export function Dot({ category }: { category: Category }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[category]}`}
    />
  );
}

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
    <span className={`pill pill-${category} rounded px-1.5 ${className}`}>
      {children}
    </span>
  );
}
