# GitNut requirements

Source of truth for scope. Every requirement has an id (`R-…`). Tests reference these ids
in their names (for example `test("R-GRAPH-3: long edges are cut into arrows", …)`) so
`bun test -t R-GRAPH` shows the coverage of one area.

GitNut is a git client for watching what AI agents do in many repositories on many machines.
One daemon runs on each machine. One client (web panel, desktop app or embedded React
component) connects to many daemons and shows all their projects.

## Product

- **R-PROD-1** One client shows several servers, each with several repositories.
- **R-PROD-2** The commit log graph and the diff viewer copy IntelliJ IDEA's git client as
  closely as possible (behaviour, information density, keyboard use). Port IntelliJ code
  where possible (Apache-2.0, see NOTICE). The look follows T3 Code: dark, glass panels,
  blur, modern.
- **R-PROD-3** Conflict resolution, interactive rebase and line-level staging are out of scope.
- **R-PROD-4** License Apache-2.0 with a NOTICE file that forks must keep (credit Flying Art).

## Graph (packages/commons/src/graph, ported from IntelliJ vcs-log graph)

- **R-GRAPH-1** One graph shows all refs: local branches, remote branches, tags, HEAD, with
  ref labels on their commits. Branch origins (fork points and merges) are visible. Private
  refs of agent tools (Jean `refs/jean/checkpoints/*`, T3 Code `refs/t3/*`, anything outside
  heads / remotes / tags) are hidden by default (`hideInternalRefs`, on by default).
- **R-GRAPH-2** Lane layout ports IntelliJ `GraphLayoutBuilder` (DFS from heads sorted by
  IntelliJ's git layout comparator: origin/master|main, other remotes, master|main, other
  local branches, tags, HEAD, natural name order), colours per head (`GraphColorGetterByHead`), and the
  IntelliJ sort ("Bek"/IntelliJ style, topological, by date).
- **R-GRAPH-3** Long edges are cut into arrow stubs like `PrintElementGeneratorImpl`
  (LONG_EDGE_SIZE 30, part 1; with "show long edges": 1000 / 250).
- **R-GRAPH-4** 50 000 commits: building the layout takes < 1.5 s in Bun, and rows render
  lazily (only visible rows produce print elements). The client stays smooth while scrolling.
- **R-GRAPH-5** Filters: text, author, path, branch, date. Filtered graph keeps visible
  commits connected (hidden commits skipped, dashed edges where IntelliJ draws them).
- **R-GRAPH-6** Commit details (subject, author, date, hash) load lazily for visible rows.
- **R-GRAPH-7** Graph refreshes live when refs change (new commit by an agent, fetch, push).

## Changes and diff

- **R-DIFF-1** Selecting one commit shows its changed files. Selecting several commits
  (Ctrl/Cmd+click, Shift+click) shows their combined changes with IntelliJ `zipChanges`
  semantics: per file, before = state before the first selected commit that touched it,
  after = state after the last one. Non-adjacent selections work. Renames chain (a→b, b→c = a→c).
- **R-DIFF-2** Changed files show as a tree nested by folder (default), with single-child
  folders compacted (`src/main/kotlin`) and file counts per folder. Option: flat list.
- **R-DIFF-3** Status colours like IntelliJ: added green, modified blue, deleted grey,
  renamed, untracked red/brown, conflicted red.
- **R-DIFF-4** Diff viewer like IntelliJ: side-by-side (default) and unified, syntax
  highlighting, word-level highlights inside changed lines, curved connector bands between
  the panes, collapsed unchanged regions, ignore-whitespace toggle.
- **R-DIFF-5** Keyboard: arrows move through the file tree and the diff follows; F7 / Shift+F7
  go to next / previous change and continue into the next / previous file.
- **R-DIFF-6** Raster images (png, jpg, gif, webp, bmp, ico, avif, up to 5 MB) show before / after side by side
  with pixel and file size. Other binary and very large files show a placeholder instead of text.

## Local changes (agents at work)

- **R-LOCAL-1** "Uncommitted changes" view per worktree (all worktrees of a repo, including
  T3 / Jean worktrees), updated live while files change.
- **R-LOCAL-2** A combined view merges uncommitted changes of several repos / worktrees
  (configurable which) so work on 3 projects at once is visible in one place.
- **R-LOCAL-3** Simple controls: commit (selected files, message, amend), pull, push, fetch.

## Projects list

- **R-LIST-1** Projects grouped by server (default) with an option for a flat list
  (T3 Code style). Worktrees shown under their repo with branch, ahead/behind, dirty count.
- **R-LIST-3** Settings → Appearance: dark / light and an accent (presets, default "coconut"
  pink → violet → blue gradient, or a custom colour), applied to buttons, selection, focus and
  the background glow. All scroll areas share one styled scrollbar.
- **R-LIST-4** Tabs are optional (off by default: the sidebar switches the one open view). With
  tabs on, right-click a tab: close, close others, close to the left / right, close all.
- **R-PROD-5** Settings → Servers lists the client's servers: rename, change address or token,
  remove, add.
- **R-LIST-2** Every view option that is a matter of taste is configurable and remembered
  (tree/flat, grouping, sort, diff mode, whitespace, long edges, theme).

## Daemon (packages/daemon)

- **R-DAEMON-1** One binary is both daemon and CLI (`gitnut`). Built with `bun build --compile`
  for linux-x64, linux-arm64, darwin-arm64, darwin-x64, windows-x64.
- **R-DAEMON-2** Pushes its state to clients over WebSocket (`/ws`, protocol in
  `packages/commons/src/protocol.ts`).
- **R-DAEMON-3** Serves the bundled web client at `/` by default. `--no-web` / setting
  `serveWeb: false` turns it off.
- **R-DAEMON-4** Bind modes: `localhost`, `tailscale` (the machine's Tailscale IP), `all`,
  or an explicit IP.
- **R-DAEMON-5** Auth: token only. Turn on/off; off by default (default bind is
  127.0.0.1), the CLI warns when auth is off on a non-localhost bind. Token via cookie (web login with
  `?token=` link or token form), WebSocket subprotocol `gitnut.bearer.<token>` (SDK), or
  `Authorization: Bearer`. Constant-time compare. Rotating the token disconnects old sessions.
  Turning auth off on a public bind (`all` / non-loopback, non-Tailscale IP) needs `--force`.
  Cookie / no-auth access checks the Origin header (same origin + `allowedOrigins`) so other
  websites can't drive a local daemon.
- **R-DAEMON-6** All settings are editable from the CLI (`gitnut config get|set`, `gitnut token`,
  `gitnut repos add|remove|list`, `gitnut roots add|remove`) and from clients (settings screen).
- **R-DAEMON-7** Repos come from `roots` (watched folders, scanned to `scanDepth`) and explicit
  `repos` (single projects). Both can be added from the CLI and from the client's "Add projects"
  dialog (browse the daemon's folders, tick single repos or watch the whole folder). A repo from a
  watched folder can be hidden (lands in `exclude`) and added back. Bare repos are found too.
  Worktrees are grouped under their main repo (same git common dir).
- **R-DAEMON-8** Live updates: polls refs and status of subscribed repos / worktrees every
  `pollIntervalMs` and pushes events only on change.
- **R-DAEMON-9** `gitnut service install|uninstall` sets it up as a user service
  (systemd user unit on Linux, launchd agent on macOS).

## Updates and distribution

- **R-UPD-1** The website exposes `/manifest.json` (`UpdateManifest`). The latest version, its
  files and checksums come from the GitHub releases of `GITNUT_GITHUB_REPO`; files are served at
  `<site>/releases/<version>/<file>`.
- **R-UPD-2** `gitnut update` (CLI) and the web client's update button download the binary for
  the platform, verify its SHA-256 (from `SHA256SUMS` next to the assets), replace the binary
  and restart the daemon. Because the daemon serves the web client, this updates both.
- **R-UPD-3** `GITNUT_SITE_URL` is baked in at build time (manifest = `<site>/manifest.json`, which
  lists the download URLs). Builds fail without it (`--dev` for local builds); the client has no
  field or setting for it (`GITNUT_MANIFEST_URL` in the daemon's environment overrides it). The client shows an update icon next to the logo when a
  server has an update, and Settings show the client and desktop app versions.
- **R-UPD-4** Install with one command: `curl -fsSL <site>/install.sh | sh` (Linux/macOS) and
  `irm <site>/install.ps1 | iex` (Windows).
- **R-UPD-5** Desktop apps (macOS, Windows, Linux) built with Tauri v2. Starting the app starts
  the daemon; the app shows the web client served by that daemon. The app updates
  itself with the Tauri updater: `<site>/desktop/latest.json` (from the GitHub release), checked
  every 10 minutes, signed with our updater key. One update path: the client's update icon and
  Settings button drive it for the app's own daemon; that daemon never updates by itself.
- **R-UPD-6** Scripts build web + daemon binaries for all platforms, a release folder with
  `SHA256SUMS` (published as a GitHub release), and the desktop app on its host OS. Builds of macOS / Windows
  desktop apps happen manually on those machines (instructions in README).

## Website (packages/site)

- **R-SITE-1** Landing page detects OS and CPU architecture and shows the matching download
  button first (like t3.codes/download), with all other downloads listed.
- **R-SITE-2** Serves `/manifest.json`, `/install.sh`, `/install.ps1`, and `/download/<platform>`
  redirects. Configured by env vars (only `GITNUT_GITHUB_REPO` required). Has a Dockerfile for Coolify.
- **R-SITE-3** Pages carry canonical, Open Graph (og:image), Twitter and JSON-LD tags; the site
  serves `/robots.txt` and `/sitemap.xml` on `GITNUT_SITE_URL`, and explains how to open the
  unsigned builds on macOS, Windows and Linux.
- **R-SITE-4** Cookieless self-hosted analytics (Rybbit) on every page, with download and
  copy-command events; `/privacy` and `/terms` pages linked from the footer. The app and daemon
  send no telemetry.
- **R-SITE-5** A Pricing section on the landing page says GitNut is free and open source. It shows a
  Ko-fi donate button only when the build has an https `GITNUT_KOFI_URL`.

## SDK / embedding (packages/client)

- **R-SDK-1** `import { GitnutApp } from "@gitnut/client"` renders the full client as a React
  component (no iframe). Smaller parts are exported too (`CommitGraph`, `ChangesTree`,
  `DiffViewer`, `LocalChanges`).
- **R-SDK-2** Everything visual is customisable: colours, radius, button / control sizes,
  paddings, fonts, glass blur / opacity, density. Via a `theme` prop (typed tokens mapped to
  `--gitnut-*` CSS variables) and a `classNames` prop for main parts. Styles are plain CSS
  scoped under `.gitnut-root` (no Tailwind needed by the host app).
- **R-SDK-3** iframe embedding works too: the web client accepts `?embed=1`, `?theme=<json>`,
  `?server=<url>` and `?view=` URL params, and a `postMessage` API to change the theme.
- **R-SDK-4** Behaviour options (tree/flat, grouping, …) can be fixed by the host app via props
  or left to the user.
- **R-SDK-5** Every piece of the UI is its own exported component that works standalone, with
  props for its data source and options. `GitnutApp` is only a composition of them. At least:
  `ServerProvider` / `GitnutProvider` (connections), `ProjectsList`, `WorktreeList`,
  `CommitGraph` (graph + commit table), `RefsList` (branches), `CommitDetails`,
  `ChangesTree`, `DiffViewer`, `ChangesBrowser` (tree + diff), `LocalChanges` (live uncommitted
  changes of one worktree), `CombinedLocalChanges` (several worktrees / repos), `CommitPanel`,
  `GitActions` (pull / push / fetch buttons), `SettingsPanel`, `UpdateButton`, `LoginForm`.
  Example: a host app shows only live changes next to its own worktree:
  `<LocalChanges server={{ url, token }} worktreePath="/home/me/repo-wt" />` — no other
  gitnut UI, no shared state needed. Each component accepts `theme`, `className` /
  `classNames` and its own option props, and works with either a direct `server` prop or a
  surrounding `GitnutProvider`.

## Docs and quality

- **R-DOC-1** README with architecture, usage, CLI, SDK, build and release steps (including
  macOS / Windows desktop builds), with screenshots. A mock logo.
- **R-TEST-1** Tests cover these requirements: `bun test` (unit + daemon integration on temp
  git repos) and Playwright e2e (`bunx playwright test`) against a real daemon.

## Git actions (IntelliJ-style, R-ACT)

- **R-ACT-1** Fetch everywhere: log toolbar, repo rows in the projects list, "Fetch all" per
  server, worktree headers. Optional periodic auto-fetch setting (`autoFetchMinutes`, 0 = off).
- **R-ACT-2** Commit context menu (right-click one or more rows): copy hash / subject, checkout
  revision (detached), new branch here, new tag here, cherry-pick (oldest first), revert, reset
  current branch to here (soft / mixed / hard).
- **R-ACT-3** Ref context menu (branches panel and ref labels in the graph): checkout (a remote
  branch creates a tracking local branch), new branch from, merge into current, rebase current
  onto, push (local branch), delete (local, remote, tag).
- **R-ACT-4** Local changes: discard (rollback) selected files, stash / unstash, plus the
  existing commit / pull / push.
- **R-ACT-5** Actions that change a worktree run in a chosen worktree (default: the main one; a
  picker when the repo has several). Destructive actions (reset --hard, delete branch,
  discard, force) ask for confirmation. Merge / rebase / cherry-pick / revert that hit conflicts
  are aborted and report the conflict (conflict resolution stays out of scope, R-PROD-3).
  Results and errors show as toasts with the git output.
