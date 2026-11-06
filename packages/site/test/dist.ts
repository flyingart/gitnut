// Page tests run against the Astro build: build dist/ once per `bun test` run, so they never see a stale copy.
import { join } from "node:path";

export const DIST = join(import.meta.dir, "..", "dist");
/** The tests build with these analytics settings (the real ones live in the Coolify env). */
export const RYBBIT_URL = "https://stats.example";
export const RYBBIT_SITE = "test-site";
export const RYBBIT_SCRIPT = `${RYBBIT_URL}/api/script.js?siteId=${RYBBIT_SITE}`;
if (!process.env.GITNUT_SITE_DIST_BUILT) {
  const env = { ...process.env, GITNUT_RYBBIT_URL: RYBBIT_URL, GITNUT_RYBBIT_SITE_ID: RYBBIT_SITE };
  const r = Bun.spawnSync(["bun", "--bun", "astro", "build"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "pipe", env });
  if (r.exitCode !== 0) throw new Error(`astro build failed:\n${r.stderr}`);
  process.env.GITNUT_SITE_DIST_BUILT = "1";
}
