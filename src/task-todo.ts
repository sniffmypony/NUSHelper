export type TodoListItem = {
  id: number;
  description: string;
  taskId: number | null;
};

export function isTaskDueOn(dueDate: string | null, date: string): boolean {
  return dueDate === date;
}

export function formatTodoItem(item: TodoListItem): string {
  return `#${item.id} ${item.description}${item.taskId ? ` (task #${item.taskId})` : ""}`;
}
