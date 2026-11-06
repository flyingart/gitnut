import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// One daemon on a free port with temp repos (see e2e/server.ts). Workers inherit these env vars.
if (!process.env.GITNUT_E2E_DIR) {
  process.env.GITNUT_E2E_DIR = mkdtempSync(join(tmpdir(), "gitnut-e2e-"));
  process.env.GITNUT_E2E_PORT = execFileSync(process.execPath, ["-e", "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"]).toString().trim();
}
const port = Number(process.env.GITNUT_E2E_PORT);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts", // not *.spec.ts: bun test would pick those up
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: {
    command: "bun run --cwd packages/web build && bun e2e/server.ts",
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
