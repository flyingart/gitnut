#!/usr/bin/env bun
// Polished screenshots for the README: starts a daemon on the fixture repos (open-source only) and captures the
// web client at 1600×1000, deviceScaleFactor 2, into docs/screenshots/.
//   bun run screenshots [--no-build]
// Env: GITNUT_FIXTURES (default .cache/fixtures): vite (clone of vitejs/vite), git.git (bare clone of
// git/git), the generated acme-web demo repo.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { makeDemoRepo } from "./demo-repo";

const ROOT = resolve(import.meta.dir, "..");
const FIX = process.env.GITNUT_FIXTURES ?? join(ROOT, ".cache", "fixtures");
const OUT = join(ROOT, "docs", "screenshots");
const DIFF_COMMIT = "1b905e562"; // vite: perf(css): index rendered modules once per output for `cssScopeTo`

const sh = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  if (r.exitCode !== 0) throw new Error(`${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
};

function prepareFixtures() {
  makeDemoRepo(FIX);
  // an "agent" worktree of vite with work in progress
  const vite = join(FIX, "vite");
  const wt = join(FIX, "vite-agent-css");
  if (existsSync(vite) && !existsSync(wt)) {
    sh(vite, "git", "worktree", "add", "-q", "-b", "agent/css-scope-cache", wt, "HEAD");
    const f = join(wt, "packages/vite/src/node/plugins/css.ts");
    const src = readFileSync(f, "utf8");
    writeFileSync(f, src.replace(/\n/, "\n// TODO(agent): cache scoped CSS per output chunk\n"));
    writeFileSync(join(wt, "packages/vite/src/node/__tests__/cssScope.spec.ts"), `import { describe, expect, test } from "vitest"\n\ndescribe("cssScopeTo", () => {\n  test("indexes rendered modules once per output", () => {\n    expect(true).toBe(true)\n  })\n})\n`);
  }
}

const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

async function main() {
  prepareFixtures();
  if (!process.argv.includes("--no-build")) sh(join(ROOT, "packages/web"), "bun", "run", "build");
  const home = mkdtempSync(join(tmpdir(), "gitnut-shots-"));
  const env = { ...process.env, GITNUT_HOME: home };
  const cli = (...a: string[]) => {
    const r = Bun.spawnSync(["bun", join(ROOT, "packages/daemon/src/cli.ts"), ...a], { env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`gitnut ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.toString().trim();
  };
  cli("config", "set", "roots", FIX);
  cli("config", "set", "name", "build-box");
  cli("config", "set", "pollIntervalMs", "1000");
  if (existsSync(join(FIX, "git.git"))) cli("repos", "add", join(FIX, "git.git"));
  const token = cli("token");
  const port = await freePort();
  const daemon = Bun.spawn(["bun", join(ROOT, "packages/daemon/src/cli.ts"), "serve", "--port", String(port), "--bind", "localhost"], {
    env: { ...env, GITNUT_WEB_DIR: join(ROOT, "packages/web/dist") },
    stdout: "ignore",
    stderr: "inherit",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await Bun.sleep(200);
  }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shot = async (name: string, path: string, act: (p: Page) => Promise<void>, storage: Record<string, unknown> = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, colorScheme: "dark" });
    await ctx.addInitScript((s) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
    }, storage);
    const page = await ctx.newPage();
    await page.goto(`${base}${path}${path.includes("?") ? "&" : "?"}token=${token}`);
    await page.waitForSelector("[data-repo], .gitnut-login, [data-example]", { timeout: 30_000 });
    await act(page).catch(async (e) => {
      await page.screenshot({ path: join(OUT, `failed-${name}`) });
      throw e;
    });
    await page.mouse.move(1590, 990);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, name) });
    console.log("saved", name);
    await ctx.close();
  };
  const row = (p: Page, subject: string) => p.locator(".gitnut-log-row", { has: p.locator(".gitnut-log-subject-text", { hasText: subject }) }).first();
  const openRepo = async (p: Page, name: string) => {
    await p.locator(`[data-repo="${name}"]`).first().click();
    await p.waitForSelector(".gitnut-log-row .gitnut-log-subject-text:not(.gitnut-skeleton)", { timeout: 60_000 });
    await p.waitForTimeout(500);
  };
  const sizes = { panelSizes: { "log.refs": 220, "log.right": 380, "log.preview": 400, "log.details": 230 } };

  try {
    await shot("log.png", "/", async (p) => {
      await openRepo(p, "git");
      await row(p, "diff: support --check with -L line ranges").click();
      await p.waitForSelector(".gitnut-log-view .gitnut-sbs path.gitnut-connector", { state: "attached" });
      await p.locator('.gitnut-log-view .gitnut-changes-tree [data-path$=".c"]').first().click();
      await p.waitForSelector(".gitnut-log-view .gitnut-sbs path.gitnut-connector", { state: "attached" });
    }, { "gitnut.viewOptions": sizes });

    await shot("diff.png", "/", async (p) => {
      await openRepo(p, "vite");
      await p.fill('input[aria-label="Filter by text"]', DIFF_COMMIT);
      await p.waitForTimeout(1500);
      await p.locator(".gitnut-log-row.gitnut-selected").click();
      await p.keyboard.press("Control+d");
      await p.waitForSelector(".gitnut-full-diff .gitnut-sbs path.gitnut-connector", { state: "attached" });
      await p.locator(".gitnut-full-diff .gitnut-diff").first().press("F7");
    }, { "gitnut.viewOptions": { panelSizes: { full: 300 } } });

    await shot("multi-select.png", "/", async (p) => {
      await openRepo(p, "acme-web");
      await row(p, "auth: session cookie middleware").click();
      await row(p, "Fix redirect loop after login").click({ modifiers: ["Control"] });
      await row(p, "Cache static assets for a year").click({ modifiers: ["Control"] });
      await p.waitForSelector(".gitnut-details-list");
      await p.locator('.gitnut-log-view .gitnut-changes-tree [data-path="src/auth/redirect.ts"]').click();
    }, { "gitnut.viewOptions": sizes });

    await shot("local-changes.png", "/", async (p) => {
      await p.locator(".gitnut-sidebar-entry").click();
      await p.waitForSelector('.gitnut-combined-changes [data-path="src/app.ts"]');
      await p.locator('.gitnut-combined-changes [data-path="src/app.ts"]').click();
      await p.waitForSelector(".gitnut-combined-changes path.gitnut-connector", { state: "attached" });
    }, { "gitnut.viewOptions": { panelSizes: { combined: 360 } } });

    await shot("projects-flat.png", "/", async (p) => {
      await openRepo(p, "git");
    }, { "gitnut.viewOptions": { ...sizes, projectsGrouping: "flat", diffPreview: "off" } });

    await shot("settings.png", "/", async (p) => {
      await openRepo(p, "acme-web");
      await p.getByRole("button", { name: "Settings" }).click();
      await p.waitForSelector(".gitnut-settings .gitnut-section");
    }, { "gitnut.viewOptions": sizes });

    await shot("add-projects.png", "/", async (p) => {
      await p.getByRole("button", { name: "Add projects or a server" }).click();
      await p.getByRole("button", { name: "Add projects…" }).click();
      const dlg = p.getByRole("dialog");
      await dlg.getByLabel("Folder path").fill(FIX);
      await dlg.getByRole("button", { name: "Open" }).click();
      await dlg.getByRole("listitem").first().waitFor();
    }, { "gitnut.viewOptions": sizes });

    await shot("actions.png", "/", async (p) => {
      await openRepo(p, "acme-web");
      await row(p, "Fix redirect loop after login").click();
      await p.waitForSelector(".gitnut-log-view .gitnut-changes-tree [data-path]");
      const box = (await row(p, "Fix redirect loop after login").locator(".gitnut-log-subject-text").boundingBox())!;
      await p.mouse.click(box.x + 60, box.y + box.height / 2, { button: "right" });
      await p.waitForSelector(".gitnut-context-menu");
    }, { "gitnut.viewOptions": sizes });

    await shot("embed-example.png", "/examples.html", async (p) => {
      await p.waitForSelector('[data-example="local-changes"] .gitnut-tree-row');
      await p.waitForSelector('[data-example="commit-graph"] .gitnut-log-row .gitnut-log-subject-text:not(.gitnut-skeleton)');
      await p.locator('[data-example="custom-theme"]').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24));
      await p.frameLocator("iframe").locator(".gitnut-tree-row").first().waitFor();
      await p.waitForTimeout(800);
    });
  } finally {
    await browser.close();
    daemon.kill();
    await daemon.exited;
    rmSync(home, { recursive: true, force: true });
  }
}

await main();
