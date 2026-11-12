export type TodoListItem = {
  id: number;
  description: string;
  taskId: number | null;
};

export type TaskListItem = {
  id: number;
  description: string;
  module: string | null;
  dueDate: string | null;
};

export function isTaskDueOn(dueDate: string | null, date: string): boolean {
  return dueDate === date;
}

// Database ids are never shown to the user: they only count every item ever
// made. The assistant gets them (withId) so its tools can name an item.

export function formatTodoItem(item: TodoListItem, withId = false): string {
  return `• ${item.description}${item.taskId ? " (from your tasks)" : ""}${withId ? ` (todo_id ${item.id})` : ""}`;
}

export function formatTaskItem(item: TaskListItem, withId = false): string {
  return `• ${item.description}${item.module ? ` [${item.module}]` : ""}${item.dueDate ? ` — due ${item.dueDate}` : ""}${withId ? ` (task_id ${item.id})` : ""}`;
}

// Picks open tasks whose description or module contains every word typed.
export function matchTasks<T extends TaskListItem>(
  items: T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const haystack = `${item.description} ${item.module ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
