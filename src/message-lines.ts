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

// Which day a reminder is for. No day means today.
export type ReminderDay =
  | { kind: "tomorrow" }
  // Without a year, the next time that date comes round.
  | { kind: "date"; day: number; month: number; year?: number };

export type ParsedReminderCommand = {
  hour: number;
  minute: number;
  description: string;
  day?: ReminderDay;
};

// "/remind HHMM text" is for today. A day may come first: "tmr", "tomorrow",
// "DD-MM" or "DD-MM-YYYY", e.g. "/remind 20-11 0900 submit form".
export function parseReminderCommandLine(
  line: string,
): ParsedReminderCommand | null {
  const match =
    /^\/remind(?:@\w+)? (?:(tmr|tomorrow|\d{1,2}-\d{1,2}(?:-\d{4})?) )?(\d{4}) ([^\s].*)$/i.exec(
      line.trimEnd(),
    );
  if (!match) return null;

  const hour = Number(match[2].slice(0, 2));
  const minute = Number(match[2].slice(2, 4));
  const description = match[3].trimEnd();
  if (hour > 23 || minute > 59 || description.length === 0) return null;

  const command: ParsedReminderCommand = { hour, minute, description };
  if (!match[1]) return command;
  if (/^t/i.test(match[1])) return { ...command, day: { kind: "tomorrow" } };

  const [day, month, year] = match[1].split("-").map(Number);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return {
    ...command,
    day: { kind: "date", day, month, ...(year ? { year } : {}) },
  };
}
