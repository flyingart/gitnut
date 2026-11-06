# Build, release and deploy

GitNut ships as one binary per platform (`gitnut`, daemon and CLI in one), desktop installers
(Tauri v2) and a small website that hosts the update manifest and install scripts.

| Piece | Where | Output |
| --- | --- | --- |
| Daemon / CLI | `packages/daemon`, `scripts/build-daemon.ts` | `gitnut-<platform>[.exe]` |
| Web client | `packages/web` (served by the daemon) | baked into the daemon binary |
| Desktop app | `packages/desktop`, `scripts/build-desktop.ts` | `.dmg`, `-setup.exe`, `.AppImage`, `.deb` |
| Website | `packages/site` | Docker image (Coolify) |
| Release | `scripts/release.ts` | `release/<version>/` + `SHA256SUMS` + `manifest.json` |

Asset names, URLs and the manifest format live in `packages/commons/src/assets.ts`:

| Manifest key | File in `release/<version>/` |
| --- | --- |
| `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64` | `gitnut-<key>` |
| `windows-x64` | `gitnut-windows-x64.exe` |
| `desktop-darwin-arm64` / `desktop-darwin-x64` | `GitNut-<version>-darwin-arm64.dmg` / `…-darwin-x64.dmg` |
| `desktop-windows-x64` | `GitNut-<version>-windows-x64-setup.exe` (NSIS) |
| `desktop-linux-x64` / `desktop-linux-x64-deb` | `GitNut-<version>-linux-x64.AppImage` / `…-linux-x64.deb` |

Every asset URL is `${GITNUT_DOWNLOAD_BASE_URL}/${version}/${file}`.

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
gitignored `.env` when you open the dev servers through a Tailscale name, Vite allows that host too). The site runs on port 7431 (`SITE_PORT`).

## Daemon binaries

```sh
bun run scripts/build-daemon.ts --targets host --out dist/bin --version 0.1.0 [--build-web]
bun run scripts/build-daemon.ts --targets all  --out dist/bin --version 0.1.0 --build-web
```

The update source is baked in at build time (R-UPD-3) and is **required**: set `GITNUT_SITE_URL`
(gives `<site>/manifest.json` and `<site>/releases`) or `GITNUT_MANIFEST_URL` /
`GITNUT_DOWNLOAD_BASE_URL`. Put it in `.env` at the repo root on every build machine (Bun loads it
for every script), so macOS / Windows builds can't ship without updates:

```sh
echo "GITNUT_SITE_URL=https://gitnut.example.com" >> .env
```

Without it `build-daemon.ts`, `build-desktop.ts` and `release.ts` stop with an error; `--dev`
builds a local binary with updates off.
Bun cross-compiles, so all five binaries build on any OS.

## Release

```sh
export GITNUT_DOWNLOAD_BASE_URL=https://dl.example.com/gitnut   # required
export GITNUT_SITE_URL=https://gitnut.example.com                 # manifest URL = $GITNUT_SITE_URL/manifest.json
export GITNUT_RELEASE_NOTES="Short notes"                        # optional
bun run release 0.2.0 [--targets all] [--skip-desktop] [--upload]
```

`release.ts`:

1. sets `0.2.0` in every `package.json`, `tauri.conf.json` and `Cargo.toml`;
2. builds the web client and all daemon binaries into `release/0.2.0/`;
3. builds the desktop app for the host OS (skipped with `--skip-desktop`) and picks up any
   installers already copied into `release/0.2.0/` (macOS / Windows builds made on those machines);
4. writes `SHA256SUMS` and `manifest.json` (both over every file in the folder);
5. `--upload` runs `GITNUT_UPLOAD_CMD` with `{dir}` and `{version}` replaced, for example
   `GITNUT_UPLOAD_CMD='rsync -av {dir}/ host:/srv/gitnut/{version}/'`;
6. prints the env vars to set on the website.

Typical flow with three machines: run `bun run release X` on Linux (binaries + Linux desktop),
build the macOS and Windows installers there (below), copy them into `release/X/`, then run
`bun run release X --skip-desktop --upload` again to refresh `SHA256SUMS` / `manifest.json`
and upload. `release/` is gitignored.

### GitHub releases as the source of truth (recommended)

The website can read everything from GitHub instead of env vars: set `GITNUT_GITHUB_REPO=flyingart/gitnut`
on the site (plus `GITNUT_GITHUB_TOKEN`, a read-only token, while the repo is private). Then a release is:

```sh
cat > notes.md <<'MD'
### New
- Image diffs
### Improved
- Faster graph
### Fixed
- Footer cropped at the bottom
MD
bun run release 0.3.0 --publish --notes notes.md [--title "See your images change"]
```

`--publish` creates the GitHub release `v0.3.0` with every file of `release/0.3.0/` (gh CLI). The site
picks it up within `GITNUT_GITHUB_REFRESH_MINUTES` (default 10) or on restart: latest version, manifest,
SHA256SUMS, downloads (`<site>/releases/<version>/<file>`, redirected to GitHub, or streamed through the
site with the token while private) and the changelog page (one entry per release, from the notes'
New / Improved / Fixed sections). Installers built elsewhere: `gh release upload v0.3.0 <file>`, then
`gh release upload v0.3.0 release/0.3.0/SHA256SUMS --clobber` after re-running the release with
`--skip-desktop` to refresh the checksums.

## Website (Coolify)

Docker image from `packages/site/Dockerfile`, **build context = repository root**:

```sh
docker build -f packages/site/Dockerfile -t gitnut-site .
docker run -p 7431:7431 -e GITNUT_LATEST_VERSION=0.1.0 -e GITNUT_DOWNLOAD_BASE_URL=https://dl.example.com/gitnut gitnut-site
```

Coolify: build pack *Dockerfile*, base directory `/`, Dockerfile location
`/packages/site/Dockerfile`, port 7431, health check `/healthz`.

| Env var | Required | Meaning |
| --- | --- | --- |
| `GITNUT_GITHUB_REPO` | no | `owner/repo`: read version, files, checksums and changelog from its GitHub releases (replaces the two vars below) |
| `GITNUT_GITHUB_TOKEN` | no | Read-only token for a private repo; files are then streamed through the site |
| `GITNUT_GITHUB_REFRESH_MINUTES` | no | How often releases are re-read (default 10) |
| `GITNUT_LATEST_VERSION` | yes* | Current version, e.g. `0.2.0` (*unless `GITNUT_GITHUB_REPO`) |
| `GITNUT_DOWNLOAD_BASE_URL` | yes* | Release host; assets at `<base>/<version>/<file>` (*GitHub mode: `<site>/releases`) |
| `GITNUT_SITE_URL` | no | Public site URL for install scripts / `downloadPage` (default: from request / `X-Forwarded-*`) |
| `GITNUT_RELEASE_NOTES` | no | `notes` in the manifest |
| `GITNUT_PUBLISHED_AT` | no | ISO date, `publishedAt` in the manifest |
| `GITNUT_RELEASE_DIR` | no | Local folder with `<version>/<files>`: the site then serves them at `/releases/<version>/<file>` (set `GITNUT_DOWNLOAD_BASE_URL` to `<site>/releases`), so one box hosts site + downloads |
| `GITNUT_SPONSOR_GITHUB` | no | GitHub Sponsors URL, e.g. `https://github.com/sponsors/<user>`: shown as a donation button in the Support section |
| `GITNUT_SPONSOR_KOFI` | no | Ko-fi URL, e.g. `https://ko-fi.com/<user>` |
| `GITNUT_SPONSOR_PAYPAL` | no | PayPal URL, e.g. `https://paypal.me/<user>` |
| `PORT` / `HOST` | no | Listen address, default `0.0.0.0:7431` |

Endpoints: `/` landing page (detects OS + CPU, desktop download first), `/manifest.json`
(adds `sha256` per asset when `<base>/<version>/SHA256SUMS` is reachable, cached 5 min),
`/install.sh`, `/install.ps1`, `/download/<key>` (302 to the asset), `/healthz`, `/changelog`
(rendered from `public/changelog.json`, newest first), `/site.json` (`{ sponsors }` from the env above),
`/screenshots.json`. Without `GITNUT_LATEST_VERSION` / `GITNUT_DOWNLOAD_BASE_URL` the release
endpoints answer 503. Screenshots: the gallery shows `docs/screenshots/*.png` (the README ones, made by
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

## How updates flow

1. `bun run release X` + upload puts the files at `<base>/X/`; set `GITNUT_LATEST_VERSION=X`
   on the site. `/manifest.json` now lists X with SHA-256 values.
2. A daemon (CLI install or desktop) checks its manifest URL (baked in, overridable in
   settings). `gitnut update` or the web client's update button (`update.apply`) downloads
   `gitnut-<platform>`, verifies it against `SHA256SUMS`, replaces its own binary and restarts.
3. The daemon serves the web client, so the web client is updated with it.
4. The desktop app runs the daemon from `~/.gitnut/bin`, so the same update applies there. On
   start the app only replaces that copy when its bundled sidecar is newer.

## Logo

`docs/logo.svg` (app icon, on dark), `docs/logo-wordmark.svg`, `docs/logo.png` (1024 px).
Copies: `packages/web/public/{favicon,logo}.svg`, `packages/site/public/`, `packages/desktop/src/`.
Regenerate the Tauri icons after a change:

```sh
rsvg-convert -w 1024 -h 1024 docs/logo.svg -o docs/logo.png
cd packages/desktop && bunx tauri icon ../../docs/logo.png -o src-tauri/icons && rm -rf src-tauri/icons/{android,ios}
```
