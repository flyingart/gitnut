#!/usr/bin/env bun
// Build the Tauri desktop app for the host OS (R-UPD-5, R-UPD-6).
//   bun run build:desktop [--version X] [--target <rust triple>] [--sidecar <gitnut binary>] [--no-notarize]
// macOS: signs with your "Developer ID Application" certificate and notarizes the .dmg (scripts/mac-signing.ts).
// Builds web + daemon for the target, bundles it as the sidecar, runs `tauri build` and copies
// the installers to release/<version>/ with the names from packages/commons/src/assets.ts.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP_ASSETS, binaryName, type Platform } from "@gitnut/commons";
import { notarize, notaryProfile, pickIdentity, signBinary } from "./mac-signing";

const ROOT = resolve(import.meta.dir, "..");
const DESKTOP = join(ROOT, "packages", "desktop");
const TAURI = join(DESKTOP, "src-tauri");

const TRIPLES: Record<string, Platform> = {
  "x86_64-unknown-linux-gnu": "linux-x64",
  "aarch64-unknown-linux-gnu": "linux-arm64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-pc-windows-msvc": "windows-x64",
};
const EXT: Record<string, string> = { dmg: ".dmg", nsis: "-setup.exe", appimage: ".AppImage", deb: ".deb" };

// rustup installs to ~/.cargo/bin, which a fresh shell may not have on PATH yet.
const cargoBin = join(homedir(), ".cargo", "bin");
const env = { ...process.env, PATH: `${cargoBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` };

function run(cmd: string[], cwd = ROOT, extraEnv: Record<string, string | undefined> = {}): string {
  console.log(`$ ${cmd.join(" ")}`);
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, ...extraEnv }, stdout: "pipe", stderr: "inherit" });
  const out = p.stdout.toString();
  if (p.exitCode !== 0) {
    process.stdout.write(out);
    throw new Error(`${cmd[0]} exited with ${p.exitCode}`);
  }
  return out;
}

function runLive(cmd: string[], cwd = ROOT, extraEnv: Record<string, string | undefined> = {}) {
  console.log(`$ ${cmd.join(" ")}`);
  const p = Bun.spawnSync(cmd, { cwd, env: { ...env, ...extraEnv }, stdio: ["inherit", "inherit", "inherit"] });
  if (p.exitCode !== 0) throw new Error(`${cmd[0]} exited with ${p.exitCode}`);
}

async function main() {
  const { values } = parseArgs({
    options: { version: { type: "string" }, target: { type: "string" }, sidecar: { type: "string" }, "no-notarize": { type: "boolean", default: false } },
  });
  const version: string = values.version ?? (await Bun.file(join(TAURI, "tauri.conf.json")).json()).version;
  const host = /^host: (.+)$/m.exec(run(["rustc", "-vV"]))?.[1]?.trim();
  const triple = values.target ?? host!;
  const platform = TRIPLES[triple];
  if (!platform) throw new Error(`unsupported target ${triple}`);
  const assets = DESKTOP_ASSETS.filter((a) => a.platform === platform);
  if (!assets.length) throw new Error(`no desktop installers are defined for ${platform}`);

  // 0. macOS: certificate and notary profile first, so the questions come before the long build
  // signing applies to macOS targets (built on a Mac); a Windows target on a Mac is not codesigned
  const mac = platform.startsWith("darwin") && process.platform === "darwin";
  const signing = mac ? pickIdentity(ROOT) : null;
  const notary = signing && !values["no-notarize"] ? notaryProfile(signing.team) : null;

  // 1. daemon (with the web client baked in) for this target
  let sidecar = values.sidecar;
  if (!sidecar) {
    const args = ["bun", "run", "scripts/build-daemon.ts", "--targets", platform, "--out", "dist/bin", "--version", version];
    if (existsSync(join(ROOT, "packages", "web", "index.html"))) args.push("--build-web");
    runLive(args);
    sidecar = join(ROOT, "dist", "bin", binaryName(platform));
  }
  const dest = join(TAURI, "binaries", `gitnut-${triple}${platform.startsWith("windows") ? ".exe" : ""}`);
  mkdirSync(join(TAURI, "binaries"), { recursive: true });
  copyFileSync(sidecar, dest);
  chmodSync(dest, 0o755);
  // macOS refuses unsigned arm64 binaries: sign the sidecar with the certificate (hardened runtime, for
  // notarization), or ad hoc when there is none.
  if (signing) signBinary(dest, signing.identity, join(TAURI, "entitlements.plist"));
  else if (mac) run(["codesign", "--force", "--sign", "-", dest]);

  // 2. Tauri bundles
  const bundles = [...new Set(assets.map((a) => a.bundle))].join(",");
  const tauri = ["bunx", "tauri", "build", "--bundles", bundles, "--config", JSON.stringify({ version })];
  if (values.target) tauri.push("--target", triple);
  // Windows installer from macOS / Linux: Tauri's NSIS cross-build (cargo install cargo-xwin; brew install nsis llvm).
  if (platform.startsWith("windows") && process.platform !== "win32") tauri.push("--runner", "cargo-xwin");
  // No certificate: "-" makes Tauri ad hoc sign the whole .app (otherwise x64 bundles end up unsigned).
  runLive(tauri, DESKTOP, mac ? { APPLE_SIGNING_IDENTITY: signing?.identity ?? "-" } : {});

  // 3. copy installers to release/<version>/
  const bundleRoot = join(TAURI, "target", ...(values.target ? [triple] : []), "release", "bundle");
  const out = join(ROOT, "release", version);
  mkdirSync(out, { recursive: true });
  for (const a of assets) {
    const dir = join(bundleRoot, a.bundle);
    const found = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(EXT[a.bundle]) && f.includes(version))
          .map((f) => join(dir, f))
          .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0]
      : undefined;
    if (!found) throw new Error(`no ${a.bundle} installer for ${version} in ${dir}`);
    const target = join(out, a.file(version));
    copyFileSync(found, target);
    if (notary && target.endsWith(".dmg")) notarize(target, notary);
    console.log(`${a.label}: ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)${signing && mac ? notary ? ", signed + notarized" : ", signed" : ""}`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`build-desktop: ${e.message}`);
    process.exit(1);
  });
}
