import { defineConfig } from "astro/config";

// Dev (`bun run dev` at the root): the Bun server (server/server.ts) answers the dynamic routes on
// GITNUT_SITE_API; astro dev serves the pages with live reload and proxies the rest to it.
const api = process.env.GITNUT_SITE_API ?? "http://127.0.0.1:7432";
const dynamic = ["/manifest.json", "/desktop/", "/install.sh", "/install.ps1", "/download/", "/releases/", "/changelog.json", "/site.json", "/screenshots", "/sitemap.xml", "/robots.txt", "/healthz"];

// Static pages only; in production server/server.ts serves dist/ plus the dynamic routes (R-SITE-2).
export default defineConfig({
  site: "https://gitnut.dev",
  output: "static",
  // dist/changelog.html etc., the paths the Bun server maps clean URLs to.
  build: { format: "file" },
  // Keep the hand-written markup and text as is: whitespace, straight quotes.
  compressHTML: false,
  markdown: { smartypants: false },
  devToolbar: { enabled: false },
  vite: {
    server: {
      // Extra host names allowed to open the dev server (e.g. a Tailscale name), from GITNUT_DEV_HOST.
      allowedHosts: process.env.GITNUT_DEV_HOST ? [process.env.GITNUT_DEV_HOST] : [],
      proxy: Object.fromEntries(dynamic.map((p) => [p, { target: api }])),
    },
  },
});
