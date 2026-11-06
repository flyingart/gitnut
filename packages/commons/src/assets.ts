import { PLATFORMS, binaryName, type Platform } from "./platform";
import type { UpdateManifest } from "./protocol";

/** Release folder layout: `${base}/${version}/${file}`. Shared by site, release script and installers. */

export const SHA256SUMS = "SHA256SUMS";

export interface DesktopAsset {
  /** Manifest / `/download/<key>` key. */
  key: string;
  platform: Platform;
  /** Tauri bundle folder the installer comes from (`target/release/bundle/<bundle>`). */
  bundle: "dmg" | "nsis" | "appimage" | "deb";
  label: string;
  file: (version: string) => string;
  /**
   * Tauri updater: its platform key in latest.json and the update file (signature: file + ".sig").
   * macOS updates a .app.tar.gz; Windows and the AppImage update from the installer itself.
   */
  updater?: { target: string; file: (version: string) => string };
}

export const DESKTOP_ASSETS: DesktopAsset[] = [
  {
    key: "desktop-darwin-arm64",
    platform: "darwin-arm64",
    bundle: "dmg",
    label: "macOS (Apple Silicon)",
    file: (v) => `GitNut-${v}-darwin-arm64.dmg`,
    updater: { target: "darwin-aarch64", file: (v) => `GitNut-${v}-darwin-arm64.app.tar.gz` },
  },
  {
    key: "desktop-darwin-x64",
    platform: "darwin-x64",
    bundle: "dmg",
    label: "macOS (Intel)",
    file: (v) => `GitNut-${v}-darwin-x64.dmg`,
    updater: { target: "darwin-x86_64", file: (v) => `GitNut-${v}-darwin-x64.app.tar.gz` },
  },
  {
    key: "desktop-windows-x64",
    platform: "windows-x64",
    bundle: "nsis",
    label: "Windows (x64)",
    file: (v) => `GitNut-${v}-windows-x64-setup.exe`,
    updater: { target: "windows-x86_64", file: (v) => `GitNut-${v}-windows-x64-setup.exe` },
  },
  {
    key: "desktop-linux-x64",
    platform: "linux-x64",
    bundle: "appimage",
    label: "Linux AppImage (x64)",
    file: (v) => `GitNut-${v}-linux-x64.AppImage`,
    updater: { target: "linux-x86_64", file: (v) => `GitNut-${v}-linux-x64.AppImage` },
  },
  {
    key: "desktop-linux-x64-deb",
    platform: "linux-x64",
    bundle: "deb",
    label: "Linux .deb (x64)",
    file: (v) => `GitNut-${v}-linux-x64.deb`,
  },
];

export function assetUrl(base: string, version: string, file: string): string {
  return `${base.replace(/\/+$/, "")}/${version}/${file}`;
}

/** File name for any manifest key (`linux-x64`, `desktop-darwin-arm64`, …), or null when unknown. */
export function assetFile(key: string, version: string): string | null {
  if ((PLATFORMS as string[]).includes(key)) return binaryName(key as Platform);
  return DESKTOP_ASSETS.find((a) => a.key === key)?.file(version) ?? null;
}

/** All release files of a version, keyed like the manifest. */
export function releaseFiles(version: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PLATFORMS) out[p] = binaryName(p);
  for (const a of DESKTOP_ASSETS) out[a.key] = a.file(version);
  return out;
}

/** Parse `sha256sum` output (`<hash>  <file>` or `<hash> *<file>`) into file → hash. */
export function parseSha256Sums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

export function formatSha256Sums(sums: Record<string, string>): string {
  return Object.keys(sums)
    .sort()
    .map((f) => `${sums[f]}  ${f}\n`)
    .join("");
}

export interface BuildManifestOptions {
  version: string;
  base: string;
  notes?: string;
  publishedAt?: string;
  downloadPage?: string;
  /** File name → sha256 (as parsed from `SHA256SUMS`). */
  sha256s?: Record<string, string>;
}

export function buildManifest(o: BuildManifestOptions): UpdateManifest {
  const assets: UpdateManifest["assets"] = {};
  for (const [key, file] of Object.entries(releaseFiles(o.version))) {
    const sha256 = o.sha256s?.[file];
    assets[key] = sha256 ? { url: assetUrl(o.base, o.version, file), sha256 } : { url: assetUrl(o.base, o.version, file) };
  }
  const m: UpdateManifest = { version: o.version, assets };
  if (o.notes) m.notes = o.notes;
  if (o.publishedAt) m.publishedAt = o.publishedAt;
  if (o.downloadPage) m.downloadPage = o.downloadPage;
  return m;
}
