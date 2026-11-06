import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, normalize } from "node:path";
import { DESKTOP_ASSETS, SHA256SUMS, assetFile, assetUrl, buildManifest, parseSha256Sums, type UpdateManifest } from "@gitnut/commons";
import { assetResponse, fetchReleases, type Release } from "./github";

// The Astro build (`bun run build`): pages plus everything from public/.
const DIST = join(import.meta.dir, "..", "dist");
// The README screenshots (docs/screenshots) double as the site gallery; the Docker image copies them
// into dist/screenshots.
const SHOTS = existsSync(join(DIST, "screenshots")) ? join(DIST, "screenshots") : join(import.meta.dir, "..", "..", "..", "docs", "screenshots");
const PAGES: Record<string, string> = {
  "/": "/index.html",
  "/changelog": "/changelog.html",
  "/changelog/": "/changelog.html",
  "/privacy": "/privacy.html",
  "/privacy/": "/privacy.html",
  "/terms": "/terms.html",
  "/terms/": "/terms.html",
};

/**
 * Site request handler (R-SITE-2). GitHub releases are the single source of truth: with
 * GITNUT_GITHUB_REPO (`owner/repo`) the latest version, its files, SHA256SUMS, notes, the desktop
 * updater feed and /changelog.json all come from the repo's releases, read at start and every
 * GITNUT_GITHUB_REFRESH_MINUTES (default 10). Files are served at <site>/releases/<version>/<file>
 * (a redirect to GitHub, or streamed with GITNUT_GITHUB_TOKEN while the repo is private).
 * Optional: GITNUT_SITE_URL (canonical URL; default from the request) and the donation links
 * GITNUT_SPONSOR_GITHUB / GITNUT_SPONSOR_KOFI / GITNUT_SPONSOR_PAYPAL (served at /site.json).
 */
export function createSite(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) {
  const repo = env.GITNUT_GITHUB_REPO?.trim() || "";
  const token = env.GITNUT_GITHUB_TOKEN?.trim() || undefined;
  let releases: Release[] = [];
  /** Small release files (SHA256SUMS, updater signatures), per "version/file"; cleared on refresh. */
  let texts = new Map<string, Promise<string | null>>();
  const refresh = async () => {
    if (!repo) return;
    try {
      releases = await fetchReleases(repo, token, fetchImpl);
      texts = new Map();
    } catch (e) {
      console.error(`site: ${(e as Error).message}`);
    }
  };
  const ready = refresh();
  if (repo) {
    const every = Number(env.GITNUT_GITHUB_REFRESH_MINUTES || 10) * 60_000;
    // until the first successful read (GitHub down or rate limited at start), retry every minute
    const next = () => setTimeout(tick, releases.length ? every : Math.min(every, 60_000)).unref();
    const tick = async () => {
      await refresh();
      next();
    };
    void ready.then(next);
  } else console.error("site: GITNUT_GITHUB_REPO is not set, no releases to offer");
  // Only http(s) links: the page puts these into hrefs.
  const link = (v?: string) => (/^https?:\/\//i.test(v?.trim() ?? "") ? v!.trim() : undefined);
  // The public URL comes only from GITNUT_SITE_URL, never from Host / X-Forwarded-* headers: it goes
  // into install scripts, the manifest and redirects, which a shared cache could otherwise poison.
  const canonical = env.GITNUT_SITE_URL?.trim().replace(/\/+$/, "") || "https://gitnut.dev";
  const sponsors = { github: link(env.GITNUT_SPONSOR_GITHUB), kofi: link(env.GITNUT_SPONSOR_KOFI), paypal: link(env.GITNUT_SPONSOR_PAYPAL) };

  /** Text of a small file of the latest release (null when missing or unreadable). */
  function releaseText(file: string): Promise<string | null> {
    const latest = releases[0];
    const asset = latest?.assets[file];
    if (!asset) return Promise.resolve(null);
    const key = `${latest.version}/${file}`;
    let p = texts.get(key);
    if (!p) {
      p = assetResponse(asset, token, fetchImpl)
        .then((r) => (r.status === 302 ? fetchImpl(r.headers.get("location")!) : r))
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null);
      texts.set(key, p);
      p.then((v) => v === null && texts.delete(key));
    }
    return p;
  }


  const noRelease = () => Response.json({ error: "no release published yet" }, { status: 503 });

  async function installScript(name: string, req: Request): Promise<Response> {
    const latest = releases[0];
    if (!latest) return noRelease();
    const text = (await Bun.file(join(DIST, name)).text())
      .replaceAll("__GITNUT_SITE_URL__", canonical)
      .replaceAll("__GITNUT_DOWNLOAD_BASE__", `${canonical}/releases`)
      .replaceAll("__GITNUT_VERSION__", latest.version);
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
  }

  return async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    try {
      decodeURIComponent(pathname);
    } catch {
      return new Response("bad request", { status: 400 });
    }
    await ready;
    const latest = releases[0];
    const base = `${canonical}/releases`;

    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/site.json") return Response.json({ sponsors }, { headers: { "cache-control": "no-cache" } });
    if (pathname === "/manifest.json") {
      if (!latest) return noRelease();
      const sums = await releaseText(SHA256SUMS);
      const manifest: UpdateManifest = buildManifest({
        version: latest.version,
        base,
        notes: latest.summary || undefined,
        publishedAt: latest.publishedAt,
        downloadPage: canonical,
        sha256s: sums ? parseSha256Sums(sums) : undefined,
      });
      return Response.json(manifest, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
    }
    // Tauri updater feed of the desktop app: platforms whose update file and signature are released.
    if (pathname === "/desktop/latest.json") {
      if (!latest) return new Response(null, { status: 204 });
      const platforms: Record<string, { signature: string; url: string }> = {};
      for (const a of DESKTOP_ASSETS) {
        if (!a.updater) continue;
        const file = a.updater.file(latest.version);
        const signature = latest.assets[file] ? await releaseText(`${file}.sig`) : null;
        if (signature) platforms[a.updater.target] = { signature: signature.trim(), url: assetUrl(base, latest.version, file) };
      }
      const body = { version: latest.version, notes: latest.items.map((i) => `- ${i.text}`).join("\n"), pub_date: latest.publishedAt, platforms };
      return Response.json(body, { headers: { "cache-control": "public, max-age=60" } });
    }
    if (pathname === "/install.sh" || pathname === "/install.ps1") return installScript(pathname.slice(1), req);
    if (pathname.startsWith("/download/")) {
      if (!latest) return noRelease();
      const file = assetFile(decodeURIComponent(pathname.slice("/download/".length)), latest.version);
      if (!file) return new Response("unknown download", { status: 404 });
      return Response.redirect(assetUrl(base, latest.version, file), 302);
    }
    if (pathname === "/changelog.json") {
      const list = releases.map(({ version, date, title, items }) => ({ version, date, title, items }));
      return Response.json(list, { headers: { "cache-control": "no-cache" } });
    }
    if (pathname.startsWith("/releases/")) {
      const [ver, file, ...rest] = decodeURIComponent(pathname.slice("/releases/".length)).split("/");
      const asset = !rest.length ? releases.find((r) => r.version === ver)?.assets[file] : undefined;
      return asset ? assetResponse(asset, token, fetchImpl) : new Response("not found", { status: 404 });
    }

    // Search engines get the canonical origin, never a forwarded host.
    if (pathname === "/robots.txt") {
      const text = (await Bun.file(join(DIST, "robots.txt")).text()).replaceAll("https://gitnut.dev", canonical);
      return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (pathname === "/sitemap.xml") {
      const lastmod = latest ? `<lastmod>${latest.date}</lastmod>` : "";
      const urls = ["/", "/changelog", "/privacy", "/terms"].map((p) => `  <url><loc>${canonical}${p}</loc>${lastmod}</url>`).join("\n");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
      return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }

    if (pathname === "/screenshots.json") {
      const files = await readdir(SHOTS).catch(() => [] as string[]);
      return Response.json(files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort());
    }

    // Static files (landing page, logo, detect.js, screenshots).
    const rel = normalize(PAGES[pathname] ?? decodeURIComponent(pathname));
    if (rel.includes("..") || rel.includes("\0")) return new Response("not found", { status: 404 });
    const file = Bun.file(rel.startsWith("/screenshots/") ? join(SHOTS, rel.slice("/screenshots/".length)) : join(DIST, rel));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    // Page code revalidates every load so a new site version shows at once; images may be cached.
    const fresh = /\.(html|js|css|svg)$/.test(rel);
    return new Response(file, { headers: { "cache-control": fresh ? "no-cache" : "public, max-age=3600" } });
  };
}

if (import.meta.main) {
  if (!process.env.GITNUT_SITE_URL) console.error("site: GITNUT_SITE_URL is not set, using https://gitnut.dev for links and downloads");
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 7431),
    hostname: process.env.HOST ?? "0.0.0.0",
    fetch: createSite(),
  });
  console.log(`gitnut site on http://${server.hostname}:${server.port}`);
}
