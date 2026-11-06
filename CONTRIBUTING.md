# Contributing

Thanks for helping. GitNut is small on purpose, so a short issue before a big change saves time.

1. `bun install`, then `bun run dev` to try your change (daemon + web client + site).
2. Add or update tests. Name them after the requirement in `docs/REQUIREMENTS.md` (`R-...`).
3. `bun run check` (typecheck, Biome lint, unit tests) and `bunx playwright test` must pass.
4. Open a pull request against `main`. CI runs the same checks.

Conventions (components, styling, naming, security) are in [AGENTS.md](AGENTS.md). They apply to
people too.

By contributing you agree that your contribution is licensed under Apache-2.0 (see `LICENSE`).
