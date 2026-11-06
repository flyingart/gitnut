import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxies /ws and /api to a dev daemon (GITNUT_DEV_DAEMON, default http://127.0.0.1:7421).
const daemon = process.env.GITNUT_DEV_DAEMON ?? "http://127.0.0.1:7421";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    // Extra host names allowed to open the dev server (e.g. a Tailscale name), from GITNUT_DEV_HOST.
    allowedHosts: process.env.GITNUT_DEV_HOST ? [process.env.GITNUT_DEV_HOST] : [],
    proxy: {
      "/api": { target: daemon },
      "/ws": { target: daemon.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html"), examples: resolve(import.meta.dirname, "examples.html") },
    },
  },
});
