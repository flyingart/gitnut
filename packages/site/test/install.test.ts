import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSite } from "../server/server";
import "./dist";

// Fake release host: every `gitnut-<platform>` is the same dummy shell script.
const BINARY = '#!/bin/sh\necho "gitnut 9.9.9"\n';
const GOOD = createHash("sha256").update(BINARY).digest("hex");
let sums = "";
const files = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const name = new URL(req.url).pathname.split("/").pop()!;
    if (name === "SHA256SUMS") return new Response(sums);
    if (name.startsWith("gitnut-")) return new Response(BINARY);
    return new Response("not found", { status: 404 });
  },
});
const site = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  // GitHub API stand-in: one release whose files live on the fake host above
  fetch: createSite({ GITNUT_GITHUB_REPO: "o/r" }, ((url: string) =>
    String(url).includes("api.github.com/repos/")
      ? Promise.resolve(
          Response.json([
            {
              tag_name: "v9.9.9",
              name: "9.9.9",
              body: "",
              draft: false,
              prerelease: false,
              published_at: "2026-11-06T10:00:00Z",
              assets: ["SHA256SUMS", ...["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"].map((p) => `gitnut-${p}`)].map((f) => ({
                name: f,
                url: `https://api.github.com/assets/${f}`,
                browser_download_url: `http://127.0.0.1:${files.port}/rel/9.9.9/${f}`,
              })),
            },
          ]),
        )
      : fetch(url)) as unknown as typeof fetch),
});
const tmp = mkdtempSync(join(tmpdir(), "gitnut-install-"));
afterAll(() => {
  files.stop(true);
  site.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

function sumsFor(hash: string) {
  return ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"].map((p) => `${hash}  gitnut-${p}\n`).join("");
}

async function install(home: string) {
  const p = Bun.spawn(["sh", "-c", `curl -fsSL http://127.0.0.1:${site.port}/install.sh | sh`], {
    env: { HOME: home, PATH: `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code, out, err };
}

describe("install.sh", () => {
  test("R-UPD-4: install.sh passes sh -n", async () => {
    const p = Bun.spawn(["sh", "-n", join(import.meta.dir, "..", "public", "install.sh")]);
    expect(await p.exited).toBe(0);
  });

  test("R-UPD-4: downloads, verifies and installs into ~/.gitnut/bin with a ~/.local/bin link", async () => {
    sums = sumsFor(GOOD);
    const home = join(tmp, "ok");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const r = await install(home);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const bin = join(home, ".gitnut", "bin", "gitnut");
    expect(lstatSync(bin).mode & 0o111).toBeTruthy();
    expect(readlinkSync(join(home, ".local", "bin", "gitnut"))).toBe(bin);
    expect(r.out).toContain("gitnut roots add <folder>");
    expect(r.out).toContain("gitnut service install");
    const run = Bun.spawnSync([bin]);
    expect(run.stdout.toString().trim()).toBe("gitnut 9.9.9");
  });

  test("R-UPD-4: a checksum mismatch fails and installs nothing", async () => {
    sums = sumsFor("0".repeat(64));
    const home = join(tmp, "bad");
    mkdirSync(home, { recursive: true });
    const r = await install(home);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("checksum mismatch");
    expect(existsSync(join(home, ".gitnut", "bin", "gitnut"))).toBe(false);
  });
});
