import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createSite } from "../server/server";
import { DIST, RYBBIT_SCRIPT, RYBBIT_URL } from "./dist";

const SUMS = `${"a".repeat(64)}  gitnut-linux-x64\n${"b".repeat(64)}  GitNut-1.4.0-darwin-arm64.dmg\n`;
const FILES = [
  "gitnut-linux-x64",
  "gitnut-darwin-arm64",
  "gitnut-windows-x64.exe",
  "GitNut-1.4.0-darwin-arm64.dmg",
  "GitNut-1.4.0-darwin-arm64.app.tar.gz",
  "GitNut-1.4.0-darwin-arm64.app.tar.gz.sig",
  "GitNut-1.4.0-windows-x64-setup.exe",
  "GitNut-1.4.0-windows-x64-setup.exe.sig",
  "GitNut-1.4.0-linux-x64.deb",
  "SHA256SUMS",
];
const RELEASE = {
  tag_name: "v1.4.0",
  name: "GitNut 1.4.0",
  body: "### New\n- Faster graph\n### Fixed\n- Footer",
  draft: false,
  prerelease: false,
  published_at: "2026-11-06T10:00:00Z",
  assets: FILES.map((f) => ({ name: f, url: `https://api.github.com/assets/${f}`, browser_download_url: `https://github.com/o/r/releases/download/v1.4.0/${f}` })),
};
const ENV = { GITNUT_GITHUB_REPO: "o/r", GITNUT_SITE_URL: "https://gitnut.example.com" };

/** Site against a fake GitHub with one release (or none). */
function site(env: Record<string, string> = ENV, release: typeof RELEASE | null = RELEASE) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    seen.push(u);
    if (u.includes("/releases?")) return Response.json(release ? [release] : []);
    if (u.endsWith("/SHA256SUMS")) return new Response(SUMS);
    if (u.endsWith(".sig")) return new Response(`SIG-${u.split("/").pop()}\n`);
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  const handle = createSite(env, fetchImpl);
  return { seen, get: (path: string) => handle(new Request(`http://site.local${path}`)) };
}

describe("site", () => {
  test("R-UPD-1: /manifest.json comes from the latest GitHub release, with sha256 from SHA256SUMS", async () => {
    const s = site();
    const res = await s.get("/manifest.json");
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.version).toBe("1.4.0");
    expect(m.notes).toBe("Faster graph");
    expect(m.publishedAt).toBe("2026-11-06T10:00:00Z");
    expect(m.downloadPage).toBe("https://gitnut.example.com");
    expect(m.assets["linux-x64"]).toEqual({ url: "https://gitnut.example.com/releases/1.4.0/gitnut-linux-x64", sha256: "a".repeat(64) });
    expect(m.assets["windows-x64"].url).toBe("https://gitnut.example.com/releases/1.4.0/gitnut-windows-x64.exe");
    expect(m.assets["windows-x64"].sha256).toBeUndefined();
    expect(m.assets["desktop-darwin-arm64"].sha256).toBe("b".repeat(64));
    const sumsFetches = () => s.seen.filter((u) => u.endsWith("/SHA256SUMS")).length;
    expect(sumsFetches()).toBe(1);
    await s.get("/manifest.json");
    expect(sumsFetches()).toBe(1); // cached
  });

  test("R-UPD-1: no release yet: manifest, installers and downloads answer 503, updater feed 204", async () => {
    for (const s of [site(ENV, null), site({})]) {
      expect((await s.get("/manifest.json")).status).toBe(503);
      expect((await s.get("/install.sh")).status).toBe(503);
      expect((await s.get("/download/linux-x64")).status).toBe(503);
      expect((await s.get("/desktop/latest.json")).status).toBe(204);
    }
  });

  test("R-UPD-5: /desktop/latest.json is the Tauri updater feed of the released platforms", async () => {
    const res = await site().get("/desktop/latest.json");
    expect(res.status).toBe(200);
    const feed = await res.json();
    expect(feed).toMatchObject({ version: "1.4.0", pub_date: "2026-11-06T10:00:00Z", notes: "- Faster graph\n- Footer" });
    expect(feed.platforms).toEqual({
      "darwin-aarch64": { signature: "SIG-GitNut-1.4.0-darwin-arm64.app.tar.gz.sig", url: "https://gitnut.example.com/releases/1.4.0/GitNut-1.4.0-darwin-arm64.app.tar.gz" },
      "windows-x86_64": { signature: "SIG-GitNut-1.4.0-windows-x64-setup.exe.sig", url: "https://gitnut.example.com/releases/1.4.0/GitNut-1.4.0-windows-x64-setup.exe" },
    }); // no Intel Mac / AppImage files in this release: left out
  });

  test("R-SITE-2: /download/<key> redirects to the release file", async () => {
    const s = site();
    let res = await s.get("/download/darwin-arm64");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://gitnut.example.com/releases/1.4.0/gitnut-darwin-arm64");
    res = await s.get("/download/desktop-windows-x64");
    expect(res.headers.get("location")).toBe("https://gitnut.example.com/releases/1.4.0/GitNut-1.4.0-windows-x64-setup.exe");
    res = await s.get("/download/desktop-linux-x64-deb");
    expect(res.headers.get("location")).toEndWith("/GitNut-1.4.0-linux-x64.deb");
    expect((await s.get("/download/solaris-sparc")).status).toBe(404);
  });

  test("R-UPD-4: install scripts are templated with site URL, download base and version", async () => {
    const s = site();
    const sh = await (await s.get("/install.sh")).text();
    expect(sh).toContain('BASE="https://gitnut.example.com/releases"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
    expect(sh).toContain('VERSION="${GITNUT_VERSION:-1.4.0}"');
    expect(sh).toContain("https://gitnut.example.com/install.ps1");
    expect(sh).not.toContain("__GITNUT_");
    const ps = await (await s.get("/install.ps1")).text();
    expect(ps).toContain("$Base = 'https://gitnut.example.com/releases'");
    expect(ps).toContain("'1.4.0'");
    expect(ps).toContain("Get-FileHash");
    expect(ps).not.toContain("__GITNUT_");
  });

  test("R-SITE-3: /robots.txt allows all and points to the sitemap on GITNUT_SITE_URL", async () => {
    const res = await site().get("/robots.txt");
    expect(res.headers.get("content-type")).toStartWith("text/plain");
    const text = await res.text();
    expect(text).toContain("User-agent: *\nAllow: /");
    expect(text).toContain("Sitemap: https://gitnut.example.com/sitemap.xml");
    expect(await (await site({}).get("/robots.txt")).text()).toContain("Sitemap: https://gitnut.dev/sitemap.xml");
  });

  test("R-SITE-3: /sitemap.xml lists the pages with the release date", async () => {
    const res = await site().get("/sitemap.xml");
    expect(res.headers.get("content-type")).toStartWith("application/xml");
    const xml = await res.text();
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toMatch(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">[\s\S]*<\/urlset>\n$/);
    const locs = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>2026-11-06<\/lastmod><\/url>/g)].map((m) => m[1]);
    expect(locs).toEqual(["/", "/changelog", "/privacy", "/terms"].map((p) => `https://gitnut.example.com${p}`));
    // no release: no lastmod, default origin
    expect(await (await site({}).get("/sitemap.xml")).text()).toContain("<url><loc>https://gitnut.dev/changelog</loc></url>");
  });

  test("R-SITE-3: pages carry canonical, Open Graph, Twitter and JSON-LD tags", async () => {
    const html = await (await site().get("/")).text();
    for (const tag of [
      '<link rel="canonical" href="https://gitnut.dev/">',
      '<meta property="og:title"',
      '<meta property="og:description"',
      '<meta property="og:url" content="https://gitnut.dev/">',
      '<meta property="og:image" content="https://gitnut.dev/og.png">',
      '<meta property="og:image:width" content="1200">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<link rel="manifest" href="/site.webmanifest">',
    ])
      expect(html).toContain(tag);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(ld).toMatchObject({ "@type": "SoftwareApplication", name: "GitNut", applicationCategory: "DeveloperApplication" });
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(await (await site().get("/changelog")).text()).toContain('<link rel="canonical" href="https://gitnut.dev/changelog">');
    const og = await site().get("/og.png");
    expect(og.headers.get("content-type")).toBe("image/png");
    expect((await og.arrayBuffer()).byteLength).toBeLessThan(400_000);
  });

  test("R-SITE-1: /privacy and /terms serve their pages, linked from the footer", async () => {
    const s = site();
    for (const [page, h1] of [["privacy", "Privacy policy"], ["terms", "Terms of use"]]) {
      for (const path of [`/${page}`, `/${page}/`]) {
        const res = await s.get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        const html = await res.text();
        expect(html).toContain(`<h1>${h1}</h1>`);
        expect(html).toContain(`<link rel="canonical" href="https://gitnut.dev/${page}">`);
      }
    }
    for (const path of ["/", "/changelog", "/privacy", "/terms"]) {
      const html = await (await s.get(path)).text();
      expect(html).toContain('<a href="/privacy">Privacy</a>');
      expect(html).toContain('<a href="/terms">Terms</a>');
    }
  });

  test("R-SITE-1: every HTML page loads the cookieless Rybbit script exactly once", async () => {
    const pages = (await readdir(DIST)).filter((f) => f.endsWith(".html"));
    expect(pages).toEqual(expect.arrayContaining(["index.html", "changelog.html", "privacy.html", "terms.html"]));
    for (const page of pages) {
      const html = await Bun.file(join(DIST, page)).text();
      const head = html.slice(0, html.indexOf("</head>"));
      expect({ page, count: html.split(RYBBIT_SCRIPT).length - 1 }).toEqual({ page, count: 1 });
      expect(head).toContain(`<script src="${RYBBIT_SCRIPT}" defer></script>`);
    }
  });

  test("R-SITE-1: every page comes from the shared layout: one Rybbit script, one canonical, the footer links", async () => {
    const s = site();
    for (const path of ["/", "/changelog", "/privacy", "/terms"]) {
      const html = await (await s.get(path)).text();
      const count = (needle: string) => html.split(needle).length - 1;
      expect({ path, rybbit: count(`src="${RYBBIT_URL}/api/script.js`), canonical: count('rel="canonical"'), footer: count('<footer class="site-footer">') })
        .toEqual({ path, rybbit: 1, canonical: 1, footer: 1 });
      expect(html).toContain(`<link rel="canonical" href="https://gitnut.dev${path}">`);
      const footer = html.slice(html.indexOf('<footer class="site-footer">'));
      for (const href of ["/#download", "/changelog", "/manifest.json", "/#support", "https://github.com/flyingart/gitnut/issues", "https://github.com/flyingart/gitnut#readme", "https://github.com/flyingart/gitnut/releases", "/privacy", "/terms"])
        expect(footer).toContain(`href="${href}"`);
    }
  });

  test("R-SITE-2: forwarded host headers never change the public URL (cache poisoning)", async () => {
    const h = createSite({ GITNUT_GITHUB_REPO: "o/r", GITNUT_SITE_URL: "https://gitnut.example.com" }, (async () => Response.json([RELEASE])) as unknown as typeof fetch);
    const res = await h(new Request("http://10.0.0.5:7431/install.sh", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example", host: "evil.example" } }));
    const sh = await res.text();
    expect(sh).toContain("https://gitnut.example.com/install.ps1");
    expect(sh).not.toContain("evil.example");
    expect((await h(new Request("http://site/%E0%A4%A"))).status).toBe(400);
  });

  test("R-SITE-1: landing page, static files and healthz", async () => {
    const s = site();
    const html = await (await s.get("/")).text();
    expect(html).toContain('src="/app.js"');
    expect((await s.get("/detect.js")).status).toBe(200);
    expect((await s.get("/logo.svg")).status).toBe(200);
    expect(await (await s.get("/healthz")).text()).toBe("ok");
    expect(Array.isArray(await (await s.get("/screenshots.json")).json())).toBe(true);
    expect((await s.get("/../server/server.ts")).status).toBe(404);
    expect((await s.get("/%2e%2e/server/server.ts")).status).toBe(404);
  });

  test("R-SITE-1: /changelog serves the page; changelog.json comes from the releases", async () => {
    const s = site();
    for (const path of ["/changelog", "/changelog/"]) {
      const res = await s.get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain('id="releases"');
    }
    expect(await (await s.get("/changelog.json")).json()).toEqual([
      { version: "1.4.0", date: "2026-11-06", title: "GitNut 1.4.0", items: [{ type: "new", text: "Faster graph" }, { type: "fixed", text: "Footer" }] },
    ]);
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

describe("download statistics (Rybbit)", () => {
  test("R-SITE-4: release files and install scripts become server-side events with the visitor's IP; checksums and signatures don't", async () => {
    const events: { auth: string | null; body: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "https://stats.example/api/track") {
        events.push({ auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
        return Response.json({ success: true });
      }
      if (u.includes("/releases?")) return Response.json([RELEASE]);
      return new Response("x");
    }) as unknown as typeof fetch;
    const env = { ...ENV, GITNUT_RYBBIT_URL: "https://stats.example/", GITNUT_RYBBIT_SITE_ID: "s1", GITNUT_RYBBIT_API_KEY: "k" };
    const handle = createSite(env, fetchImpl);
    const get = (path: string, headers: Record<string, string> = {}) => handle(new Request(`http://site.local${path}`, { headers }), "10.0.0.1");
    await get("/releases/1.4.0/GitNut-1.4.0-darwin-arm64.dmg", { "user-agent": "Mozilla/5.0", "cf-connecting-ip": "203.0.113.7" });
    await get("/releases/1.4.0/gitnut-linux-x64", { "user-agent": "curl/8.5.0" });
    await get("/releases/1.4.0/GitNut-1.4.0-darwin-arm64.app.tar.gz", { "user-agent": "tauri-updater" });
    await get("/releases/1.4.0/SHA256SUMS");
    await get("/releases/1.4.0/GitNut-1.4.0-windows-x64-setup.exe.sig");
    await get("/install.sh", { "user-agent": "curl/8.5.0" });
    await Bun.sleep(10);
    expect(events.every((e) => e.auth === "Bearer k")).toBe(true);
    expect(events.map((e) => [e.body.event_name, JSON.parse(e.body.properties)])).toEqual([
      ["file_download", { file: "GitNut-1.4.0-darwin-arm64.dmg", version: "1.4.0", platform: "desktop-darwin-arm64", source: "browser" }],
      ["file_download", { file: "gitnut-linux-x64", version: "1.4.0", platform: "linux-x64", source: "cli" }],
      ["file_download", { file: "GitNut-1.4.0-darwin-arm64.app.tar.gz", version: "1.4.0", platform: "desktop-darwin-arm64-update", source: "desktop-app" }],
      ["install_script", { script: "install.sh", version: "1.4.0", source: "cli" }],
    ]);
    expect(events[0].body).toMatchObject({ site_id: "s1", type: "custom_event", hostname: "gitnut.example.com", ip_address: "203.0.113.7", user_agent: "Mozilla/5.0" });
    expect(events[1].body.ip_address).toBe("10.0.0.1"); // no proxy header: the socket address
  });

  test("R-SITE-4: no Rybbit settings, no events", async () => {
    const calls: string[] = [];
    const handle = createSite(ENV, (async (url: string) => (calls.push(String(url)), String(url).includes("/releases?") ? Response.json([RELEASE]) : new Response("x"))) as unknown as typeof fetch);
    await handle(new Request("http://site.local/releases/1.4.0/gitnut-linux-x64"));
    expect(calls.some((u) => u.includes("/api/track"))).toBe(false);
  });
});
