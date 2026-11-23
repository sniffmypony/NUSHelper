import type { VercelRequest, VercelResponse } from "@vercel/node";
import { refreshSettings } from "../../src/settings/runtime.js";
import { isCalendarConfigured } from "../../src/calendar/config.js";
import { getCalendarGateway } from "../../src/calendar/google.js";
import { withVercelOidcToken } from "../../src/calendar/request-context.js";
import { CanvasClient } from "../../src/canvas/client.js";
import { deadlineStore } from "../../src/canvas/deadline-store.js";
import {
  formatSyncResult,
  syncDeadlines,
} from "../../src/canvas/deadline-sync.js";
import { canvasConfig, isCanvasConfigured } from "../../src/env.js";
import { isVercelCron } from "../../src/scheduled-jobs.js";
import { sendToTopic } from "../../src/topics.js";

// Daily, before the 8am message: copies upcoming Canvas deadlines, puts them
// on Google Calendar, and says what is new, moved or gone.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isVercelCron(req.headers.authorization)) {
    return res.status(401).send("unauthorized");
  }

  // Settings changed on the website override Vercel's.
  await refreshSettings();
  if (!isCanvasConfigured()) return res.status(200).send("canvas off");

  try {
    const { baseUrl, token } = canvasConfig();
    const calendarOn = isCalendarConfigured();
    const result = await withVercelOidcToken(
      req.headers["x-vercel-oidc-token"],
      async () =>
        syncDeadlines(
          new CanvasClient(baseUrl, token),
          deadlineStore,
          calendarOn ? await getCalendarGateway() : null,
          new Date(),
        ),
    );
    const text = formatSyncResult(result, calendarOn);
    if (text) await sendToTopic("planner", text);
    return res.status(200).json({
      added: result.added.length,
      moved: result.moved.length,
      removed: result.removed.length,
      calendarFailed: result.calendarFailed,
      skippedCourses: result.skippedCourses.length,
    });
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Canvas deadline sync failed (${type})`);
    return res.status(502).send("canvas deadline sync failed");
  }
}
