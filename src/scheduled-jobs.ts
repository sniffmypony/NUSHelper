import { timingSafeEqual } from "node:crypto";
import { singaporeDateRange } from "./dates.js";
import { isCalendarConfigured } from "./calendar/config.js";
import { getCalendarGateway } from "./calendar/google.js";
import { withVercelOidcToken } from "./calendar/request-context.js";
import type { CalendarAgendaEvent } from "./calendar/types.js";

// Shared by the scheduled jobs in api/cron.

// Does an Authorization header carry "Bearer <secret>"? Compared in constant
// time so response timing can't reveal the secret. An unset secret never
// matches.
export function hasBearerSecret(
  header: string | undefined,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim();
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

// Vercel sends CRON_SECRET with each cron request it makes.
export function isVercelCron(header: string | undefined): boolean {
  return hasBearerSecret(header, process.env.CRON_SECRET);
}

// Google Calendar events for `days` days from `startDate` (Singapore dates).
// Calendar is optional: without it there are no events; if it can't be read,
// `failed` is set and the job sends its message without them.
export async function readCalendarDays(
  oidcHeader: string | string[] | undefined,
  startDate: string,
  days: number,
  job: string,
): Promise<{ events: CalendarAgendaEvent[]; failed: boolean }> {
  if (!isCalendarConfigured()) return { events: [], failed: false };
  try {
    const range = singaporeDateRange(startDate, days);
    const events = await withVercelOidcToken(oidcHeader, async () => {
      const gateway = await getCalendarGateway();
      return gateway.listRange(range.timeMin, range.timeMax);
    });
    return { events, failed: false };
  } catch (error) {
    console.error(`${job} Calendar query failed:`, error);
    return { events: [], failed: true };
  }
}
