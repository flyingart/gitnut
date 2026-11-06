// Playwright webServer: temp GITNUT_HOME + temp git repos (demo repo with worktrees), then a daemon serving
// packages/web/dist. Env: GITNUT_E2E_DIR (temp dir, created by playwright.config.ts), GITNUT_E2E_PORT.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeDemoRepo } from "../scripts/demo-repo";

const dir = process.env.GITNUT_E2E_DIR!;
const port = process.env.GITNUT_E2E_PORT!;
const root = resolve(import.meta.dir, "..");
const home = join(dir, "home");
const repos = join(dir, "repos");
mkdirSync(home, { recursive: true });
mkdirSync(repos, { recursive: true });
writeFileSync(join(dir, "gitconfig"), "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[user]\n\tname = E2E Agent\n\temail = e2e@example.com\n");
Object.assign(process.env, { GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GITNUT_HOME: home });
makeDemoRepo(repos);

// actions-lab: a small repo the git-action tests may change (branches topic / clash, local edits).
const lab = join(repos, "actions-lab");
mkdirSync(lab, { recursive: true });
const lg = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: lab, env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};
const labCommit = (msg: string, files: Record<string, string>) => {
  for (const [f, c] of Object.entries(files)) writeFileSync(join(lab, f), c);
  lg("add", "-A");
  lg("commit", "-q", "-m", msg);
};
lg("init", "-q", "-b", "main");
labCommit("lab: initial", { "file.txt": "base\n", "notes.txt": "notes\n" });
lg("checkout", "-q", "-b", "topic");
labCommit("lab: topic work", { "topic.txt": "topic\n" });
lg("checkout", "-q", "-b", "clash", "main");
labCommit("lab: clash edit", { "file.txt": "clash\n" });
lg("checkout", "-q", "main");
labCommit("lab: second", { "file.txt": "main\n" });
writeFileSync(join(lab, "notes.txt"), "notes\nedited by an agent\n");
writeFileSync(join(lab, "scratch.txt"), "untracked scratch\n");

const cli = (...args: string[]) => {
  const r = Bun.spawnSync(["bun", join(root, "packages/daemon/src/cli.ts"), ...args], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`gitnut ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
};
cli("config", "set", "roots", repos);
cli("config", "set", "pollIntervalMs", "400");
cli("config", "set", "name", "e2e-box");
cli("config", "set", "auth.enabled", "true"); // shipped default is off; the e2e suite covers the login flow

// Not watched: picked one by one / watched from the "Add projects" dialog.
for (const name of ["lib-one", "lib-two"]) {
  const r = join(dir, "extra", name);
  mkdirSync(r, { recursive: true });
  writeFileSync(join(r, "README.md"), `# ${name}\n`);
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"]]) Bun.spawnSync(["git", ...args], { cwd: r, env: process.env });
}
writeFileSync(join(dir, "token"), cli("token"));

const daemon = Bun.spawn(["bun", join(root, "packages/daemon/src/cli.ts"), "serve", "--port", port, "--bind", "localhost"], {
  env: { ...process.env, GITNUT_WEB_DIR: join(root, "packages/web/dist") },
  stdout: "inherit",
  stderr: "inherit",
});
const stop = () => {
  daemon.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await daemon.exited;
