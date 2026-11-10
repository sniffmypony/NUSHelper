export type MessageLine = {
  lineNumber: number;
  sourceLine: number;
  text: string;
};

export function splitMessageLines(text: string): MessageLine[] {
  return text
    .split(/\r?\n/)
    .map((line, sourceLine) => ({
      lineNumber: sourceLine + 1,
      sourceLine,
      text: line.trim(),
    }))
    .filter((line) => line.text.length > 0);
}

export function parseTodoCommandLine(line: string): string | null {
  const match = /^\/todo(?:@\w+)? ([^\s].*)$/.exec(line.trimEnd());
  if (!match) return null;

  const description = match[1].trimEnd();
  return description.length > 0 ? description : null;
}

export type ParsedReminderCommand = {
  hour: number;
  minute: number;
  description: string;
};

export function parseReminderCommandLine(
  line: string,
): ParsedReminderCommand | null {
  const match = /^\/remind(?:@\w+)? (\d{4}) ([^\s].*)$/.exec(line.trimEnd());
  if (!match) return null;

  const hour = Number(match[1].slice(0, 2));
  const minute = Number(match[1].slice(2, 4));
  const description = match[2].trimEnd();
  if (hour > 23 || minute > 59 || description.length === 0) return null;

  return { hour, minute, description };
}
