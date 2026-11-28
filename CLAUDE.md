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
  queries within a request: Supabase's pooler can hang on queries pipelined
  on one connection. The client (`src/db/client.ts`) allows several
  connections per instance so concurrent requests don't pipeline; never
  lower `max_pipeline` (transactions depend on it). Changes to the client
  must pass `tests/db.integration.test.ts` (CI runs it against Postgres).
- Run `pnpm test`, `pnpm run typecheck`, `pnpm run lint` and
  `pnpm run format:check` before opening a PR.
