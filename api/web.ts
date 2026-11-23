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
        },
        webDependencies,
      ),
  );
  if (response.setCookie) res.setHeader("Set-Cookie", response.setCookie);
  return res.status(response.status).json(response.body);
}
