import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";

export const TELEGRAM_MESSAGE_LIMIT = 4096;
// Leave headroom below Telegram's hard limit.
const DEFAULT_CHUNK_SIZE = 4000;

export interface DueItem {
  moduleCode: string;
  name: string;
  dueAt: string;
  submitted: boolean;
}

export function formatDueTime(iso: string): string {
  return DateTime.fromISO(iso, { zone: "utc" })
    .setZone(SINGAPORE_TIME_ZONE)
    .toFormat("ccc d LLL, HH:mm");
}

export function isWithinDays(iso: string, now: Date, days: number): boolean {
  const due = DateTime.fromISO(iso, { zone: "utc" });
  if (!due.isValid) return false;
  const start = DateTime.fromJSDate(now);
  return due >= start && due <= start.plus({ days });
}

// Modules are ordered by their earliest deadline; items within a module by due date.
export function formatDueItemsByModule(
  items: DueItem[],
  daysAhead: number,
): string {
  if (items.length === 0) {
    return `Nothing due in the next ${daysAhead} days.`;
  }

  const groups = new Map<string, DueItem[]>();
  for (const item of [...items].sort((a, b) =>
    a.dueAt.localeCompare(b.dueAt),
  )) {
    const group = groups.get(item.moduleCode) ?? [];
    group.push(item);
    groups.set(item.moduleCode, group);
  }

  const lines = [`Due in the next ${daysAhead} days (Singapore time):`];
  for (const [moduleCode, group] of groups) {
    lines.push("", moduleCode);
    for (const item of group) {
      lines.push(
        `• ${formatDueTime(item.dueAt)} — ${item.name}${item.submitted ? " ✅ submitted" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Some models emit their reasoning inline (<think>, or MiniMax's <mm:think>
// when streaming); never forward it to Telegram. A closing tag with no
// opening one ends reasoning whose opening tag the provider left out, and an
// unclosed block is reasoning that was cut off. Markdown is kept: model
// replies are sent as rich messages.
export function cleanModelText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<([\w-]+:)?think>[\s\S]*?<\/([\w-]+:)?think>/gi, "")
    .replace(/^[\s\S]*<\/([\w-]+:)?think>/i, "")
    .replace(/<([\w-]+:)?think>[\s\S]*$/i, "")
    .replace(/<tool_data>[\s\S]*?<\/tool_data>/gi, "")
    .trim();
}

// Telegram's rich-message limit is 32768 characters; leave headroom.
export const RICH_MESSAGE_CHUNK_SIZE = 32_000;

// In rich Markdown "$...$" is an inline formula, so "S$9.80 and S$5" would
// render as maths. A fullwidth dollar sign looks the same and is not a
// formula delimiter.
export function protectCurrency(markdown: string): string {
  return markdown.replace(/\bS\$(?=\d)/g, "S＄");
}

// For the plain-text fallback, where Markdown markers would show literally.
// LaTeX is left as written: still readable to someone who knows it.
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

// Some models occasionally write a tool call as plain text (e.g. MiniMax's
// "<tool_call><invoke name=...>" with "]<]minimax[>[" separators) instead of
// using the tools API. Such text must never reach the user.
const TOOL_MARKUP =
  /<\/?(tool_call|tool_calls|invoke|function_calls?|parameter|tool_use|arg_key|arg_value)\b|\]<\]|\]~b\]|minimax\[|<\|[a-z_]+\|>|<\/?[a-z_]+:tool_call/i;

export function looksLikeToolMarkup(text: string | null | undefined): boolean {
  return TOOL_MARKUP.test(text ?? "");
}

// Splits on line boundaries where possible so lists are not cut mid-item.
export function splitTelegramMessage(
  text: string,
  limit = DEFAULT_CHUNK_SIZE,
): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const line of text.split("\n")) {
    let remaining = line;
    while (remaining.length > limit) {
      flush();
      chunks.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
    const candidate = current ? `${current}\n${remaining}` : remaining;
    if (candidate.length > limit) {
      flush();
      current = remaining;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks.filter((chunk) => chunk.trim().length > 0);
}
