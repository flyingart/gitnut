#!/usr/bin/env bun
// Build the Tauri desktop app for the host OS (R-UPD-5, R-UPD-6).
//   bun run build:desktop [--version X] [--target <rust triple>] [--sidecar <gitnut binary>] [--no-notarize]
// macOS: signs with your "Developer ID Application" certificate and notarizes the .dmg (scripts/mac-signing.ts).
// Desktop updater: signs the update files with TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) and copies them
// with their .sig next to the installers; --no-updater builds without (local tests).
// Builds web + daemon for the target, bundles it as the sidecar, runs `tauri build` and copies
// the installers to release/<version>/ with the names from packages/commons/src/assets.ts.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP_ASSETS, RUST_TRIPLES, binaryName } from "@gitnut/commons";
import { ROOT, requireSiteUrl, run as runIn } from "./lib";
import { notarize, notaryProfile, pickIdentity, signBinary } from "./mac-signing";

const DESKTOP = join(ROOT, "packages", "desktop");
const TAURI = join(DESKTOP, "src-tauri");

const EXT: Record<string, string> = { dmg: ".dmg", nsis: "-setup.exe", appimage: ".AppImage", deb: ".deb" };

// rustup installs to ~/.cargo/bin, which a fresh shell may not have on PATH yet.
const cargoBin = join(homedir(), ".cargo", "bin");
const PATH = `${cargoBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`;
const run = (cmd: string[], opts: { live?: boolean; cwd?: string; env?: Record<string, string> } = {}) => runIn(cmd, { ...opts, env: { PATH, ...opts.env } });

async function main() {
  const { values } = parseArgs({
    options: { version: { type: "string" }, target: { type: "string" }, sidecar: { type: "string" }, "no-notarize": { type: "boolean", default: false }, "no-updater": { type: "boolean", default: false } },
  });
  const version: string = values.version ?? (await Bun.file(join(TAURI, "tauri.conf.json")).json()).version;
  const host = /^host: (.+)$/m.exec(run(["rustc", "-vV"]))?.[1]?.trim();
  const triple = values.target ?? host!;
  const platform = RUST_TRIPLES[triple];
  if (!platform) throw new Error(`unsupported target ${triple}`);
  if (!values.sidecar) requireSiteUrl(); // build-daemon.ts needs it; fail before the questions and the long build
  const assets = DESKTOP_ASSETS.filter((a) => a.platform === platform);
  if (!assets.length) throw new Error(`no desktop installers are defined for ${platform}`);

  const updater = !values["no-updater"];
  if (updater && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error("set TAURI_SIGNING_PRIVATE_KEY (path or content of the updater key, in .env) or pass --no-updater; see docs/BUILD.md");
  }

  // 0. macOS: certificate and notary profile first, so the questions come before the long build
  // signing applies to macOS targets (built on a Mac); a Windows target on a Mac is not codesigned
  const mac = platform.startsWith("darwin") && process.platform === "darwin";
  const signing = mac ? await pickIdentity() : null;
  const notary = signing && !values["no-notarize"] ? await notaryProfile(signing.team) : null;

  // 1. daemon (with the web client baked in) for this target
  let sidecar = values.sidecar;
  if (!sidecar) {
    const args = ["bun", "run", "scripts/build-daemon.ts", "--targets", platform, "--out", "dist/bin", "--version", version];
    if (existsSync(join(ROOT, "packages", "web", "index.html"))) args.push("--build-web");
    run(args, { live: true });
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
  // macOS: the "app" bundle is where Tauri makes the updater's .app.tar.gz
  const bundles = [...new Set([...(platform.startsWith("darwin") && updater ? ["app"] : []), ...assets.map((a) => a.bundle)])].join(",");
  // the app looks for its updates on the same site the daemon was built for (GITNUT_SITE_URL)
  const site = process.env.GITNUT_SITE_URL?.replace(/\/+$/, "");
  if (updater && !site) throw new Error("set GITNUT_SITE_URL (in .env): the app needs to know where its updates come from");
  const config = updater ? { version, plugins: { updater: { endpoints: [`${site}/desktop/latest.json`] } } } : { version, bundle: { createUpdaterArtifacts: false } };
  const tauri = ["bunx", "tauri", "build", "--bundles", bundles, "--config", JSON.stringify(config)];
  if (values.target) tauri.push("--target", triple);
  // Windows installer from macOS / Linux: Tauri's NSIS cross-build (cargo install cargo-xwin; brew install nsis llvm).
  if (platform.startsWith("windows") && process.platform !== "win32") tauri.push("--runner", "cargo-xwin");
  // No certificate: "-" makes Tauri ad hoc sign the whole .app (otherwise x64 bundles end up unsigned).
  run(tauri, { live: true, cwd: DESKTOP, env: mac ? { APPLE_SIGNING_IDENTITY: signing?.identity ?? "-" } : {} });

  // 3. copy installers to release/<version>/
  const bundleRoot = join(TAURI, "target", ...(values.target ? [triple] : []), "release", "bundle");
  const out = join(ROOT, "release", version);
  mkdirSync(out, { recursive: true });
  for (const a of assets) {
    const dir = join(bundleRoot, a.bundle);
    const found = newest(dir, (f) => f.endsWith(EXT[a.bundle]) && f.includes(version));
    if (!found) throw new Error(`no ${a.bundle} installer for ${version} in ${dir}`);
    const target = join(out, a.file(version));
    copyFileSync(found, target);
    if (notary && target.endsWith(".dmg")) notarize(target, notary);
    // Tauri updater file + signature: the installer itself (Windows, AppImage) or the .app.tar.gz (macOS)
    if (updater && a.updater) {
      const upd = a.updater.file(version);
      const src = upd === a.file(version) ? found : newest(join(bundleRoot, "macos"), (f) => f.endsWith(".app.tar.gz"));
      if (!src || !existsSync(`${src}.sig`)) throw new Error(`no updater file / signature for ${a.label} (${src ?? "missing .app.tar.gz"})`);
      if (src !== found) copyFileSync(src, join(out, upd));
      copyFileSync(`${src}.sig`, join(out, `${upd}.sig`));
    }
    console.log(`${a.label}: ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)${signing && mac ? notary ? ", signed + notarized" : ", signed" : ""}`);
  }
}

/** Newest file in `dir` whose name `match` accepts. */
function newest(dir: string, match: (name: string) => boolean): string | undefined {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter(match)
    .map((f) => join(dir, f))
    .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs)[0];
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`build-desktop: ${e.message}`);
    process.exit(1);
  });
}
