// Page tests run against the Astro build: build dist/ once per `bun test` run, so they never see a stale copy.
import { join } from "node:path";

export const DIST = join(import.meta.dir, "..", "dist");
if (!process.env.GITNUT_SITE_DIST_BUILT) {
  const r = Bun.spawnSync(["bun", "--bun", "astro", "build"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`astro build failed:\n${r.stderr}`);
  process.env.GITNUT_SITE_DIST_BUILT = "1";
}
