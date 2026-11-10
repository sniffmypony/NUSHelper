# Contributing

Thanks for helping improve NUSHelper.

1. Fork the repository and create a branch.
2. `pnpm install`, then make your change, following the style of the surrounding code.
3. Add or update tests in `tests/` for behaviour changes.
4. Make sure these all pass:

   ```sh
   pnpm run format:check
   pnpm run lint
   pnpm run typecheck
   pnpm test
   ```

5. Open a pull request describing what changed and why.

Database changes go in a new file in `supabase/migrations`; don't edit existing migrations, since other people have already applied them.

Never commit `.env` or any real token, key or personal data. See [SECURITY.md](SECURITY.md).
