# NUSHelper

A private Telegram bot plus a website (`web/`) for one NUS student. See
`README.md` for features and setup.

## Website design

Before changing anything in `web/`, read `web/DESIGN.md` and follow it:
OKLCH colour tokens (60:30:10), translucent borders, nested corner radii,
lucide icons matched to text weight, and subtle physical motion (settle-in
entrances, 0.97 button presses, shakes for rejected input, directional
slides, `interpolate-size` accordions, transform/opacity only, reduced
motion respected). Reuse the shared components in `web/src/components/`.

## Working rules

- Database queries run one at a time (`await` each). Never `Promise.all`
  queries: the single pooled connection hangs on Supabase's pooler. The
  client also sets `max_pipeline: 0` (`src/db/client.ts`) so queries from
  concurrent requests on one Vercel instance wait their turn instead of
  being pipelined; keep it.
- Run `pnpm test`, `pnpm run typecheck`, `pnpm run lint` and
  `pnpm run format:check` before opening a PR.
