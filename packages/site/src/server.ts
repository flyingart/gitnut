import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, normalize } from "node:path";
import { SHA256SUMS, assetFile, assetUrl, buildManifest, parseSha256Sums, type UpdateManifest } from "@gitnut/commons";
import { assetResponse, fetchReleases, type Release } from "./github";

const PUBLIC = join(import.meta.dir, "..", "public");
// The README screenshots (docs/screenshots) double as the site gallery; the Docker image copies them
// into public/screenshots.
const SHOTS = existsSync(join(PUBLIC, "screenshots")) ? join(PUBLIC, "screenshots") : join(import.meta.dir, "..", "..", "..", "docs", "screenshots");
const SUMS_TTL_MS = 5 * 60_000;
const PAGES: Record<string, string> = { "/": "/index.html", "/changelog": "/changelog.html", "/changelog/": "/changelog.html" };

/**
 * Site request handler. All configuration comes from `env` (R-SITE-2): GITNUT_LATEST_VERSION,
 * GITNUT_DOWNLOAD_BASE_URL, GITNUT_RELEASE_NOTES, GITNUT_PUBLISHED_AT, GITNUT_SITE_URL, and optional
 * GITNUT_RELEASE_DIR (serve release files at /releases/<version>/<file>) and the optional donation links
 * GITNUT_SPONSOR_GITHUB / GITNUT_SPONSOR_KOFI / GITNUT_SPONSOR_PAYPAL (served at /site.json).
 *
 * GitHub mode: with GITNUT_GITHUB_REPO (`owner/repo`) the latest version, its files, SHA256SUMS, notes and
 * the whole /changelog.json come from the repo's GitHub releases, read at start and every
 * GITNUT_GITHUB_REFRESH_MINUTES (default 10). Files are served at <site>/releases/<version>/<file>
 * (a redirect to GitHub, or streamed with GITNUT_GITHUB_TOKEN while the repo is private).
 */
export function createSite(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch) {
  const repo = env.GITNUT_GITHUB_REPO?.trim() || "";
  const token = env.GITNUT_GITHUB_TOKEN?.trim() || undefined;
  let releases: Release[] = [];
  let version = env.GITNUT_LATEST_VERSION?.trim() || "";
  let base = env.GITNUT_DOWNLOAD_BASE_URL?.trim().replace(/\/+$/, "") || "";
  let notes = env.GITNUT_RELEASE_NOTES;
  let publishedAt = env.GITNUT_PUBLISHED_AT;
  let sums: { at: number; value: Record<string, string> | undefined } | null = null;
  const refresh = async () => {
    try {
      releases = await fetchReleases(repo, token, fetchImpl);
      const latest = releases[0];
      if (latest) {
        version = latest.version;
        notes = latest.summary || notes;
        publishedAt = latest.publishedAt;
        sums = null;
      }
    } catch (e) {
      console.error(`site: ${(e as Error).message}`);
    }
  };
  const ready = repo ? refresh() : Promise.resolve();
  if (repo) {
    const every = Number(env.GITNUT_GITHUB_REFRESH_MINUTES || 10) * 60_000;
    // until the first successful read (GitHub down or rate limited at start), retry every minute
    const tick = async () => {
      await refresh();
      setTimeout(tick, releases.length ? every : Math.min(every, 60_000)).unref();
    };
    void ready.then(() => setTimeout(tick, releases.length ? every : Math.min(every, 60_000)).unref());
  }
  // Only http(s) links: the page puts these into hrefs.
  const link = (v?: string) => (/^https?:\/\//i.test(v?.trim() ?? "") ? v!.trim() : undefined);
  const canonical = env.GITNUT_SITE_URL?.trim().replace(/\/+$/, "") || "https://gitnut.dev";
  const sponsors = { github: link(env.GITNUT_SPONSOR_GITHUB), kofi: link(env.GITNUT_SPONSOR_KOFI), paypal: link(env.GITNUT_SPONSOR_PAYPAL) };

  async function sha256s(): Promise<Record<string, string> | undefined> {
    if (sums && Date.now() - sums.at < SUMS_TTL_MS) return sums.value;
    let value: Record<string, string> | undefined;
    try {
      const asset = releases[0]?.assets[SHA256SUMS];
      const res = asset ? await assetResponse(asset, token, fetchImpl).then((r) => (r.status === 302 ? fetchImpl(r.headers.get("location")!) : r)) : await fetchImpl(assetUrl(base, version, SHA256SUMS), { signal: AbortSignal.timeout(3000) });
      if (res.ok) value = parseSha256Sums(await res.text());
    } catch {}
    sums = { at: Date.now(), value };
    return value;
  }

  function siteUrl(req: Request): string {
    if (env.GITNUT_SITE_URL) return env.GITNUT_SITE_URL.replace(/\/+$/, "");
    const u = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
    return `${proto}://${host}`;
  }

  const notConfigured = () =>
    Response.json(
      { error: "no release configured (set GITNUT_LATEST_VERSION and GITNUT_DOWNLOAD_BASE_URL)" },
      { status: 503 },
    );

  async function installScript(name: string, req: Request): Promise<Response> {
    if (!version || !base) return notConfigured();
    const text = (await Bun.file(join(PUBLIC, name)).text())
      .replaceAll("__GITNUT_SITE_URL__", siteUrl(req))
      .replaceAll("__GITNUT_DOWNLOAD_BASE__", base)
      .replaceAll("__GITNUT_VERSION__", version);
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
  }

  return async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    await ready;
    // GitHub mode serves the files itself, so downloads always go through <site>/releases.
    if (repo && !env.GITNUT_DOWNLOAD_BASE_URL) base = `${siteUrl(req)}/releases`;

    if (pathname === "/healthz") return new Response("ok");
    if (pathname === "/site.json") return Response.json({ sponsors }, { headers: { "cache-control": "no-cache" } });
    if (pathname === "/manifest.json") {
      if (!version || !base) return notConfigured();
      const manifest: UpdateManifest = buildManifest({
        version,
        base,
        notes,
        publishedAt,
        downloadPage: siteUrl(req),
        sha256s: await sha256s(),
      });
      return Response.json(manifest, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
    }
    if (pathname === "/install.sh" || pathname === "/install.ps1") return installScript(pathname.slice(1), req);
    if (pathname.startsWith("/download/")) {
      if (!version || !base) return notConfigured();
      const file = assetFile(decodeURIComponent(pathname.slice("/download/".length)), version);
      if (!file) return new Response("unknown download", { status: 404 });
      return Response.redirect(assetUrl(base, version, file), 302);
    }

    if (repo && pathname === "/changelog.json") {
      const list = releases.map(({ version, date, title, items }) => ({ version, date, title, items }));
      return Response.json(list, { headers: { "cache-control": "no-cache" } });
    }
    if (repo && pathname.startsWith("/releases/")) {
      const [ver, file, ...rest] = decodeURIComponent(pathname.slice("/releases/".length)).split("/");
      const asset = !rest.length ? releases.find((r) => r.version === ver)?.assets[file] : undefined;
      return asset ? assetResponse(asset, token, fetchImpl) : new Response("not found", { status: 404 });
    }

    // Optional: serve release files from a local folder (`GITNUT_RELEASE_DIR/<version>/<file>` at
    // `/releases/<version>/<file>`), so one box can host the site and the downloads.
    if (env.GITNUT_RELEASE_DIR && pathname.startsWith("/releases/")) {
      const [ver, file, ...rest] = decodeURIComponent(pathname.slice("/releases/".length)).split("/");
      if (rest.length || !ver || !file || [ver, file].some((x) => x.startsWith(".") || x.includes("\\") || x.includes("\0")))
        return new Response("not found", { status: 404 });
      const f = Bun.file(join(env.GITNUT_RELEASE_DIR, ver, file));
      if (!(await f.exists())) return new Response("not found", { status: 404 });
      return new Response(f, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=300" } });
    }

    // Search engines get the canonical origin, never a forwarded host.
    if (pathname === "/robots.txt") {
      const text = (await Bun.file(join(PUBLIC, "robots.txt")).text()).replaceAll("https://gitnut.dev", canonical);
      return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (pathname === "/sitemap.xml") {
      const lastmod = /^\d{4}-\d{2}-\d{2}/.test(publishedAt ?? "") ? `<lastmod>${publishedAt!.slice(0, 10)}</lastmod>` : "";
      const urls = ["/", "/changelog"].map((p) => `  <url><loc>${canonical}${p}</loc>${lastmod}</url>`).join("\n");
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
    const file = Bun.file(rel.startsWith("/screenshots/") ? join(SHOTS, rel.slice("/screenshots/".length)) : join(PUBLIC, rel));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    // Page code revalidates every load so a new site version shows at once; images may be cached.
    const fresh = /\.(html|js|css|svg)$/.test(rel);
    return new Response(file, { headers: { "cache-control": fresh ? "no-cache" : "public, max-age=3600" } });
  };
}

if (import.meta.main) {
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 7431),
    hostname: process.env.HOST ?? "0.0.0.0",
    fetch: createSite(),
  });
  console.log(`gitnut site on http://${server.hostname}:${server.port}`);
}
