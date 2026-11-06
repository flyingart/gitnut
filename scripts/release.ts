#!/usr/bin/env bun
// Build a release folder (R-UPD-6).
//   bun run release <version> [--targets all|<list>] [--skip-desktop] [--upload] [--publish --notes FILE.md [--title T]]
// --publish: GitHub release v<version> with every file (gh CLI). The site reads releases from GitHub
// (GITNUT_GITHUB_REPO), so this is the only step after building. Notes: "### New / ### Improved /
// ### Fixed" headings with "- " bullets (they become the changelog page).
// Env: GITNUT_DOWNLOAD_BASE_URL (required), GITNUT_SITE_URL, GITNUT_MANIFEST_URL, GITNUT_RELEASE_NOTES,
//      GITNUT_UPLOAD_CMD (for --upload, e.g. `rsync -av {dir}/ host:/srv/gitnut/{version}/`).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  MANIFEST_FILE,
  SHA256SUMS,
  binaryName,
  buildManifest,
  formatSha256Sums,
  platformOf,
  releaseFiles,
} from "@gitnut/commons";

const ROOT = resolve(import.meta.dir, "..");

function sh(cmd: string[], env: Record<string, string | undefined> = {}) {
  console.log(`$ ${cmd.join(" ")}`);
  const p = Bun.spawnSync(cmd, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["inherit", "inherit", "inherit"] });
  if (p.exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} exited with ${p.exitCode}`);
}

/** Replace the first `"version": "…"` (JSON) or `version = "…"` (TOML) in a file. */
function setVersion(file: string, version: string) {
  const text = readFileSync(file, "utf8");
  const next = file.endsWith(".toml")
    ? text.replace(/^version = "[^"]*"/m, `version = "${version}"`)
    : text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  if (next !== text) writeFileSync(file, next);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      targets: { type: "string", default: "all" },
      "skip-desktop": { type: "boolean", default: false },
      upload: { type: "boolean", default: false },
      publish: { type: "boolean", default: false },
      notes: { type: "string" },
      title: { type: "string" },
    },
  });
  const version = positionals[0]?.replace(/^v/, "");
  if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
    throw new Error("usage: bun run release <version> [--targets all] [--skip-desktop] [--upload]");
  }
  const base = process.env.GITNUT_DOWNLOAD_BASE_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("set GITNUT_DOWNLOAD_BASE_URL (assets are served from <base>/<version>/<file>)");
  const site = process.env.GITNUT_SITE_URL?.replace(/\/+$/, "");
  const manifestUrl = process.env.GITNUT_MANIFEST_URL ?? (site ? `${site}/manifest.json` : undefined);
  if (!manifestUrl) throw new Error("set GITNUT_SITE_URL (or GITNUT_MANIFEST_URL): shipped binaries must know where updates come from");

  // 1. version everywhere
  const pkgs = ["package.json", ...readdirSync(join(ROOT, "packages")).map((p) => join("packages", p, "package.json"))];
  for (const f of [...pkgs, "packages/desktop/src-tauri/tauri.conf.json", "packages/desktop/src-tauri/Cargo.toml"]) {
    if (existsSync(join(ROOT, f))) setVersion(join(ROOT, f), version);
  }

  // 2. web + daemon binaries into release/<version>/
  const dir = join(ROOT, "release", version);
  const buildEnv = { GITNUT_DOWNLOAD_BASE_URL: base, GITNUT_MANIFEST_URL: manifestUrl };
  const daemon = ["bun", "run", "scripts/build-daemon.ts", "--targets", values.targets!, "--out", dir, "--version", version];
  if (existsSync(join(ROOT, "packages", "web", "index.html"))) daemon.push("--build-web");
  sh(daemon, buildEnv);

  // 3. desktop app for this host (other OSes: build there and copy the installers into release/<version>/)
  if (!values["skip-desktop"]) {
    const host = platformOf(process.platform, process.arch);
    const sidecar = host && join(dir, binaryName(host));
    sh(["bun", "run", "scripts/build-desktop.ts", "--version", version, ...(sidecar && existsSync(sidecar) ? ["--sidecar", sidecar] : [])], buildEnv);
  }

  // 4. SHA256SUMS + manifest.json over everything in the folder
  const sums: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (f === SHA256SUMS || f === MANIFEST_FILE || f.startsWith(".") || !statSync(join(dir, f)).isFile()) continue;
    sums[f] = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
  }
  writeFileSync(join(dir, SHA256SUMS), formatSha256Sums(sums));
  const publishedAt = new Date().toISOString();
  const manifest = buildManifest({ version, base, notes: process.env.GITNUT_RELEASE_NOTES, publishedAt, downloadPage: site, sha256s: sums });
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  const missing = Object.values(releaseFiles(version)).filter((f) => !sums[f]);
  console.log(`\nRelease ${version}: ${dir}`);
  for (const f of Object.keys(sums).sort()) console.log(`  ${f}  ${(statSync(join(dir, f)).size / 1e6).toFixed(1)} MB`);
  if (missing.length) console.log(`Missing (build on their OS and copy here, then re-run with --skip-desktop):\n  ${missing.join("\n  ")}`);

  // 5. upload
  if (values.upload) {
    const cmd = process.env.GITNUT_UPLOAD_CMD;
    if (!cmd) throw new Error("--upload needs GITNUT_UPLOAD_CMD, e.g. 'rsync -av {dir}/ host:/srv/gitnut/{version}/'");
    sh(["sh", "-c", cmd.replaceAll("{dir}", dir).replaceAll("{version}", version)]);
  }

  // 6. GitHub release (the site picks it up on its next refresh / restart)
  if (values.publish) {
    if (!values.notes || !existsSync(values.notes)) throw new Error("--publish needs --notes <file.md> (### New / ### Improved / ### Fixed with - bullets)");
    if (missing.length) console.warn(`warning: publishing without ${missing.join(", ")}; add them later with: gh release upload v${version} <file>`);
    const files = readdirSync(dir).map((f) => join(dir, f));
    sh(["gh", "release", "create", `v${version}`, ...files, "--title", values.title ?? `GitNut ${version}`, "--notes-file", values.notes]);
    return;
  }

  console.log("\nSet on the website (Coolify env):");
  console.log(`  GITNUT_LATEST_VERSION=${version}`);
  console.log(`  GITNUT_DOWNLOAD_BASE_URL=${base}`);
  console.log(`  GITNUT_PUBLISHED_AT=${publishedAt}`);
  if (process.env.GITNUT_RELEASE_NOTES) console.log(`  GITNUT_RELEASE_NOTES=${JSON.stringify(process.env.GITNUT_RELEASE_NOTES)}`);
}

main().catch((e) => {
  console.error(`release: ${e.message}`);
  process.exit(1);
});
