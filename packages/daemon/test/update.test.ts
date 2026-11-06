import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binaryName, platformOf, type UpdateManifest } from "@gitnut/commons";
import { Client, bearer, startDaemon, tmp } from "./helpers";
import { VERSION } from "../src/version";

const platform = platformOf(process.platform, process.arch)!;
const NEW_BINARY = "#!/bin/sh\necho new gitnut\n";
const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

let manifest: UpdateManifest;
let sums: string | null;
const site = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/manifest.json") return Response.json(manifest);
    if (p === `/dl/${binaryName(platform)}`) return new Response(NEW_BINARY);
    if (p === "/dl/SHA256SUMS" && sums !== null) return new Response(sums);
    return new Response("nope", { status: 404 });
  },
});
const base = `http://127.0.0.1:${site.port}`;
const exe = join(tmp(), "gitnut");
let restarts = 0;
let env: Awaited<ReturnType<typeof startDaemon>>;
let c: Client;

beforeAll(async () => {
  process.env.GITNUT_EXEC_PATH = exe;
  manifest = { version: "99.0.0", notes: "big one", downloadPage: `${base}/download`, assets: { [platform]: { url: `${base}/dl/${binaryName(platform)}` } } };
  env = await startDaemon({ update: { manifestUrl: `${base}/manifest.json`, autoCheck: true } }, {}, { restart: () => restarts++ });
  c = await Client.connect(env.wsUrl, bearer(env.token));
});
afterAll(async () => {
  delete process.env.GITNUT_EXEC_PATH;
  c.close();
  await env.d.stop();
  site.stop(true);
});
beforeEach(() => {
  writeFileSync(exe, "old binary");
  sums = `${"0".repeat(64)}  other-file\n${sha(NEW_BINARY)}  ${binaryName(platform)}\n`;
  manifest.version = "99.0.0";
  delete manifest.assets[platform].sha256;
});

test("R-UPD-2: autoCheck at start pushes update.available to clients", async () => {
  expect((await c.waitEvent("update.available")).latest).toBe("99.0.0");
  const late = await Client.connect(env.wsUrl, bearer(env.token));
  expect((await late.waitEvent("update.available")).available).toBe(true);
  late.close();
});

test("R-UPD-2: update.check compares versions against the manifest", async () => {
  const info = await c.call("update.check");
  expect(info).toMatchObject({ current: VERSION, latest: "99.0.0", available: true, notes: "big one", downloadUrl: `${base}/download` });
  expect(info.manifest).toBeUndefined();
  manifest.version = VERSION;
  expect((await c.call("update.check")).available).toBe(false);
});

test("R-UPD-2: update.apply verifies SHA256SUMS, replaces the executable and restarts", async () => {
  const r = await c.call("update.apply");
  expect(r).toEqual({ version: "99.0.0", restarting: true });
  expect(readFileSync(exe, "utf8")).toBe(NEW_BINARY);
  expect(statSync(exe).mode & 0o777).toBe(0o755);
  await Bun.sleep(400);
  expect(restarts).toBe(1);
});

test("R-UPD-2: manifest sha256 is used when present", async () => {
  manifest.assets[platform].sha256 = sha(NEW_BINARY).toUpperCase();
  sums = null;
  await c.call("update.apply");
  expect(readFileSync(exe, "utf8")).toBe(NEW_BINARY);
});

test("R-UPD-2: bad or missing checksum is refused and the binary stays", async () => {
  manifest.assets[platform].sha256 = "f".repeat(64);
  const bad = await c.send("update.apply");
  expect(bad.error.message).toContain("checksum mismatch");
  expect(readFileSync(exe, "utf8")).toBe("old binary");
  delete manifest.assets[platform].sha256;
  sums = `${"0".repeat(64)}  other-file\n`;
  expect((await c.send("update.apply")).error.message).toContain("no checksum");
  sums = null;
  expect((await c.send("update.apply")).error.message).toContain("no checksum");
  expect(readFileSync(exe, "utf8")).toBe("old binary");
});

test("R-UPD-2: up to date and no manifest URL", async () => {
  manifest.version = VERSION;
  expect((await c.send("update.apply")).error.code).toBe("conflict");
  await c.call("settings.update", { patch: { update: { manifestUrl: "" } } });
  const info = await c.call("update.check");
  expect(info.error).toContain("updates are off");
  await c.call("settings.update", { patch: { update: { manifestUrl: `${base}/manifest.json` } } });
});

test("R-UPD-3: running from source refuses update.apply without GITNUT_EXEC_PATH", async () => {
  delete process.env.GITNUT_EXEC_PATH;
  try {
    const r = await c.send("update.apply");
    expect(r.error.code).toBe("conflict");
    expect(r.error.message).toContain("source");
  } finally {
    process.env.GITNUT_EXEC_PATH = exe;
  }
});

test("R-UPD-5: a daemon started by the desktop app leaves updates to the app", async () => {
  process.env.GITNUT_MANAGED_BY = "desktop";
  try {
    const info = await c.call("update.check");
    expect(info).toMatchObject({ available: false, managedBy: "desktop" });
    const r = await c.send("update.apply");
    expect(r.error.code).toBe("conflict");
    expect(r.error.message).toContain("desktop app");
  } finally {
    delete process.env.GITNUT_MANAGED_BY;
  }
});
