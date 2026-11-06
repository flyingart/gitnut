export type Os = "linux" | "darwin" | "windows";
export type Arch = "x64" | "arm64";
/** Build target name, for example `linux-x64`. Used in update manifests and downloads. */
export type Platform = `${Os}-${Arch}`;

export const PLATFORMS: Platform[] = [
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "darwin-x64",
  "windows-x64",
];

/** Rust target triple of each platform (desktop builds and their sidecar). */
export const RUST_TRIPLES: Record<string, Platform> = {
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-pc-windows-msvc": "windows-x64",
};

export function platformOf(os: string, arch: string): Platform | null {
  const o = os === "win32" ? "windows" : os;
  const a = arch === "x86_64" || arch === "amd64" ? "x64" : arch === "aarch64" ? "arm64" : arch;
  const p = `${o}-${a}` as Platform;
  return PLATFORMS.includes(p) ? p : null;
}

/** Binary file name of the CLI/daemon for a platform. */
export function binaryName(p: Platform): string {
  return p.startsWith("windows") ? `gitnut-${p}.exe` : `gitnut-${p}`;
}

/** Compare dotted versions (`1.2.10` > `1.2.9`). Pre-release suffixes sort before the release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
