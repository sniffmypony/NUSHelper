# NUSHelper

A private Telegram bot plus a website (`web/`) for one NUS student. See
`README.md` for features and setup.

## Website design

Before changing anything in `web/`, read `web/DESIGN.md` and follow it
("Notebook"): OKLCH tokens only (warm neutrals, one pine action colour,
marigold only for "now"), states with an icon and a word, flat panels with
hairline borders, Undo for reversible changes and `useConfirm` for
irreversible ones (never `window.confirm`), and restrained motion (CSS for
presses and entrances, Motion via `LazyMotion` for exits, layout and shared
indicators; transform/opacity only; reduced motion respected). Reuse the
shared components in `web/src/components/`. The Motion AI Kit's skills
(`.claude/skills/motion*`) and its MCP server (`.mcp.json`) help with
animation work.

## Working rules

- Database queries run one at a time (`await` each). Never `Promise.all`
  queries within a request: Supabase's pooler can hang on queries pipelined
  on one connection. The client (`src/db/client.ts`) allows several
  connections per instance so concurrent requests don't pipeline; never
  lower `max_pipeline` (transactions depend on it). Changes to the client
  must pass `tests/db.integration.test.ts` (CI runs it against Postgres).
- Run `pnpm test`, `pnpm run typecheck`, `pnpm run lint` and
  `pnpm run format:check` before opening a PR.
