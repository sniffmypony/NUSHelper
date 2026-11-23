// Calendar date helpers on YYYY-MM-DD strings (the bot's days are Singapore
// days; the browser's own time zone doesn't matter for these).

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const date = fromIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// Today in Singapore.
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
  }).format(new Date());
}

// The Monday-to-Sunday weeks covering a month: [first Monday, last Sunday].
export function monthGrid(year: number, month: number): [string, string] {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const backToMonday = (first.getUTCDay() + 6) % 7;
  const onToSunday = (7 - last.getUTCDay()) % 7;
  return [
    addDays(toIso(first), -backToMonday),
    addDays(toIso(last), onToSunday),
  ];
}

export function formatDay(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return fromIso(iso).toLocaleDateString("en-SG", {
    timeZone: "UTC",
    ...options,
  });
}

export function formatMoney(cents: number): string {
  return `S$${(cents / 100).toFixed(2)}`;
}
