import { describe, expect, test } from "bun:test";
import { createSite } from "../src/server";

const ENV = {
  GITNUT_LATEST_VERSION: "1.4.0",
  GITNUT_DOWNLOAD_BASE_URL: "https://dl.example.com/gitnut/",
  GITNUT_RELEASE_NOTES: "Faster graph",
  GITNUT_PUBLISHED_AT: "2026-11-06T10:00:00Z",
  GITNUT_SITE_URL: "https://gitnut.example.com",
};
const SUMS = `${"a".repeat(64)}  gitnut-linux-x64\n${"b".repeat(64)}  GitNut-1.4.0-darwin-arm64.dmg\n`;

function site(env: Record<string, string> = ENV, sums: string | null = SUMS) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(String(url));
    return sums === null ? new Response("nope", { status: 404 }) : new Response(sums);
  }) as unknown as typeof fetch;
  const handle = createSite(env, fetchImpl);
  return { seen, get: (path: string) => handle(new Request(`http://site.local${path}`)) };
}

describe("site", () => {
  test("R-UPD-1: /manifest.json comes from env, with sha256 from SHA256SUMS", async () => {
    const s = site();
    const res = await s.get("/manifest.json");
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.version).toBe("1.4.0");
    expect(m.notes).toBe("Faster graph");
    expect(m.publishedAt).toBe("2026-11-06T10:00:00Z");
    expect(m.downloadPage).toBe("https://gitnut.example.com");
    expect(m.assets["linux-x64"]).toEqual({ url: "https://dl.example.com/gitnut/1.4.0/gitnut-linux-x64", sha256: "a".repeat(64) });
    expect(m.assets["windows-x64"].url).toBe("https://dl.example.com/gitnut/1.4.0/gitnut-windows-x64.exe");
    expect(m.assets["windows-x64"].sha256).toBeUndefined();
    expect(m.assets["desktop-darwin-arm64"].sha256).toBe("b".repeat(64));
    expect(s.seen).toEqual(["https://dl.example.com/gitnut/1.4.0/SHA256SUMS"]);
    await s.get("/manifest.json");
    expect(s.seen).toHaveLength(1); // cached
  });

  test("R-UPD-1: manifest works without SHA256SUMS and reports 503 when unconfigured", async () => {
    const m = await (await site(ENV, null).get("/manifest.json")).json();
    expect(m.assets["linux-x64"].sha256).toBeUndefined();
    expect((await site({}).get("/manifest.json")).status).toBe(503);
    expect((await site({}).get("/install.sh")).status).toBe(503);
  });

  test("R-SITE-2: /download/<key> redirects to the release asset", async () => {
    const s = site();
    let res = await s.get("/download/darwin-arm64");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://dl.example.com/gitnut/1.4.0/gitnut-darwin-arm64");
    res = await s.get("/download/desktop-windows-x64");
    expect(res.headers.get("location")).toBe("https://dl.example.com/gitnut/1.4.0/GitNut-1.4.0-windows-x64-setup.exe");
    res = await s.get("/download/desktop-linux-x64-deb");
    expect(res.headers.get("location")).toEndWith("/GitNut-1.4.0-linux-x64.deb");
    expect((await s.get("/download/solaris-sparc")).status).toBe(404);
  });

  test("R-UPD-4: install scripts are templated with site URL, download base and version", async () => {
    const s = site();
    const sh = await (await s.get("/install.sh")).text();
    expect(sh).toContain('BASE="https://dl.example.com/gitnut"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
    expect(sh).toContain('VERSION="${GITNUT_VERSION:-1.4.0}"');
    expect(sh).toContain("https://gitnut.example.com/install.ps1");
    expect(sh).not.toContain("__GITNUT_");
    const ps = await (await s.get("/install.ps1")).text();
    expect(ps).toContain("$Base = 'https://dl.example.com/gitnut'");
    expect(ps).toContain("'1.4.0'");
    expect(ps).toContain("Get-FileHash");
    expect(ps).not.toContain("__GITNUT_");
  });

  test("R-SITE-2: site URL falls back to forwarded headers", async () => {
    const { GITNUT_SITE_URL: _, ...env } = ENV;
    const handle = createSite(env, (async () => new Response("")) as unknown as typeof fetch);
    const res = await handle(new Request("http://10.0.0.5:7431/install.sh", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "get.gitnut.dev" } }));
    expect(await res.text()).toContain("irm https://get.gitnut.dev/install.ps1 | iex");
  });

  test("R-SITE-1: landing page, static files and healthz", async () => {
    const s = site();
    const html = await (await s.get("/")).text();
    expect(html).toContain('src="/app.js"');
    expect((await s.get("/detect.js")).status).toBe(200);
    expect((await s.get("/logo.svg")).status).toBe(200);
    expect(await (await s.get("/healthz")).text()).toBe("ok");
    expect(Array.isArray(await (await s.get("/screenshots.json")).json())).toBe(true);
    expect((await s.get("/../src/server.ts")).status).toBe(404);
    expect((await s.get("/%2e%2e/src/server.ts")).status).toBe(404);
  });

  test("R-SITE-1: /changelog serves the page; changelog.json parses and is newest first", async () => {
    const s = site();
    for (const path of ["/changelog", "/changelog/"]) {
      const res = await s.get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain('id="releases"');
    }
    const releases: { version: string; date: string; title: string; items: { type: string; text: string }[] }[] = await (
      await s.get("/changelog.json")
    ).json();
    expect(releases.length).toBeGreaterThan(0);
    const num = (v: string) => v.split(".").map(Number);
    for (const [i, r] of releases.entries()) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title).toBeTruthy();
      expect(r.items.length).toBeGreaterThan(0);
      for (const it of r.items) expect(["new", "improved", "fixed"]).toContain(it.type);
      if (i === 0) continue;
      const prev = releases[i - 1];
      expect(prev.date >= r.date).toBe(true);
      const [a, b] = [num(prev.version), num(r.version)];
      expect(a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).toBeGreaterThan(0);
    }
  });

  test("R-SITE-2: /site.json lists only the configured http(s) sponsor links", async () => {
    expect(await (await site().get("/site.json")).json()).toEqual({ sponsors: {} });
    const s = site({
      ...ENV,
      GITNUT_SPONSOR_GITHUB: " https://github.com/sponsors/flyingart ",
      GITNUT_SPONSOR_KOFI: "",
      GITNUT_SPONSOR_PAYPAL: "javascript:alert(1)",
    });
    expect(await (await s.get("/site.json")).json()).toEqual({ sponsors: { github: "https://github.com/sponsors/flyingart" } });
  });
});

test("R-SITE-2: GITNUT_RELEASE_DIR serves release files, nothing outside it", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "gitnut-rel-"));
  mkdirSync(join(dir, "1.2.3"));
  writeFileSync(join(dir, "1.2.3", "gitnut-linux-x64"), "BIN");
  writeFileSync(join(dir, "secret"), "NO");
  const handle = createSite({ GITNUT_LATEST_VERSION: "1.2.3", GITNUT_DOWNLOAD_BASE_URL: "http://x/releases", GITNUT_RELEASE_DIR: dir });
  const get = (p: string) => handle(new Request(`http://site${p}`));
  const ok = await get("/releases/1.2.3/gitnut-linux-x64");
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe("BIN");
  for (const bad of ["/releases/secret", "/releases/../secret", "/releases/1.2.3/../../secret", "/releases/%2e%2e/secret", "/releases/1.2.3/missing"])
    expect((await get(bad)).status).toBe(404);
  // off without the env var
  expect((await createSite({})(new Request("http://site/releases/1.2.3/gitnut-linux-x64"))).status).toBe(404);
});

describe("site from GitHub releases", () => {
  const rel = (tag: string, at: string, body: string, files: string[]) => ({
    tag_name: tag,
    name: `Release ${tag}`,
    body,
    draft: false,
    prerelease: false,
    published_at: at,
    assets: files.map((f) => ({ name: f, url: `https://api.github.com/assets/${tag}/${f}`, browser_download_url: `https://github.com/o/r/releases/download/${tag}/${f}` })),
  });
  const RELEASES = [
    rel("v0.2.0", "2026-11-06T10:00:00Z", "### New\n- Image diffs\n### Fixed\n- Page scrollbar", ["gitnut-linux-x64", "SHA256SUMS"]),
    rel("v0.3.0", "2026-11-08T10:00:00Z", "## Improved\n- Faster graph\n* Smaller binary\n## Fixes\n- Footer", ["gitnut-linux-x64", "SHA256SUMS"]),
    { ...rel("v0.4.0-rc1", "2026-11-09T10:00:00Z", "", []), prerelease: true },
  ];
  function ghSite(env: Record<string, string>) {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      seen.push({ url: String(url), auth });
      if (String(url).includes("/releases?")) return Response.json(RELEASES);
      if (String(url).endsWith("/v0.3.0/SHA256SUMS")) return new Response(null, { status: 302, headers: { location: "https://storage.example/sums" } });
      if (String(url) === "https://storage.example/sums") return new Response(`${"c".repeat(64)}  gitnut-linux-x64\n`);
      if (String(url).includes("/assets/v0.3.0/gitnut-linux-x64")) return new Response(null, { status: 302, headers: { location: "https://storage.example/bin" } });
      if (String(url) === "https://storage.example/bin") return new Response("BINARY");
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const handle = createSite({ GITNUT_GITHUB_REPO: "o/r", GITNUT_SITE_URL: "https://site.example", ...env }, fetchImpl);
    return { seen, get: (path: string) => handle(new Request(`http://site.local${path}`)) };
  }

  test("R-UPD-1: latest release, manifest, checksums and changelog come from GitHub", async () => {
    const s = ghSite({});
    const m = await (await s.get("/manifest.json")).json();
    expect(m.version).toBe("0.3.0");
    expect(m.notes).toBe("Faster graph");
    expect(m.publishedAt).toBe("2026-11-08T10:00:00Z");
    expect(m.assets["linux-x64"].url).toBe("https://site.example/releases/0.3.0/gitnut-linux-x64");
    const cl = await (await s.get("/changelog.json")).json();
    expect(cl.map((r: { version: string }) => r.version)).toEqual(["0.3.0", "0.2.0"]); // newest first, no prereleases
    expect(cl[0].items).toEqual([
      { type: "improved", text: "Faster graph" },
      { type: "improved", text: "Smaller binary" },
      { type: "fixed", text: "Footer" },
    ]);
    // public repo: downloads redirect to GitHub
    const dl = await s.get("/releases/0.2.0/gitnut-linux-x64");
    expect(dl.status).toBe(302);
    expect(dl.headers.get("location")).toBe("https://github.com/o/r/releases/download/v0.2.0/gitnut-linux-x64");
    expect((await s.get("/releases/0.2.0/nope")).status).toBe(404);
  });

  test("R-UPD-1: private repo: files and checksums stream through the site, token never sent to storage", async () => {
    const s = ghSite({ GITNUT_GITHUB_TOKEN: "secret-token" });
    const m = await (await s.get("/manifest.json")).json();
    expect(m.assets["linux-x64"].sha256).toBe("c".repeat(64));
    const dl = await s.get("/releases/0.3.0/gitnut-linux-x64");
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe("BINARY");
    expect(s.seen.filter((x) => x.url.startsWith("https://storage.example")).every((x) => x.auth === null)).toBe(true);
    expect(s.seen.find((x) => x.url.includes("/releases?"))?.auth).toBe("Bearer secret-token");
  });
});
