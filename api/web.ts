import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withVercelOidcToken } from "../src/calendar/request-context.js";
import { refreshSettings } from "../src/settings/runtime.js";
import { webDependencies } from "../src/web/deps.js";
import { CSRF_HEADER, handleWebRequest } from "../src/web/router.js";

// The website's API. vercel.json rewrites /api/web/<route> to this function
// with ?route=<route>, so one function serves every route.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.route;
  const route = (Array.isArray(raw) ? raw.join("/") : (raw ?? "")).replace(
    /^\/+|\/+$/g,
    "",
  );
  res.setHeader("Cache-Control", "no-store");

  await refreshSettings();
  const header = req.headers[CSRF_HEADER];
  const response = await withVercelOidcToken(
    req.headers["x-vercel-oidc-token"],
    () =>
      handleWebRequest(
        {
          method: req.method ?? "GET",
          route,
          cookie: req.headers.cookie,
          csrfHeader: Array.isArray(header) ? header[0] : header,
          body: req.body,
          search: typeof req.query.q === "string" ? req.query.q : undefined,
        },
        webDependencies,
      ),
  );
  if (response.setCookie) res.setHeader("Set-Cookie", response.setCookie);
  if (response.stream) {
    // A chat reply: one JSON event per line, sent as it happens.
    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("X-Accel-Buffering", "no");
    const emit = (event: unknown) => {
      res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await withVercelOidcToken(req.headers["x-vercel-oidc-token"], () =>
        response.stream!(emit),
      );
    } catch (error) {
      const type = error instanceof Error ? error.name : typeof error;
      console.error(`Website chat failed (${type})`);
      emit({ type: "error", error: "Something went wrong. Please try again." });
    }
    res.end();
    return;
  }
  return res.status(response.status).json(response.body);
}
