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

// The time now in Singapore, as minutes after midnight.
export function nowMinutes(): number {
  const [hours, minutes] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .split(":")
    .map(Number);
  return hours * 60 + minutes;
}

export function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
}

export function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// "in 25 min", "in 2 h 30 min", "in 3 h".
export function inTime(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest && hours < 3 ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

// "Y2S1W13, AY 26/27" -> "Week 13"; "Y2S1 Reading Week, AY 26/27" ->
// "Reading Week"; anything else is kept as it is.
export function weekLabel(label: string): string {
  const head = label.split(",")[0];
  const week = /W(\d+)$/.exec(head);
  if (week) return `Week ${week[1]}`;
  const named = /^Y\d+S\d+\s+(.+)$/.exec(head);
  return named ? named[1] : head;
}
