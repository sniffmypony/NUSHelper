import type { VercelRequest, VercelResponse } from "@vercel/node";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { tasks } from "../../src/db/schema.js";
import {
  addDays,
  mondayOfSingaporeWeek,
  singaporeDateRange,
  todayInSingapore,
} from "../../src/dates.js";
import { sendTelegramMessage } from "../../src/telegram.js";
import { formatCalendarAgenda } from "../../src/calendar/agenda.js";
import { isCalendarConfigured } from "../../src/calendar/config.js";
import { getCalendarGateway } from "../../src/calendar/google.js";
import { withVercelOidcToken } from "../../src/calendar/request-context.js";
import type { CalendarAgendaEvent } from "../../src/calendar/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel adds this header automatically for cron-triggered requests when CRON_SECRET is set
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send("unauthorized");
  }

  const weekStart = mondayOfSingaporeWeek(todayInSingapore());
  const weekEnd = addDays(weekStart, 6);

  let due: (typeof tasks.$inferSelect)[];
  try {
    due = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.done, false),
          gte(tasks.dueDate, weekStart),
          lte(tasks.dueDate, weekEnd),
        ),
      )
      .orderBy(asc(tasks.dueDate), asc(tasks.id));
  } catch (error) {
    console.error("Weekly digest database query failed:", error);
    return res.status(500).send("weekly digest database query failed");
  }

  let calendarEvents: CalendarAgendaEvent[] = [];
  let calendarReadFailed = false;
  // Google Calendar is optional: without it the section is simply left out.
  if (isCalendarConfigured())
    try {
      const range = singaporeDateRange(weekStart, 7);
      calendarEvents = await withVercelOidcToken(
        req.headers["x-vercel-oidc-token"],
        async () => {
          const gateway = await getCalendarGateway();
          return gateway.listRange(range.timeMin, range.timeMax);
        },
      );
    } catch (error) {
      calendarReadFailed = true;
      console.error("Weekly digest Calendar query failed:", error);
    }

  const sections: string[] = [];
  if (calendarEvents.length) {
    sections.push(
      "📅 Google Calendar:\n" + formatCalendarAgenda(calendarEvents),
    );
  }
  if (due.length) {
    sections.push(
      "📋 Open tasks due this week:\n" +
        due
          .map(
            (t) =>
              `#${t.id} ${t.description}${t.module ? ` [${t.module}]` : ""} — ${t.dueDate}`,
          )
          .join("\n"),
    );
  }
  if (calendarReadFailed) {
    sections.push(
      "⚠️ I couldn't check Google Calendar, so this digest may be incomplete.",
    );
  }

  const text = sections.length
    ? `📆 This week (${weekStart} to ${weekEnd})\n\n${sections.join("\n\n")}`
    : "Nothing due this week 🎉";

  try {
    await sendTelegramMessage(text);
    return res.status(200).send("sent");
  } catch (error) {
    console.error("Weekly digest Telegram delivery failed:", error);
    return res.status(502).send("weekly digest delivery failed");
  }
}
