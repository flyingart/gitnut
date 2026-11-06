import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { compareVersions, platformOf, type Settings, type UpdateInfo, type UpdateManifest, parseSha256Sums } from "@gitnut/commons";
import { fail } from "./errors";
import { BUILD_MANIFEST_URL, IS_COMPILED, VERSION } from "./version";

/**
 * Update manifest: baked in at build time (GITNUT_SITE_URL). GITNUT_MANIFEST_URL in the daemon's own
 * environment overrides it (tests, self-hosted mirrors). Never a setting: clients can change settings,
 * and whoever picks the manifest picks the binary the daemon installs.
 */
export const manifestUrl = (_s?: Settings) => process.env.GITNUT_MANIFEST_URL || BUILD_MANIFEST_URL;

async function fetchManifest(url: string): Promise<UpdateManifest> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`manifest ${url}: HTTP ${res.status}`);
  const m = (await res.json()) as UpdateManifest;
  if (typeof m?.version !== "string" || typeof m.assets !== "object") throw new Error("manifest has no version / assets");
  return m;
}

/** "desktop" when the desktop app started this daemon (GITNUT_MANAGED_BY): the app updates both. */
export const managedBy = (): UpdateInfo["managedBy"] => (process.env.GITNUT_MANAGED_BY === "desktop" ? "desktop" : undefined);

export async function checkUpdate(s: Settings): Promise<UpdateInfo & { manifest?: UpdateManifest }> {
  if (managedBy()) return { current: VERSION, latest: null, available: false, managedBy: "desktop" };
  const url = manifestUrl(s);
  if (!url) return { current: VERSION, latest: null, available: false, error: "updates are off (no manifest URL)" };
  try {
    const m = await fetchManifest(url);
    return {
      current: VERSION,
      latest: m.version,
      available: compareVersions(m.version, VERSION) > 0,
      notes: m.notes,
      publishedAt: m.publishedAt,
      downloadUrl: m.downloadPage,
      manifest: m,
    };
  } catch (e) {
    return { current: VERSION, latest: null, available: false, error: (e as Error).message };
  }
}

/** The binary to replace. GITNUT_EXEC_PATH overrides it (tests, unusual installs). */
export function execPath(): string {
  if (process.env.GITNUT_EXEC_PATH) return process.env.GITNUT_EXEC_PATH;
  if (!IS_COMPILED) fail("conflict", "running from source: update with git instead (or set GITNUT_EXEC_PATH)");
  return process.execPath;
}

async function expectedSha(assetUrl: string, sha256?: string): Promise<string> {
  if (sha256) return sha256.toLowerCase();
  const sumsUrl = new URL("SHA256SUMS", assetUrl).toString();
  const res = await fetch(sumsUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) fail("internal", `no checksum: ${sumsUrl} HTTP ${res.status}`);
  const name = decodeURIComponent(basename(new URL(assetUrl).pathname));
  const sum = parseSha256Sums(await res.text())[name];
  if (sum) return sum.toLowerCase();
  return fail("internal", `no checksum for ${name} in ${sumsUrl}`);
}

/** Download, verify and atomically install the latest binary. Returns the installed version. */
export async function applyUpdate(s: Settings): Promise<string> {
  if (managedBy()) fail("conflict", "this daemon comes with the GitNut desktop app: update the app, it brings the daemon");
  const target = execPath();
  const info = await checkUpdate(s);
  if (!info.manifest) fail("internal", info.error ?? "no manifest");
  if (!info.available) fail("conflict", `already up to date (${VERSION})`);
  const platform = platformOf(process.platform, process.arch) ?? fail("internal", `unsupported platform ${process.platform}-${process.arch}`);
  const asset = info.manifest!.assets[platform] ?? fail("not_found", `no ${platform} build in the manifest`);
  const want = await expectedSha(asset.url, asset.sha256);
  const res = await fetch(asset.url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) fail("internal", `download ${asset.url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (got !== want) fail("internal", `checksum mismatch for ${asset.url}: expected ${want}, got ${got}`);
  const tmp = `${target}.new`;
  writeFileSync(tmp, bytes);
  chmodSync(tmp, 0o755);
  if (process.platform === "win32") {
    // A running exe can't be overwritten on Windows, but it can be renamed.
    rmSync(`${target}.old`, { force: true });
    if (existsSync(target)) renameSync(target, `${target}.old`);
  }
  try {
    renameSync(tmp, target);
  } catch (e) {
    if (existsSync(`${target}.old`) && !existsSync(target)) renameSync(`${target}.old`, target); // keep a working binary
    throw e;
  }
  return info.latest!;
}

/** Remove the `.old` binary a Windows update leaves behind. */
export function cleanupOldBinary() {
  try {
    if (IS_COMPILED) rmSync(`${process.execPath}.old`, { force: true });
  } catch {}
}

/**
 * Restart into the new binary. Our service units set GITNUT_SERVICE=1 and restart us on exit
 * (INVOCATION_ID alone is unreliable: shells started from any systemd service inherit it).
 * Otherwise spawn the new binary detached; it retries binding until we're gone.
 */
export function restartProcess(beforeExit: () => void) {
  beforeExit();
  if (!process.env.GITNUT_SERVICE) {
    spawn(execPath(), process.argv.slice(2), { detached: true, stdio: "ignore" }).unref();
  }
  process.exit(0);
}
