# Rules for AI agents (and humans) working on GitNut

GitNut is a remote-first git client for watching what AI coding agents do across many machines,
repositories and worktrees. Its commit graph and diff viewer copy IntelliJ IDEA's git client.
Read this file before you change anything. `CLAUDE.md` only points here.

## Sources of truth

- **Scope:** `docs/REQUIREMENTS.md`. Every requirement has an id (`R-GRAPH-3`, `R-ACT-2`, ...).
  New behaviour gets a requirement line, and its tests carry the id in their name
  (`test("R-DIFF-6: ...")`), so `bun test -t R-DIFF` shows the coverage.
- **Build, release, site env vars:** `docs/BUILD.md`. Usage and SDK: `README.md`.
- **Releases and changelog:** GitHub releases of `flyingart/gitnut`. The website reads them
  (`GITNUT_GITHUB_REPO`). Notes use `### New`, `### Improved`, `### Fixed` with `- ` bullets.

## Layout

| Package | What |
| --- | --- |
| `packages/commons` | Protocol types, settings, platform/asset names, the IntelliJ graph port (`src/graph`). No DOM, no Node APIs. |
| `packages/daemon` | The `gitnut` binary: daemon + CLI. Bun only, no runtime dependencies. Runs `git` and parses its output. |
| `packages/client` | React components (the SDK). Every piece works standalone. `GitnutApp` only composes them. |
| `packages/web` | Vite app that renders `GitnutApp`; embedded into the daemon binary. |
| `packages/desktop` | Tauri v2 shell that starts the daemon sidecar. |
| `packages/site` | gitnut.dev: Astro static pages (`src/`, one `BaseLayout`), plain CSS/JS in `public/`, plus a small Bun server (`server/`: serves `dist/`, manifest, installers, GitHub releases). |
| `scripts/` | build-daemon, build-desktop (+ mac-signing), release, screenshots, dev; shared helpers (`run`, `has`, `ask`, `confirm`, `requireSiteUrl`) in `lib.ts`. |

## Commands

```sh
bun install
bun run check            # typecheck + lint (Biome) + unit tests: must pass before every commit
bunx playwright test     # browser tests against a real daemon
bun run dev              # daemon + web + site for manual testing
```

CI (`.github/workflows/ci.yml`) runs the same checks plus the e2e suite and a cross-platform
daemon build. `main` is protected: work on a branch, open a PR, wait for green CI.

## Code rules

- **Simplest thing that works.** Reuse what exists before adding code. No new dependency for
  what a few lines do. No abstractions with one user.
- **One implementation per thing.** UI primitives live in `client/src/ui.tsx` (Button incl. `variant="link"`,
  IconButton, Dialog, Popover, Menu, ContextMenu, SearchInput, Loading, Segmented, Empty, formatSize,
  shortHash, worktreeLabel, worktreeFolder, ...) and `client/src/form.tsx` (Section,
  Field, FieldRow, Checkbox). Settings screens and dialogs are built from them. Don't hand-roll a
  second version.
- **Every visible part is an exported, standalone component** with `theme`, `className` /
  `classNames` and its own option props. It works with a `server` prop or inside a
  `GitnutProvider` (R-SDK-5). Export new components from `client/src/index.ts`.
- **Styling:** plain CSS in `client/src/styles/gitnut.css`, scoped under `.gitnut-root`, driven by
  `--gitnut-*` variables from `client/src/theme.ts`. No Tailwind, no CSS-in-JS. New colours and
  sizes become theme tokens.
- **Graph code** in `commons/src/graph` ports IntelliJ (Apache-2.0). Keep its semantics, naming
  and the attribution in `NOTICE`.
- **Daemon:**
  - It never changes a repository except through an explicit user action (`actions.ts`).
  - Polling uses `GIT_OPTIONAL_LOCKS=0`.
  - Paths from clients are checked so they can't leave the worktree (`files.ts`).
  - A merge, rebase or cherry-pick that conflicts is aborted. Conflict resolution is out of scope.
- **Security:**
  - Default bind is 127.0.0.1 with auth off.
  - Tokens are compared in constant time and never logged or sent to clients.
  - Cookie access checks the Origin.
  - Never weaken any of these without a requirement change.
- **Lint:** Biome (`biome.json`). Fix findings. Use `// biome-ignore <rule>: <reason>` only for
  deliberate exceptions, always with a reason.
- Comments explain why, not what. Match the surrounding style.

## Naming and identity

- **Product names:**
  - "GitNut" in prose, titles and buttons.
  - `gitnut` for the CLI, the binary, the wordmark, package names (`@gitnut/*`), env vars (`GITNUT_*`), CSS (`gitnut-*`).
- **IDs:**
  - Desktop app id: `dev.gitnut`.
  - launchd label: `dev.gitnut.daemon`.
  - Config folder: `~/.gitnut`.
- **Site and repo:** https://gitnut.dev, https://github.com/flyingart/gitnut. The author is Flying Art (https://flyingart.dev).
- **License:** Apache-2.0 with `NOTICE`. Forks must keep the NOTICE credit.

## Releases

- All environment variables are in one table in `docs/BUILD.md`. Don't add new ones when an
  existing one or the manifest can carry the information.
- `GITNUT_SITE_URL` (in `.env`) is required for every shipped build. It bakes in where updates come
  from: `<site>/manifest.json` lists the download URLs. `--dev` builds have updates off.
- Desktop builds sign their updater files with `TAURI_SIGNING_PRIVATE_KEY` (in `.env`). The public
  key in `tauri.conf.json` must never change, or installed apps stop accepting updates.
- Releases: `bun run setup` once per build machine, then `bun run release` (start: version PR +
  draft release; build: on each machine, uploads to the draft; publish: checksums + notes). People
  run it without any AI help, so keep it interactive, with clear errors and hints.
- Nothing in the repo may depend on one person's machine: no absolute paths, host names, IPs or
  user names. Machine settings go to `.env` (see `.env.example`).
- macOS builds sign and notarize with the Developer ID certificate in the Keychain
  (`scripts/mac-signing.ts`). Never put certificates, passwords or tokens into the repo.
- Versions follow semver. The daemon updates itself from the manifest. The web client is served by
  the daemon, so it updates with it.

## Never

- Commit secrets, `.env`, tokens, private hostnames or IPs, or personal paths.
- Push to `main` directly, force-push shared branches, or rewrite published tags.
- Add tracking or telemetry to the app or daemon (the website uses cookieless Rybbit, see /privacy).
