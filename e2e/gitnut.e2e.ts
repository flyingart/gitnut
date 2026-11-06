import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const dir = process.env.GITNUT_E2E_DIR!;
const token = () => readFileSync(join(dir, "token"), "utf8").trim();
const repo = join(dir, "repos", "acme-web");
const darkMode = join(dir, "repos", "acme-web-dark-mode");

/** Log in through the `?token=` link (sets the cookie), then open `path`. */
async function open(page: Page, path = "/") {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}token=${token()}`);
}

async function openLog(page: Page) {
  await open(page);
  await page.locator('[data-repo="acme-web"]').first().click();
  await expect(page.locator(".gitnut-log-row").first()).toBeVisible();
  await expect(page.locator(".gitnut-log-row .gitnut-log-subject-text", { hasText: "Initial project skeleton" })).toBeVisible();
}

const row = (page: Page, subject: string) => page.locator(".gitnut-log-row", { has: page.locator(".gitnut-log-subject-text", { hasText: subject }) });
const logTree = (page: Page) => page.locator(".gitnut-log-view .gitnut-changes-tree").first();

test("R-DAEMON-5: log in with the access token", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Access token");
  await expect(input).toBeVisible();
  await input.fill("wrong-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("not valid");
  await input.fill(token());
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator('[data-repo="acme-web"]').first()).toBeVisible();
});

test("R-LIST-1: projects grouped by server, or flat", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-server]")).toHaveCount(1);
  await expect(page.locator("[data-server]")).toContainText("e2e-box");
  await expect(page.locator('[data-worktree$="acme-web-dark-mode"]')).toContainText("feature/dark-mode");
  await page.getByRole("button", { name: "Show projects as one list" }).click();
  await expect(page.locator('[data-grouping="flat"]')).toBeVisible();
  await expect(page.locator("[data-server]")).toHaveCount(0);
  await expect(page.locator('[data-repo="acme-web"]')).toBeVisible();
  await page.getByRole("button", { name: "Group projects by server" }).click();
  await expect(page.locator("[data-server]")).toHaveCount(1);
});

test("R-GRAPH-1: the graph shows commits with branch, remote and tag labels", async ({ page }) => {
  await openLog(page);
  for (const ref of ["main", "feature/dark-mode", "origin & feature/checkout", "origin/main", "v1.0.0", "v1.1.0"]) {
    await expect(page.locator(`.gitnut-log-row [data-ref="${ref}"]`).first()).toBeVisible();
  }
  const painted = await page.locator(".gitnut-log-canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(200);
  // branches panel navigates
  await page.locator('.gitnut-refs-row[data-ref="refs/heads/fix/login-redirect"]').click();
  await expect(row(page, "Fix redirect loop after login")).toHaveAttribute("aria-selected", "true");
});

test("R-DIFF-1: a non-adjacent multi-selection shows the combined changes", async ({ page }) => {
  await openLog(page);
  await row(page, "auth: session cookie middleware").click();
  await expect(logTree(page).locator('[data-path="src/auth/session.ts"]')).toBeVisible();
  await row(page, "Cache static assets for a year").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".gitnut-details-subject")).toHaveText("2 commits selected");
  await expect(logTree(page).locator('[data-path="src/static.ts"]')).toBeVisible();
  await expect(logTree(page).locator('[data-path="src/auth/session.ts"]')).toBeVisible();
  // commits in between are not part of the selection
  await expect(logTree(page).locator('[data-path="src/auth/redirect.ts"]')).toHaveCount(0);
  await expect(logTree(page).locator('[data-path="src/router.ts"]')).toHaveCount(0);
  // Shift+click selects the range
  await row(page, "auth: login and logout routes").click({ modifiers: ["Shift"] });
  await expect(logTree(page).locator('[data-path="src/router.ts"]')).toBeVisible();
});

test("R-DIFF-2: changes as a folder tree or a flat list", async ({ page }) => {
  await openLog(page);
  await row(page, "Merge branch 'feature/auth'").click();
  await expect(logTree(page).locator('[data-kind="folder"]').first()).toBeVisible();
  await expect(logTree(page).locator('[data-kind="folder"]', { hasText: "src" })).toContainText("2 files");
  await logTree(page).getByRole("button", { name: "Show as flat list" }).click();
  await expect(logTree(page).locator('[data-kind="folder"]')).toHaveCount(0);
  await expect(logTree(page).locator('[data-path="src/auth/session.ts"]')).toContainText("src/auth");
  await logTree(page).getByRole("button", { name: "Group by folder" }).click();
  await expect(logTree(page).locator('[data-kind="folder"]').first()).toBeVisible();
});

test("R-DIFF-4 R-DIFF-5: side-by-side with connectors, unified, F7 into the next file", async ({ page }) => {
  await openLog(page);
  await row(page, "Graceful shutdown on SIGTERM").click();
  const diff = page.locator(".gitnut-log-view .gitnut-diff").first();
  await expect(diff.locator(".gitnut-sbs")).toBeVisible();
  await expect(diff.locator("path.gitnut-connector").first()).toBeAttached();
  await expect(diff.locator(".gitnut-diff-line").first()).toBeVisible();
  await expect(diff.locator(".cm-content").first()).toContainText("createServer");
  await diff.getByRole("radio", { name: "Unified viewer" }).click();
  await expect(diff.locator(".gitnut-unified")).toBeVisible();
  await expect(diff.locator(".cm-changedLine").first()).toBeVisible();
  await diff.getByRole("radio", { name: "Side-by-side viewer" }).click();
  await expect(diff.locator(".gitnut-sbs")).toBeVisible();

  // merge of feature/auth: two files with one change each; F7 at the last change asks, F7 again opens the next file
  await row(page, "Merge branch 'feature/auth'").click();
  await expect(diff.locator(".gitnut-diff-path")).toContainText("session.ts");
  await expect(diff.getByTestId("diff-count")).toContainText("1 / 1");
  await page.keyboard.press("F7");
  await expect(diff.locator(".gitnut-diff-hint")).toContainText("Press F7 again");
  await page.keyboard.press("F7");
  await expect(diff.locator(".gitnut-diff-path")).toContainText("router.ts");
  await page.keyboard.press("Shift+F7");
  await page.keyboard.press("Shift+F7");
  await expect(diff.locator(".gitnut-diff-path")).toContainText("session.ts");
});

test("R-LOCAL-1: local changes appear live after a file edit", async ({ page }) => {
  await open(page);
  await page.locator(`[data-worktree="${repo}"]`).click();
  const tree = page.locator(".gitnut-local-changes .gitnut-changes-tree");
  await expect(tree.locator('[data-path="src/app.ts"]')).toBeVisible();
  await expect(tree.locator('[data-path="e2e-live.txt"]')).toHaveCount(0);
  writeFileSync(join(repo, "e2e-live.txt"), "written by an agent\n");
  await expect(tree.locator('[data-path="e2e-live.txt"]')).toBeVisible({ timeout: 15_000 });
  await tree.locator('[data-path="e2e-live.txt"]').click();
  await expect(page.locator(".gitnut-local-changes .gitnut-diff .cm-content").last()).toContainText("written by an agent");
});

test("R-LOCAL-3: commit the checked files from the UI", async ({ page }) => {
  await open(page);
  await page.locator(`[data-worktree="${darkMode}"]`).click();
  const lc = page.locator(".gitnut-local-changes");
  await expect(lc.locator('[data-path="src/theme/tokens.ts"]')).toBeVisible();
  await lc.getByLabel("Commit message").fill("Dark mode tokens from the agent");
  await lc.getByRole("button", { name: /Commit 2 files/ }).click();
  await expect(lc.getByText("No local changes")).toBeVisible({ timeout: 15_000 });
  const log = execFileSync("git", ["-C", darkMode, "log", "-1", "--format=%s"]).toString().trim();
  expect(log).toBe("Dark mode tokens from the agent");
});

test("R-SDK-5: the standalone LocalChanges example works without the app", async ({ page }) => {
  await open(page, "/examples.html");
  const ex = page.locator('[data-example="local-changes"]');
  await expect(ex.locator(".gitnut-local-changes")).toBeVisible();
  await expect(ex.locator(".gitnut-tree-row").first()).toBeVisible();
  await expect(page.locator(".gitnut-sidebar")).toHaveCount(0);
  await expect(page.locator('[data-example="commit-graph"] .gitnut-log-row').first()).toBeVisible();
  await expect(page.locator('[data-example="custom-theme"] .gitnut-root')).toHaveClass(/gitnut-scheme-light/);
});

test("R-SDK-2 R-SDK-3: theme override through ?theme=", async ({ page }) => {
  await open(page, `/?theme=${encodeURIComponent(JSON.stringify({ colors: { primary: "#ff0000" }, radius: { md: "3px" } }))}`);
  const root = page.locator(".gitnut-app.gitnut-root");
  await expect(root).toBeVisible();
  expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue("--gitnut-primary").trim())).toBe("#ff0000");
  expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue("--gitnut-radius-md").trim())).toBe("3px");
  await page.goto("/?theme=light");
  await expect(page.locator(".gitnut-app.gitnut-root")).toHaveClass(/gitnut-scheme-light/);
});

test("R-LIST-3: Settings, Appearance: accent and light theme apply at once and are remembered", async ({ page }) => {
  await open(page);
  const root = page.locator(".gitnut-app.gitnut-root");
  const primary = () => root.evaluate((el) => getComputedStyle(el).getPropertyValue("--gitnut-primary").trim());
  expect(await primary()).toBe("#8b5cf6"); // coconut
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Ocean" }).click();
  await dialog.getByRole("radio", { name: "Light" }).click();
  await expect(root).toHaveClass(/gitnut-scheme-light/);
  expect(await primary()).toBe("#3b82f6");
  await page.reload();
  await expect(page.locator(".gitnut-app.gitnut-root")).toHaveClass(/gitnut-scheme-light/);
  await page.evaluate(() => localStorage.removeItem("gitnut.viewOptions"));
});

test("R-SDK-3: embed mode shows one view, transparent, with the postMessage API", async ({ page }) => {
  await open(page, `/?embed=1&view=changes&worktree=${encodeURIComponent(repo)}`);
  await expect(page.locator(".gitnut-local-changes")).toBeVisible();
  await expect(page.locator(".gitnut-sidebar")).toHaveCount(0);
  await expect(page.locator("body")).toHaveClass(/gitnut-embed/);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await page.evaluate(() => window.postMessage({ type: "gitnut:setTheme", theme: "light" }, "*"));
  await expect(page.locator(".gitnut-local-changes.gitnut-root")).toHaveClass(/gitnut-scheme-light/);
});

test("R-LIST-4: tabs are optional; with tabs on, right-click closes others / to the left / to the right", async ({ page }) => {
  await open(page);
  const tabs = page.locator(".gitnut-tab");
  // default: no tabs, the sidebar switches the one view
  await page.locator('[data-repo="acme-web"]').first().click();
  await page.locator('[data-repo="actions-lab"]').first().click();
  await expect(tabs).toHaveCount(0);
  await expect(page.locator(".gitnut-view-title")).toContainText("actions-lab");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog").getByLabel(/Open projects in tabs/).check();
  await page.keyboard.press("Escape");
  await page.locator('[data-repo="acme-web"]').first().click();
  await page.getByRole("button", { name: "All uncommitted changes" }).first().click();
  await expect(tabs).toHaveCount(3);
  await tabs.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close tabs to the right" }).click();
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close others" }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText("acme-web");
  await page.evaluate(() => localStorage.removeItem("gitnut.viewOptions"));
});

test("R-PROD-5: Settings, Servers: add, rename and remove a server", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog").first();
  const list = dialog.getByRole("list", { name: "Servers" });
  await dialog.getByRole("button", { name: "Add server" }).click();
  const add = page.getByRole("dialog", { name: "Add server" });
  const port = new URL(page.url()).port;
  await add.getByPlaceholder(/my-box/).fill(`localhost:${port}`);
  await add.getByPlaceholder(/gitnut token/).fill(token());
  await add.getByRole("button", { name: "Add server" }).click();
  const row = list.locator(`[data-server-row="http://localhost:${port}"]`);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /^Edit/ }).click();
  await list.getByLabel("Name").fill("second box");
  await list.getByRole("button", { name: "Save" }).click();
  await expect(list).toContainText("second box");
  await expect(page.locator("[data-server]")).toContainText(["second box"]);
  page.once("dialog", (d) => void d.accept());
  await list.locator(`[data-server-row="http://localhost:${port}"]`).getByRole("button", { name: /^Remove/ }).click();
  await expect(list.locator(`[data-server-row="http://localhost:${port}"]`)).toHaveCount(0);
  await expect(list.getByRole("listitem")).toHaveCount(1);
});

// Last: rotating the token logs out other sessions (the file keeps the new token for reruns of this worker).
test("R-DAEMON-6 R-DAEMON-5: settings screen saves settings and rotates the token", async ({ page, browser }) => {
  const old = token();
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/./).first().fill("e2e-renamed");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("status").last()).toContainText("Saved");
  await expect(page.locator("[data-server]")).toContainText("e2e-renamed");

  page.once("dialog", (d) => void d.accept());
  await dialog.getByRole("button", { name: "Rotate token" }).click();
  const shown = dialog.getByTestId("new-token");
  await expect(shown).toBeVisible();
  const fresh = (await shown.textContent())!.trim();
  expect(fresh).not.toBe(old);
  writeFileSync(join(dir, "token"), fresh);
  // this client logged in again with the new token by itself
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-repo="acme-web"]').first()).toBeVisible();
  await expect(page.locator(".gitnut-status-dot.gitnut-state-open").first()).toBeVisible();
  // the old token no longer works
  const other = await browser.newPage();
  await other.goto(`/?token=${old}`);
  await expect(other.getByLabel("Access token")).toBeVisible();
  await other.close();
});

test("R-DAEMON-7: add single projects or watch a whole folder from the UI", async ({ page }) => {
  const extra = join(dir, "extra");
  await open(page);
  await expect(page.locator('[data-repo="acme-web"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Add projects or a server" }).click();
  await page.getByRole("button", { name: "Add projects…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Folder path").fill(extra);
  await dlg.getByRole("button", { name: "Open" }).click();
  await expect(dlg.getByRole("listbox", { name: "Folders" })).toContainText("lib-two");

  await dlg.getByLabel("lib-one").check();
  await dlg.getByRole("button", { name: "Add project" }).click();
  await expect(page.locator('[data-repo="lib-one"]')).toBeVisible();
  await expect(page.locator('[data-repo="lib-two"]')).toHaveCount(0);
  await expect(dlg.getByLabel("lib-one")).toBeDisabled();

  await dlg.getByRole("button", { name: "Watch whole folder" }).click();
  await expect(page.locator('[data-repo="lib-two"]')).toBeVisible();
  await dlg.getByRole("button", { name: "Stop watching this folder" }).click();
  await expect(page.locator('[data-repo="lib-two"]')).toHaveCount(0);
  await dlg.getByRole("button", { name: "Done" }).click();

  await page.locator('[data-repo="lib-one"]').hover();
  await page.getByRole("button", { name: "Remove lib-one from the list" }).click();
  await expect(page.locator('[data-repo="lib-one"]')).toHaveCount(0);
});

// ---- git actions (R-ACT) on repos/actions-lab -------------------------------------------------

const lab = join(dir, "repos", "actions-lab");
const labGit = (...args: string[]) => execFileSync("git", ["-C", lab, ...args]).toString().trim();
const toast = (page: Page, kind: "success" | "error", text: string | RegExp) => page.locator(`.gitnut-toast-${kind}`, { hasText: text });

async function openLab(page: Page) {
  await open(page);
  await page.locator('[data-repo="actions-lab"]').first().click();
  await expect(row(page, "lab: second")).toBeVisible();
}

test("R-ACT-1: Fetch in the log toolbar shows a success toast", async ({ page }) => {
  await openLog(page);
  await page.locator(".gitnut-log-view").getByRole("button", { name: "Fetch", exact: true }).click();
  await expect(toast(page, "success", "Fetched")).toBeVisible();
});

test("R-ACT-2: right-click a commit, New branch…, and the label appears in the graph", async ({ page }) => {
  await openLab(page);
  await row(page, "lab: second").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Cherry-pick" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "New branch…" }).click();
  await expect(menu).toHaveCount(0);
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Branch name").fill("bad name");
  await expect(dlg.getByText("No spaces")).toBeVisible();
  await dlg.getByLabel("Branch name").fill("e2e/from-menu");
  await expect(dlg.getByLabel("git command")).toContainText("git branch e2e/from-menu");
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(row(page, "lab: second").locator('[data-ref="e2e/from-menu"]')).toBeVisible();
  await expect(toast(page, "success", "Created branch e2e/from-menu")).toBeVisible();
  expect(labGit("rev-parse", "e2e/from-menu")).toBe(labGit("rev-parse", "main"));
});

test("R-ACT-3: right-click a branch in the branches panel and check it out", async ({ page }) => {
  await openLab(page);
  const refs = page.locator(".gitnut-branches");
  await refs.locator('[data-ref="refs/heads/topic"]').click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Checkout", exact: true }).click();
  await expect(toast(page, "success", "Checked out topic")).toBeVisible();
  expect(labGit("branch", "--show-current")).toBe("topic");
  // the graph label of main gets the same menu (keyboard: Escape closes it)
  await row(page, "lab: second").locator('[data-ref="main"]').click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await refs.locator('[data-ref="refs/heads/main"]').click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Checkout", exact: true }).click();
  await expect(toast(page, "success", "Checked out main")).toBeVisible();
  expect(labGit("branch", "--show-current")).toBe("main");
});

test("R-ACT-4: discard a file from local changes after confirming", async ({ page }) => {
  await open(page);
  await page.locator(`[data-worktree="${lab}"]`).click();
  const lc = page.locator(".gitnut-local-changes");
  await lc.locator('[data-path="notes.txt"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Discard changes…" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("actions-lab / main");
  await expect(dlg.getByLabel("git command")).toContainText("git restore --source=HEAD --staged --worktree -- notes.txt");
  await dlg.getByRole("button", { name: "Discard" }).click();
  await expect(lc.locator('[data-path="notes.txt"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(lc.locator('[data-path="scratch.txt"]')).toBeVisible();
  expect(readFileSync(join(lab, "notes.txt"), "utf8")).toBe("notes\n");
});

test("R-ACT-5: a conflicting merge shows the conflict toast and leaves the worktree clean", async ({ page }) => {
  await openLab(page);
  const before = labGit("rev-parse", "HEAD");
  await page.locator('.gitnut-branches [data-ref="refs/heads/clash"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Merge 'clash' into 'main'" }).click();
  const t = toast(page, "error", "hit conflicts");
  await expect(t).toBeVisible();
  await expect(t).toContainText("file.txt");
  expect(labGit("rev-parse", "HEAD")).toBe(before);
  expect(labGit("diff", "--name-only", "--diff-filter=U")).toBe("");
  expect(labGit("status", "--porcelain", "--untracked-files=no")).toBe("");
});
