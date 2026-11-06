#!/usr/bin/env bun
// Release wizard (R-UPD-6). Run `bun run release` and follow the prompts. Steps, also runnable directly:
//   bun run release start [version]    set the version (PR, auto-merged when CI is green) + draft GitHub release
//   bun run release build [version]    on each build machine: build what this machine can, upload to the draft
//   bun run release publish [version]  checksums + release notes, then publish; the site picks it up in ~10 min
// Flags: --yes (accept defaults, no questions), --notes notes.md, --title "…", --cli / --no-cli.
// Needs: gh (logged in), .env with GITNUT_SITE_URL (+ TAURI_SIGNING_PRIVATE_KEY for desktop builds).
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import { DESKTOP_ASSETS, type Platform, SHA256SUMS, binaryName, formatSha256Sums, parseSha256Sums, platformOf, releaseFiles } from "@gitnut/commons";

const ROOT = resolve(import.meta.dir, "..");
const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    yes: { type: "boolean", default: false },
    notes: { type: "string" },
    title: { type: "string" },
    cli: { type: "boolean" },
    "no-cli": { type: "boolean" },
  },
});
const interactive = process.stdin.isTTY && !flags.yes;

// ---- small helpers -------------------------------------------------------------------------

function run(cmd: string[], opts: { live?: boolean; cwd?: string; allowFail?: boolean } = {}): string {
  if (opts.live) p.log.step(`$ ${cmd.join(" ")}`);
  const r = Bun.spawnSync(cmd, { cwd: opts.cwd ?? ROOT, stdio: opts.live ? ["inherit", "inherit", "inherit"] : ["ignore", "pipe", "pipe"] });
  if (r.exitCode !== 0 && !opts.allowFail) throw new Error(`${cmd.slice(0, 3).join(" ")} failed${opts.live ? "" : `: ${String(r.stderr ?? "").trim()}`}`);
  return opts.live ? "" : String(r.stdout ?? "").trim();
}
const has = (bin: string) => Bun.spawnSync(["sh", "-c", `command -v ${bin}`], { stdio: ["ignore", "ignore", "ignore"] }).exitCode === 0;

async function ask<T>(v: Promise<T | symbol>): Promise<Exclude<T, symbol>> {
  const r = await v;
  if (p.isCancel(r)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
  return r as Exclude<T, symbol>;
}
async function confirm(message: string, initialValue = true): Promise<boolean> {
  return interactive ? ask(p.confirm({ message, initialValue })) : initialValue;
}

const pkgVersion = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
const isVersion = (v: string) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v);
const nextPatch = (v: string) => v.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, a, b, c) => `${a}.${b}.${Number(c) + 1}`);

let repoName = "";
function repo(): string {
  return (repoName ||= run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]));
}
interface GhRelease {
  tagName: string;
  isDraft: boolean;
}
const releases = (): GhRelease[] => JSON.parse(run(["gh", "release", "list", "-R", repo(), "--limit", "30", "--json", "tagName,isDraft"]) || "[]");
const draftVersions = () => releases().filter((r) => r.isDraft).map((r) => r.tagName.replace(/^v/, ""));
const assetsOf = (v: string): string[] => JSON.parse(run(["gh", "release", "view", `v${v}`, "-R", repo(), "--json", "assets", "--jq", "[.assets[].name]"]));

/** Every file a complete release has: CLI binaries, desktop installers, desktop updater files + signatures. */
function expectedFiles(version: string): string[] {
  const updater = DESKTOP_ASSETS.flatMap((a) => (a.updater ? [a.updater.file(version), `${a.updater.file(version)}.sig`] : []));
  return [...new Set([...Object.values(releaseFiles(version)), ...updater])];
}

function preflight() {
  if (!has("gh")) throw new Error("GitHub CLI `gh` is missing: https://cli.github.com");
  if (Bun.spawnSync(["gh", "auth", "status"], { stdio: ["ignore", "ignore", "ignore"] }).exitCode !== 0) throw new Error("gh is not logged in: run `gh auth login`");
}

async function pickVersion(label: string, fallback: string): Promise<string> {
  const given = positionals[1]?.replace(/^v/, "");
  if (given) {
    if (!isVersion(given)) throw new Error(`not a version: ${given}`);
    return given;
  }
  if (!interactive) return fallback;
  return ask<string>(p.text({ message: label, initialValue: fallback, validate: (v) => (isVersion(v ?? "") ? undefined : "Use x.y.z") }));
}

// ---- start ---------------------------------------------------------------------------------

/** Set `"version"` (JSON) / `version =` (TOML) in a file. */
function setVersion(file: string, version: string) {
  const text = readFileSync(file, "utf8");
  const next = file.endsWith(".toml")
    ? text.replace(/^version = "[^"]*"/m, `version = "${version}"`)
    : text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  if (next !== text) writeFileSync(file, next);
}

async function start() {
  preflight();
  if (run(["git", "status", "--porcelain"])) throw new Error("the working tree has uncommitted changes: commit or stash them first");
  run(["git", "fetch", "-q", "origin"]);
  if (run(["git", "rev-parse", "--abbrev-ref", "HEAD"]) !== "main" || run(["git", "rev-parse", "HEAD"]) !== run(["git", "rev-parse", "origin/main"])) {
    if (!(await confirm("Switch to an up-to-date main first?"))) throw new Error("start a release from an up-to-date main");
    run(["git", "checkout", "-q", "main"]);
    run(["git", "pull", "-q", "--ff-only"]);
  }
  const published = releases().find((r) => !r.isDraft)?.tagName.replace(/^v/, "");
  const version = await pickVersion("Version to release", nextPatch(published ?? pkgVersion()));
  if (releases().some((r) => r.tagName === `v${version}`)) throw new Error(`v${version} exists already on GitHub`);

  const s = p.spinner();
  s.start(`Setting version ${version}`);
  const files = ["package.json", ...readdirSync(join(ROOT, "packages")).map((d) => join("packages", d, "package.json"))];
  for (const f of [...files, "packages/desktop/src-tauri/tauri.conf.json", "packages/desktop/src-tauri/Cargo.toml"]) {
    if (existsSync(join(ROOT, f))) setVersion(join(ROOT, f), version);
  }
  const lock = join(ROOT, "packages/desktop/src-tauri/Cargo.lock");
  if (existsSync(lock)) writeFileSync(lock, readFileSync(lock, "utf8").replace(/(name = "gitnut-desktop"\nversion = )"[^"]*"/, `$1"${version}"`));
  run(["bun", "install"]); // bun.lock records the workspace versions
  s.stop(`Version ${version} set`);

  const branch = `release/${version}`;
  run(["git", "checkout", "-q", "-b", branch]);
  run(["git", "commit", "-q", "-am", `chore: release ${version}`]);
  run(["git", "push", "-q", "-u", "origin", branch]);
  const pr = run(["gh", "pr", "create", "-R", repo(), "--title", `GitNut ${version}`, "--body", `Version ${version}. Merges by itself when CI is green.`]);
  run(["gh", "pr", "merge", pr, "-R", repo(), "--squash", "--auto", "--delete-branch"], { allowFail: true });
  run(["gh", "release", "create", `v${version}`, "-R", repo(), "--draft", "--target", "main", "--title", `GitNut ${version}`, "--notes", "Draft: files are being built."]);
  run(["git", "checkout", "-q", "main"]);
  p.note(
    [`Version PR: ${pr} (merges itself when CI is green)`, `Draft release: v${version}`, "", "Next, on each build machine once the PR merged:", "  git checkout main && git pull", "  bun run release build", "Then, on any machine:", "  bun run release publish"].join("\n"),
    `Release ${version} started`,
  );
}

// ---- build ---------------------------------------------------------------------------------

interface Target {
  value: string;
  label: string;
  hint?: string;
}

function desktopTargets(): Target[] {
  const host = platformOf(process.platform, process.arch);
  const out: Target[] = [];
  if (process.platform === "darwin") {
    out.push({ value: "aarch64-apple-darwin", label: "macOS Apple Silicon (.dmg + update)" });
    out.push({ value: "x86_64-apple-darwin", label: "macOS Intel (.dmg + update)" });
    const xwin = has("cargo-xwin") && has("makensis");
    out.push({ value: "x86_64-pc-windows-msvc", label: "Windows installer (cross-build)", hint: xwin ? undefined : "needs: brew install nsis llvm; cargo install cargo-xwin" });
  } else if (process.platform === "win32") out.push({ value: "x86_64-pc-windows-msvc", label: "Windows installer" });
  else if (host === "linux-x64") out.push({ value: "x86_64-unknown-linux-gnu", label: "Linux AppImage + .deb" });
  return out;
}

async function build() {
  preflight();
  const drafts = draftVersions();
  if (!drafts.length) throw new Error("no draft release on GitHub: run `bun run release start` first");
  const fallback = drafts.includes(pkgVersion()) ? pkgVersion() : drafts[0];
  const version = positionals[1]?.replace(/^v/, "") ?? (interactive && drafts.length > 1 ? await ask<string>(p.select({ message: "Draft release to build", options: drafts.map((v) => ({ value: v, label: `v${v}` })) })) : fallback);
  if (!drafts.includes(version)) throw new Error(`v${version} is not a draft release`);
  if (pkgVersion() !== version) {
    if (!(await confirm(`This checkout is at ${pkgVersion()}, not ${version}. Update main now (git checkout main && git pull)?`))) throw new Error("build from the commit that has the release version");
    run(["git", "checkout", "-q", "main"]);
    run(["git", "pull", "-q", "--ff-only"]);
    if (pkgVersion() !== version) throw new Error(`main is still at ${pkgVersion()}: wait until the version PR of ${version} is merged`);
  }
  if (!process.env.GITNUT_SITE_URL) throw new Error("set GITNUT_SITE_URL in .env (e.g. GITNUT_SITE_URL=https://gitnut.dev): binaries need to know where updates come from");

  const uploaded = new Set(assetsOf(version));
  const cliDone = PLATFORMS_FILES(version).every((f) => uploaded.has(f));
  const targets = desktopTargets();
  const wantCli = flags["no-cli"] ? false : (flags.cli ?? (interactive ? await confirm(`Build the 5 CLI binaries?${cliDone ? " (already uploaded)" : ""}`, !cliDone) : !cliDone));
  let desktop: string[] = targets.filter((t) => !t.hint).map((t) => t.value);
  if (interactive && targets.length) {
    desktop = await ask<string[]>(
      p.multiselect({
        message: "Desktop apps to build on this machine",
        options: targets.map((t) => ({ value: t.value, label: t.label, hint: t.hint })),
        initialValues: desktop,
        required: false,
      }),
    );
  }
  if (desktop.length && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error("set TAURI_SIGNING_PRIVATE_KEY in .env (path of the desktop updater key, see docs/BUILD.md)");
  }
  if (!wantCli && !desktop.length) return p.outro("Nothing to build.");

  const dir = join(ROOT, "release", version);
  if (wantCli) run(["bun", "run", "scripts/build-daemon.ts", "--targets", "all", "--out", dir, "--version", version, "--build-web"], { live: true });
  for (const t of desktop) {
    const args = ["bun", "run", "scripts/build-desktop.ts", "--version", version, "--target", t];
    // reuse the CLI binary just built for this target instead of building it again
    const sidecar = TRIPLE_PLATFORM[t] && join(dir, binaryName(TRIPLE_PLATFORM[t]));
    if (sidecar && existsSync(sidecar)) args.push("--sidecar", sidecar);
    run(args, { live: true });
  }

  // upload what this run built, plus a partial checksum list the publish step merges
  // release/<version>/ on this machine holds only what this machine built
  const built = readdirSync(dir).filter((f) => !f.startsWith(SHA256SUMS) && statSync(join(dir, f)).isFile());
  const sums: Record<string, string> = {};
  for (const f of built) sums[f] = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
  // per-machine name without the host name (draft assets are visible to repo members)
  const partial = join(dir, `SHA256SUMS.${process.platform}-${process.arch}-${crypto.randomUUID().slice(0, 8)}`);
  writeFileSync(partial, formatSha256Sums(sums));
  const s = p.spinner();
  s.start(`Uploading ${built.length} files to the draft v${version}`);
  run(["gh", "release", "upload", `v${version}`, "-R", repo(), "--clobber", ...built.map((f) => join(dir, f)), partial]);
  s.stop(`Uploaded ${built.length} files`);
  const missing = expectedFiles(version).filter((f) => !new Set(assetsOf(version)).has(f));
  p.note(missing.length ? `Still missing (build them on another machine):\n  ${missing.join("\n  ")}` : "Every file is there: run `bun run release publish`.", `v${version}`);
}

const TRIPLE_PLATFORM: Record<string, Platform> = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-pc-windows-msvc": "windows-x64",
  "x86_64-unknown-linux-gnu": "linux-x64",
};

const PLATFORMS_FILES = (version: string) => Object.entries(releaseFiles(version)).filter(([k]) => !k.startsWith("desktop-")).map(([, f]) => f);

// ---- publish -------------------------------------------------------------------------------

const NOTES_TEMPLATE = `### New
-
### Improved
-
### Fixed
-
`;

async function notesFile(version: string): Promise<string> {
  if (flags.notes) {
    if (!existsSync(flags.notes)) throw new Error(`no such file: ${flags.notes}`);
    return flags.notes;
  }
  if (!interactive) throw new Error("pass --notes notes.md (### New / ### Improved / ### Fixed with - bullets)");
  const file = join(mkdtempSync(join(tmpdir(), "gitnut-notes-")), `notes-${version}.md`);
  writeFileSync(file, NOTES_TEMPLATE);
  const editor = process.env.VISUAL || process.env.EDITOR || (has("nano") ? "nano" : "vi");
  p.log.info(`Write the release notes in ${editor}: they become the changelog page and the update notes. Save and close to continue.`);
  Bun.spawnSync([...editor.split(" "), file], { stdio: ["inherit", "inherit", "inherit"] });
  const text = readFileSync(file, "utf8").replace(/^- \s*$/gm, "").replace(/### \w+\n(?=###|\s*$)/g, "");
  if (!/^- \S/m.test(text)) throw new Error("the notes have no bullet points");
  writeFileSync(file, text.trim() + "\n");
  return file;
}

async function publish() {
  preflight();
  const drafts = draftVersions();
  if (!drafts.length) throw new Error("no draft release to publish");
  const version = positionals[1]?.replace(/^v/, "") ?? (interactive && drafts.length > 1 ? await ask<string>(p.select({ message: "Draft release to publish", options: drafts.map((v) => ({ value: v, label: `v${v}` })) })) : drafts[0]);
  const mainVersion = JSON.parse(run(["gh", "api", `repos/${repo()}/contents/package.json?ref=main`, "--jq", ".content"]).split("\n").map((l) => atob(l)).join("")).version;
  if (mainVersion !== version) throw new Error(`main is at ${mainVersion}: merge the version PR of ${version} first (the tag is created on main)`);

  const assets = assetsOf(version);
  const missing = expectedFiles(version).filter((f) => !assets.includes(f));
  if (missing.length) {
    p.log.warn(`Missing files:\n  ${missing.join("\n  ")}`);
    if (!(await confirm("Publish without them? (users of those platforms keep the previous version)", false))) return p.outro("Not published.");
  }

  // merge the partial checksum lists of every build machine into SHA256SUMS
  const tmp = mkdtempSync(join(tmpdir(), "gitnut-publish-"));
  run(["gh", "release", "download", `v${version}`, "-R", repo(), "-p", "SHA256SUMS.*", "-D", tmp]);
  const sums: Record<string, string> = {};
  for (const f of readdirSync(tmp)) Object.assign(sums, parseSha256Sums(readFileSync(join(tmp, f), "utf8")));
  const unsummed = assets.filter((a) => !a.startsWith(SHA256SUMS) && !sums[a]);
  if (unsummed.length) throw new Error(`no checksum for: ${unsummed.join(", ")} (upload them with \`bun run release build\`)`);
  const sumsFile = join(tmp, SHA256SUMS);
  writeFileSync(sumsFile, formatSha256Sums(Object.fromEntries(Object.entries(sums).filter(([f]) => assets.includes(f)))));

  const notes = await notesFile(version);
  const title = flags.title ?? (interactive ? await ask<string>(p.text({ message: "Release title", initialValue: `GitNut ${version}` })) : `GitNut ${version}`);
  if (!(await confirm(`Publish GitNut ${version} now?`))) return p.outro("Not published.");

  const s = p.spinner();
  s.start("Publishing");
  run(["gh", "release", "upload", `v${version}`, "-R", repo(), "--clobber", sumsFile]);
  for (const a of assets.filter((x) => x.startsWith(`${SHA256SUMS}.`))) run(["gh", "release", "delete-asset", `v${version}`, a, "-R", repo(), "-y"]);
  run(["gh", "release", "edit", `v${version}`, "-R", repo(), "--title", title, "--notes-file", notes, "--draft=false", "--latest"]);
  rmSync(tmp, { recursive: true, force: true });
  s.stop(`Published v${version}`);
  p.outro(`https://github.com/${repo()}/releases/tag/v${version}\nThe website offers it within 10 minutes (or restart it).`);
}

// ---- main ----------------------------------------------------------------------------------

async function main() {
  p.intro("GitNut release");
  let step = positionals[0];
  if (!step) {
    if (!interactive) {
      console.log("usage: bun run release <start|build|publish> [version] [--yes] [--notes notes.md] [--title T] [--cli|--no-cli]");
      process.exit(1);
    }
    step = await ask<string>(
      p.select({
        message: "What do you want to do?",
        options: [
          { value: "start", label: "Start a new release", hint: "version PR + draft release" },
          { value: "build", label: "Build on this machine", hint: "uploads to the draft" },
          { value: "publish", label: "Publish a draft", hint: "checksums + notes" },
        ],
      }),
    );
  }
  if (step === "start") await start();
  else if (step === "build") await build();
  else if (step === "publish") await publish();
  else throw new Error(`unknown step ${step}: start, build or publish`);
}

main().catch((e) => {
  p.log.error(e.message);
  process.exit(1);
});
