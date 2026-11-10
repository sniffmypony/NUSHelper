import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import type { CalendarAgendaEvent } from "./types.js";

export function formatCalendarAgendaEvent(event: CalendarAgendaEvent): string {
  if (event.allDay) {
    const day = DateTime.fromISO(event.startDate, {
      zone: SINGAPORE_TIME_ZONE,
    }).toFormat("ccc d LLL");
    return `• ${day}, all day — ${event.title}`;
  }

  const start = DateTime.fromISO(event.startDateTime).setZone(
    SINGAPORE_TIME_ZONE,
  );
  const end = DateTime.fromISO(event.endDateTime).setZone(SINGAPORE_TIME_ZONE);
  const day = start.toFormat("ccc d LLL");
  const time =
    start.toISODate() === end.toISODate()
      ? `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`
      : `${start.toFormat("HH:mm")}–${end.toFormat("ccc d LLL HH:mm")}`;
  return `• ${day}, ${time} — ${event.title}`;
}

export function formatCalendarAgenda(events: CalendarAgendaEvent[]): string {
  return events.map(formatCalendarAgendaEvent).join("\n");
}
