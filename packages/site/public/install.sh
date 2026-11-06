#!/bin/sh
# gitnut installer for Linux and macOS.
#   curl -fsSL __GITNUT_SITE_URL__/install.sh | sh
# Env: GITNUT_HOME (default ~/.gitnut), GITNUT_VERSION (default __GITNUT_VERSION__).
set -eu

VERSION="${GITNUT_VERSION:-__GITNUT_VERSION__}"
BASE="__GITNUT_DOWNLOAD_BASE__"
GITNUT_HOME="${GITNUT_HOME:-$HOME/.gitnut}"
BIN_DIR="$GITNUT_HOME/bin"

say() { printf '%s\n' "$*"; }
fail() { printf 'gitnut install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported OS $(uname -s). On Windows run: irm __GITNUT_SITE_URL__/install.ps1 | iex" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac
# A shell under Rosetta reports x86_64 on Apple Silicon; prefer the native build.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi
file="gitnut-$os-$arch"
url="$BASE/$VERSION/$file"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  fail "curl or wget is required"
fi
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum or shasum is required"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading gitnut $VERSION ($os-$arch)..."
fetch "$url" "$tmp/$file" || fail "download failed: $url"
fetch "$BASE/$VERSION/SHA256SUMS" "$tmp/SHA256SUMS" || fail "download failed: $BASE/$VERSION/SHA256SUMS"

expected="$(awk -v f="$file" '{ n = $2; sub(/^\*/, "", n); if (n == f) print tolower($1) }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "$file is not listed in SHA256SUMS"
actual="$(sha256 "$tmp/$file")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $file (expected $expected, got $actual)"

mkdir -p "$BIN_DIR"
chmod 755 "$tmp/$file"
mv -f "$tmp/$file" "$BIN_DIR/gitnut"
if [ "$os" = darwin ]; then
  xattr -d com.apple.quarantine "$BIN_DIR/gitnut" 2>/dev/null || true
fi
say "Installed $BIN_DIR/gitnut"

on_path=0
case ":$PATH:" in *":$HOME/.local/bin:"*) on_path=1 ;; esac
if [ -d "$HOME/.local/bin" ] || [ "$on_path" = 1 ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$BIN_DIR/gitnut" "$HOME/.local/bin/gitnut"
  say "Linked $HOME/.local/bin/gitnut"
fi
if [ "$on_path" = 1 ]; then
  cmd=gitnut
else
  cmd="$BIN_DIR/gitnut"
  say ""
  say "Add gitnut to your PATH, for example:"
  say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile"
fi

say ""
say "Next steps:"
say "  $cmd service install         # run the daemon in the background at login"
say "  $cmd status                  # shows the URL to open (127.0.0.1, no login needed)"
say "  Add projects in the client, or: $cmd repos add <repo> / $cmd roots add <folder>"
say "  Other machines: $cmd config set auth.enabled true; $cmd config set bind tailscale; $cmd token"
