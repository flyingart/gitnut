import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventName, Events, Settings } from "@gitnut/commons";
import { Daemon, type Overrides } from "../src/server";
import { loadConfig, saveConfig } from "../src/config";

// Isolate git from the user's config; fixed identity for commits made by tests and the daemon.
const gitHome = mkdtempSync(join(tmpdir(), "gitnut-gitcfg-"));
writeFileSync(join(gitHome, "gitconfig"), "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: join(gitHome, "gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada Agent",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_COMMITTER_NAME: "Ada Agent",
  GIT_COMMITTER_EMAIL: "ada@example.com",
});

export const tmp = (prefix = "gitnut-test-") => mkdtempSync(join(tmpdir(), prefix));

let clock = 1_700_000_000;
/** Run git synchronously; every commit gets a strictly later date so order is deterministic. */
export function g(cwd: string, ...args: string[]): string {
  clock += 60;
  const date = `@${clock} +0000`;
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

export function write(dir: string, file: string, content: string | Uint8Array) {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), content);
}

export function commit(dir: string, msg: string, files: Record<string, string>) {
  for (const [f, c] of Object.entries(files)) write(dir, f, c);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", msg);
  return g(dir, "rev-parse", "HEAD");
}

export interface Fixture {
  base: string;
  root: string;
  repo: string;
  remote: string;
  worktree: string;
  hashes: Record<string, string>;
}

/**
 * roots/alpha: main with a merged feature branch, annotated tag, a rename, an `origin`
 * bare remote; plus a linked worktree outside the root on branch `feat2`.
 */
export function makeFixture(): Fixture {
  const base = tmp();
  const root = join(base, "roots");
  const repo = join(root, "alpha");
  const remote = join(base, "remote.git");
  const worktree = join(base, "wt", "alpha-feat2");
  mkdirSync(repo, { recursive: true });
  g(repo, "init", "-q", "-b", "main");
  const h: Record<string, string> = {};
  h.c1 = commit(repo, "initial", { "a.txt": "one\n", "src/lib.ts": "export const x = 1;\n" });
  g(repo, "checkout", "-q", "-b", "feature");
  h.f1 = commit(repo, "feature work", { "feature.txt": "f\n" });
  g(repo, "checkout", "-q", "main");
  h.c2 = commit(repo, "main work", { "a.txt": "one\ntwo\n" });
  g(repo, "merge", "-q", "--no-ff", "-m", "Merge feature", "feature");
  h.merge = g(repo, "rev-parse", "HEAD");
  g(repo, "tag", "-a", "v1.0", "-m", "release");
  g(repo, "mv", "a.txt", "b.txt");
  g(repo, "commit", "-q", "-m", "rename a to b");
  h.rename = g(repo, "rev-parse", "HEAD");
  h.c3 = commit(repo, "edit b", { "b.txt": "one\ntwo\nthree\n" });
  g(base, "init", "-q", "--bare", remote);
  g(repo, "remote", "add", "origin", remote);
  g(repo, "push", "-q", "-u", "origin", "main");
  mkdirSync(join(base, "wt"), { recursive: true });
  g(repo, "worktree", "add", "-q", "-b", "feat2", worktree);
  return { base, root, repo, remote, worktree, hashes: h };
}

export async function startDaemon(settings: Partial<Settings> = {}, overrides: Overrides = {}, opts: { restart?: () => void } = {}) {
  const home = tmp("gitnut-home-");
  const cfg = loadConfig(home);
  // Auth on unless a test says otherwise, so the auth paths stay covered (the shipped default is off).
  cfg.settings = { ...cfg.settings, port: 0, pollIntervalMs: 250, auth: { ...cfg.settings.auth, enabled: true }, update: { manifestUrl: "", autoCheck: false }, ...settings };
  saveConfig(home, cfg);
  const d = new Daemon({ home, overrides, log: () => {}, restart: opts.restart });
  await d.start();
  return { d, home, token: cfg.settings.auth.token, url: d.url, wsUrl: d.url.replace("http", "ws") + "/ws" };
}

export class Client {
  events: { event: EventName; data: any }[] = [];
  private pending = new Map<number, (m: any) => void>();
  private waiters: (() => void)[] = [];
  private seq = 0;
  closed: Promise<{ code: number }>;

  constructor(readonly ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.event) {
        this.events.push(m);
        for (const w of this.waiters.splice(0)) w();
      } else this.pending.get(m.id)?.(m);
    };
    this.closed = new Promise((r) => ws.addEventListener("close", (e) => r({ code: (e as CloseEvent).code })));
  }

  static connect(url: string, init?: { protocols?: string[]; headers?: Record<string, string> }): Promise<Client> {
    const ws = new WebSocket(url, init as any);
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(new Client(ws));
      ws.onerror = () => reject(new Error("ws error"));
      ws.onclose = (e) => reject(new Error(`closed ${e.code}`));
    });
  }

  /** Raw response: {result} or {error}. */
  send(method: string, params?: unknown): Promise<any> {
    const id = ++this.seq;
    return new Promise((r) => {
      this.pending.set(id, r);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async call<T = any>(method: string, params?: unknown): Promise<T> {
    const m = await this.send(method, params);
    if (m.error) throw new Error(`${m.error.code}: ${m.error.message}`);
    return m.result;
  }

  async waitEvent<E extends EventName>(event: E, pred: (d: Events[E]) => boolean = () => true, timeoutMs = 8000): Promise<Events[E]> {
    const end = Date.now() + timeoutMs;
    for (let seen = 0; ; ) {
      for (; seen < this.events.length; seen++) {
        const e = this.events[seen];
        if (e.event === event && pred(e.data)) return e.data;
      }
      if (Date.now() > end) throw new Error(`timeout waiting for ${event}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 100);
      });
    }
  }

  close() {
    this.ws.close();
  }
}

export const bearer = (token: string) => ({ protocols: ["gitnut.v1", `gitnut.bearer.${token}`] });
