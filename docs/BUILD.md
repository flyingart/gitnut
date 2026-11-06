# Build, release and deploy

GitNut ships as one binary per platform (`gitnut`, daemon and CLI in one), desktop installers
(Tauri v2) and a small website that hosts the update manifest and install scripts.

| Piece | Where | Output |
| --- | --- | --- |
| Daemon / CLI | `packages/daemon`, `scripts/build-daemon.ts` | `gitnut-<platform>[.exe]` |
| Web client | `packages/web` (served by the daemon) | baked into the daemon binary |
| Desktop app | `packages/desktop`, `scripts/build-desktop.ts` | `.dmg`, `-setup.exe`, `.AppImage`, `.deb` |
| Website | `packages/site` | Docker image (Coolify) |
| Release | `scripts/release.ts` | `release/<version>/` + `SHA256SUMS`, published as GitHub release `v<version>` |

Asset names, URLs and the manifest format live in `packages/commons/src/assets.ts`:

| Manifest key | File in `release/<version>/` |
| --- | --- |
| `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64` | `gitnut-<key>` |
| `windows-x64` | `gitnut-windows-x64.exe` |
| `desktop-darwin-arm64` / `desktop-darwin-x64` | `GitNut-<version>-darwin-arm64.dmg` / `…-darwin-x64.dmg` |
| `desktop-windows-x64` | `GitNut-<version>-windows-x64-setup.exe` (NSIS) |
| `desktop-linux-x64` / `desktop-linux-x64-deb` | `GitNut-<version>-linux-x64.AppImage` / `…-linux-x64.deb` |
| (desktop updater) | `GitNut-<version>-darwin-{arm64,x64}.app.tar.gz`, plus `<file>.sig` for those, the setup `.exe` and the AppImage |

Every file is served at `<site>/releases/<version>/<file>` (a redirect to the GitHub release).

## Environment variables

Three places, nothing else. Keep build machine values in `.env` at the repo root (gitignored, Bun
loads it for every script).

| Where | Variable | Required | Meaning |
| --- | --- | --- | --- |
| Build machines (`.env`) | `GITNUT_SITE_URL` | yes | The website, e.g. `https://gitnut.dev`. Baked into every binary: updates come from `<site>/manifest.json`, which lists the download URLs. |
| | `TAURI_SIGNING_PRIVATE_KEY` | desktop builds | Path to (or content of) the desktop updater key; `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if it has one. |
| | `APPLE_SIGNING_IDENTITY` | no | macOS certificate; picked from the Keychain when unset. `GITNUT_NOTARY_PROFILE` (default `gitnut-notary`) for notarization. |
| Website (Coolify) | `GITNUT_GITHUB_REPO` | yes | `owner/repo` whose GitHub releases are the source of truth (versions, files, checksums, changelog, desktop updates). |
| | `GITNUT_SITE_URL` | no | Canonical URL (default: from the request / `X-Forwarded-*`). |
| | `GITNUT_GITHUB_TOKEN` | no | Read-only token while the repo is private (files are then streamed through the site). |
| | `GITNUT_GITHUB_REFRESH_MINUTES` | no | How often releases are re-read (default 10). |
| | `GITNUT_SPONSOR_GITHUB` / `_KOFI` / `_PAYPAL` | no | Donation links shown in the Support section. |
| | `PORT` / `HOST` | no | Listen address, default `0.0.0.0:7431`. |
| Daemon at runtime | `GITNUT_HOME` | no | Config folder, default `~/.gitnut`. |

Dev and tests only: `GITNUT_DEV_HOST`, `GITNUT_DEV_DAEMON`, `GITNUT_DEV_HOME`, `GITNUT_WEB_DIR`,
`GITNUT_FIXTURES`, `GITNUT_E2E_*`.

## Install (users)

```sh
curl -fsSL https://<site>/install.sh | sh        # Linux, macOS
irm https://<site>/install.ps1 | iex             # Windows (PowerShell)
```

The scripts detect OS and CPU, download the binary and `SHA256SUMS`, verify the hash
(`sha256sum` / `shasum -a 256` / `Get-FileHash`) and install to `~/.gitnut/bin/gitnut`
(`$GITNUT_HOME/bin` if set; Windows `%USERPROFILE%\.gitnut\bin\gitnut.exe`, the same folder the desktop app uses, added to the
user PATH). On Linux/macOS a `~/.local/bin/gitnut` symlink is created when that folder exists or is
on PATH. `GITNUT_VERSION=x.y.z` installs a specific version. Then:

```sh
gitnut roots add ~/projects
gitnut service install     # Linux / macOS: start at login
gitnut status              # URL to open
gitnut token               # token for other clients
```

## Development

Prereqs: bun 1.4+, git. Desktop work also needs Rust (rustup) and the OS deps below.

```sh
bun install
bun run dev          # daemon (watch, --bind all, GITNUT_HOME=.cache/dev-home), web Vite, site
bun test             # unit + integration tests
bun test packages/site packages/commons/test/assets.test.ts
```

`scripts/dev.ts` prints the URLs (host from `GITNUT_DEV_HOST`, default `localhost`; put it in a
gitignored `.env` when you open the dev servers through a Tailscale name, Vite allows that host too). The site runs on port 7431 (`SITE_PORT`):
`astro dev` with live reload, proxying the dynamic routes (`/manifest.json`, `/changelog.json`, `/screenshots`, ...) to
the Bun server on 127.0.0.1:7432 (`SITE_API_PORT`). `bun run dev` builds the site once first, because the Bun server reads
`install.sh`, `install.ps1` and `robots.txt` from `dist/`.

## Daemon binaries

```sh
bun run scripts/build-daemon.ts --targets host --out dist/bin --version 0.1.0 [--build-web]
bun run scripts/build-daemon.ts --targets all  --out dist/bin --version 0.1.0 --build-web
```

`GITNUT_SITE_URL` (above) is baked in at build time (R-UPD-3) and **required**: without it
`build-daemon.ts`, `build-desktop.ts` and `release.ts` stop with an error, so no shipped binary
lacks updates. `--dev` builds a local binary with updates off. Bun cross-compiles, so all five
binaries build on any OS.

## Release

GitHub releases are the source of truth: the website reads them, nothing else needs updating.
Everything is interactive, no file shuffling between machines:

```sh
bun run setup      # once per build machine: checks tools, gh login, .env, updater key, macOS signing
bun run release    # menu: start / build / publish
```

1. **Start** (any machine, on an up-to-date `main`): asks the version (default: next patch), sets it in
   every `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` and `bun.lock`, opens the
   version PR (it merges itself when CI is green) and creates the draft GitHub release `v<version>`.
2. **Build** (each build machine, after the PR merged): pulls `main` if needed, asks what to build
   here and uploads the files to the draft, with a checksum list.
   - Linux: the 5 CLI binaries (any OS can build them) and the Linux AppImage + `.deb`.
   - macOS: both `.dmg`s (signed and notarized when set up, see below), their updater files and,
     with `cargo-xwin` + `nsis`, the Windows installer. A Mac alone covers everything but Linux.
   - Windows: the Windows installer.
3. **Publish** (any machine): lists missing files, merges the checksum lists into `SHA256SUMS`, opens
   your editor for the notes (`### New` / `### Improved` / `### Fixed` with `- ` bullets: they become
   the changelog page, the daemon update notes and the desktop update dialog), and publishes.

The site picks the release up within `GITNUT_GITHUB_REFRESH_MINUTES` (default 10) or on restart.
Non-interactive: `bun run release start 0.3.0 --yes`, `bun run release build --yes`,
`bun run release publish --yes --notes notes.md`. Files land in `release/<version>/` (gitignored).

## Website (Coolify)

Astro site (static output) plus a small Bun server:

- `src/pages/` holds the pages: `index.astro`, `changelog.astro`, and `privacy.md`, `terms.md` (Markdown with `LegalLayout`).
- `src/layouts/BaseLayout.astro` holds the shared `<head>` (meta, Open Graph, Twitter, Rybbit), the header and the footer.
  `src/components/` holds the repeated parts.
- `public/` holds `style.css`, `app.js`, `fx.js`, `detect.js`, images, `install.sh` and `install.ps1`. They are copied unchanged.
- `bun run --cwd packages/site build` writes `dist/`.
- `server/server.ts` serves `dist/` (clean URLs `/changelog`, `/privacy`, `/terms`) plus the dynamic routes below.
- Page tests build `dist/` first.

Docker image from `packages/site/Dockerfile`, **build context = repository root**. It builds the site, bundles the
server, and the runtime image holds only `server/server.js` and `dist/`:

```sh
docker build -f packages/site/Dockerfile -t gitnut-site .
docker run -p 7431:7431 -e GITNUT_GITHUB_REPO=flyingart/gitnut gitnut-site
```

Coolify: build pack *Dockerfile*, base directory `/`, Dockerfile location
`/packages/site/Dockerfile`, port 7431, health check `/healthz` on host `127.0.0.1` (Alpine
resolves `localhost` to IPv6). Env: see the table above.

Endpoints: `/` landing page (detects OS + CPU, desktop download first), `/changelog`,
`/manifest.json` (daemon updates, `sha256` from the release's `SHA256SUMS`), `/desktop/latest.json`
(Tauri updater feed), `/install.sh`, `/install.ps1`, `/download/<key>` (302 to the file),
`/releases/<version>/<file>`, `/changelog.json`, `/site.json` (`{ sponsors }`), `/screenshots.json`,
`/robots.txt`, `/sitemap.xml`, `/healthz`. Without a published release the release endpoints answer
503 (`/desktop/latest.json`: 204). The gallery shows `docs/screenshots/*.png` (made by
`bun run screenshots`); the Docker image copies them in.

## Desktop app (Tauri v2)

`packages/desktop/src-tauri`. Product "GitNut", identifier `dev.gitnut`, main binary
`gitnut-desktop` (must differ from the `gitnut` sidecar on case-insensitive file systems).

What it does on start (`src/lib.rs`):

1. copies the bundled sidecar to `<GITNUT_HOME or ~/.gitnut>/bin/gitnut[.exe]` when that file is
   missing or older (`gitnut version` compared);
2. `gitnut status --json`; if no daemon runs, starts `gitnut serve` (no console window on
   Windows, output in `~/.gitnut/desktop-daemon.log`) and waits up to 30 s;
3. reads `gitnut token` and opens `<url>/?token=<token>` in the window (sets the cookie);
4. on quit runs `gitnut stop` if the app started the daemon.

The loading/error page is local (`packages/desktop/src`). The daemon's pages are remote
content: the capability file has no `remote` entry, so they get no Tauri IPC. The shell has
no updater: the web client updates the daemon in `~/.gitnut/bin` (see below), and the app
uses that copy on the next start. A new shell version comes from a new installer.

```sh
bun run build:desktop [--version X] [--target <rust triple>] [--sidecar path/to/gitnut]
```

This builds web + the daemon for the target (via `build-daemon.ts`), copies it to
`src-tauri/binaries/gitnut-<rust triple>[.exe]`, runs `bunx tauri build` with the bundles of
that OS and copies the installers to `release/<version>/` with the names above. Raw Tauri
output stays in `packages/desktop/src-tauri/target/<triple?>/release/bundle/`.

### Linux (x64)

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl https://sh.rustup.rs -sSf | sh -s -- -y
bun install && bun run build:desktop
# -> release/<v>/GitNut-<v>-linux-x64.AppImage, GitNut-<v>-linux-x64.deb
```

### macOS (Apple Silicon and Intel)

Prereqs: Xcode command line tools (`xcode-select --install`), rustup, bun.

```sh
curl https://sh.rustup.rs -sSf | sh -s -- -y
rustup target add x86_64-apple-darwin aarch64-apple-darwin
bun install
bun run build:desktop --version 0.2.0                                # host arch
bun run build:desktop --version 0.2.0 --target x86_64-apple-darwin   # Intel build on Apple Silicon
# -> release/0.2.0/GitNut-0.2.0-darwin-arm64.dmg, GitNut-0.2.0-darwin-x64.dmg
```

**Signing and notarization** (`scripts/mac-signing.ts`, interactive like `eas build`):

- The certificate comes from your Keychain: the first "Developer ID Application" one, or a menu when
  there are several. The script offers to remember the choice in `.env` (`APPLE_SIGNING_IDENTITY`).
  Need one? Xcode > Settings > Accounts > your team > Manage Certificates > + > Developer ID Application.
- Notarization uses a notarytool Keychain profile (`GITNUT_NOTARY_PROFILE`, default `gitnut-notary`).
  The first run offers to create it: Apple's own prompt asks for your Apple ID and an app-specific
  password (appleid.apple.com > Sign-In and Security > App-Specific Passwords) and keeps them in the
  Keychain. Later builds notarize and staple each `.dmg` without questions. `--no-notarize` skips it.
- The bundled daemon is signed with the hardened runtime and the JIT entitlements Bun needs
  (`src-tauri/entitlements.plist`).
- No certificate: the build is ad hoc signed as before; after copying the app to `/Applications`,
  run `xattr -rd com.apple.quarantine /Applications/GitNut.app` (or right-click, Open).
- CI / non-interactive: set `APPLE_SIGNING_IDENTITY` and create the profile once with
  `xcrun notarytool store-credentials gitnut-notary --team-id <TEAM>`.

### Windows (x64)

Prereqs: Visual Studio 2022 Build Tools with "Desktop development with C++", WebView2
runtime (preinstalled on Windows 10/11), rustup (MSVC toolchain), bun.

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
winget install Rustlang.Rustup
powershell -c "irm bun.sh/install.ps1 | iex"
bun install
bun run build:desktop --version 0.2.0
# -> release\0.2.0\GitNut-0.2.0-windows-x64-setup.exe
```

The NSIS installer installs per user (no admin). It is unsigned, so SmartScreen warns:
More info → Run anyway.

**From a Mac (no Windows machine needed):** Tauri cross-builds the NSIS installer (experimental):

```sh
brew install nsis llvm
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
bun run build:desktop --version 0.2.0 --target x86_64-pc-windows-msvc
```

## How updates flow

1. `bun run release` publishes the GitHub release; the site's `/manifest.json` and
   `/desktop/latest.json` offer it within 10 minutes.
2. **Daemon** (CLI install or inside the desktop app): checks `<site>/manifest.json`. `gitnut update`
   or the update icon next to the logo downloads `gitnut-<platform>`, verifies it against
   `SHA256SUMS`, replaces its binary and restarts. The web client is served by the daemon, so it
   updates with it.
3. **Desktop app**: checks `<site>/desktop/latest.json` 15 s after start and every 10 minutes. A new
   version asks "Install and restart" (or "Later", not asked again for that version until restart),
   verifies the download against the updater public key in `tauri.conf.json`, stops the daemon it
   started and relaunches; the new app's bundled daemon then replaces the one in `~/.gitnut/bin`.
   The `.deb` does not self-update (reinstall it, or use the AppImage).

**Updater key:** made once with `bunx tauri signer generate -w ~/.tauri/gitnut.key`. The public key
is in `tauri.conf.json` (`plugins.updater.pubkey`); the private key must be on every machine that
builds desktop installers (`TAURI_SIGNING_PRIVATE_KEY` in `.env`). Keep a copy in a password
manager: without it, installed apps can't receive desktop updates any more.

## Logo

`docs/logo.svg` (app icon, on dark), `docs/logo-wordmark.svg`, `docs/logo.png` (1024 px).
Copies: `packages/web/public/{favicon,logo}.svg`, `packages/site/public/`, `packages/desktop/src/`.
Regenerate the Tauri icons after a change:

```sh
rsvg-convert -w 1024 -h 1024 docs/logo.svg -o docs/logo.png
cd packages/desktop && bunx tauri icon ../../docs/logo.png -o src-tauri/icons && rm -rf src-tauri/icons/{android,ios}
```
