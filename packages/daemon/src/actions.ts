// IntelliJ-style git actions (R-ACT): checkout, branches, tags, cherry-pick, revert, merge, rebase, reset,
// discard, stash, fetch all. User strings never become git options: names are checked with
// `git check-ref-format`, revisions are resolved to hashes, and `--end-of-options` / `--` separate the rest.
import { existsSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { FetchAllEntry, Method, ResetMode, StashEntry } from "@gitnut/commons";
import { fail } from "./errors";
import { insideWorktree } from "./files";
import { git, gitOutput, gitRaw, type GitResult } from "./git";
import type { Repo, Worktree } from "./repos";
import type { Daemon } from "./server";
import { parseStatus, runStatus } from "./status";

type Handler = (d: Daemon, p: any) => Promise<unknown>;

export const obj = (p: unknown) => (p && typeof p === "object" ? (p as Record<string, any>) : fail("bad_request", "params must be an object"));
const str = (v: unknown, what: string): string => (typeof v === "string" && v ? v : fail("bad_request", `${what} required`));
const text = (r: GitResult) => `${new TextDecoder().decode(r.stdout)}${r.stderr}`.trim();
const run = (cwd: string, args: string[]) => gitRaw(cwd, args, { write: true, timeoutMs: 180_000, allowFail: true });
const ok = async (cwd: string, args: string[]) => (await gitRaw(cwd, args, { allowFail: true })).code === 0;

/** Push graph / worktree / repos events now: an action can move refs and change any worktree of the repo. */
export function pokeRepo(d: Daemon, repoId: string) {
  const repo = d.index.repos.get(repoId);
  d.live.poke("repos", `repo:${repoId}`, ...(repo?.worktrees.map((w) => `worktree:${w.id}`) ?? []));
}

/** Validate a new branch / tag name with git's own rules. */
async function refName(cwd: string, v: unknown, kind: "heads" | "tags"): Promise<string> {
  const name = str(v, "name");
  if (name.startsWith("-") || !(await ok(cwd, ["check-ref-format", `refs/${kind}/${name}`]))) {
    fail("bad_request", `"${name}" is not a valid ${kind === "heads" ? "branch" : "tag"} name`);
  }
  return name;
}

/** Resolve a ref name or hash to a full commit hash. Rejects anything that looks like an option or a rev expression. */
async function commitOf(cwd: string, v: unknown, what = "ref"): Promise<string> {
  const ref = str(v, what);
  if (ref.startsWith("-") || ref.length > 1000 || /[\s\0~^:?*[\\]|\.\.|@\{/.test(ref)) fail("bad_request", `bad ${what} "${ref}"`);
  const r = await gitRaw(cwd, ["rev-parse", "--verify", "-q", "--end-of-options", `${ref}^{commit}`], { allowFail: true });
  if (r.code !== 0) fail("not_found", `unknown ${what} "${ref}"`);
  return new TextDecoder().decode(r.stdout).trim();
}

interface Ref {
  kind: "local" | "remote" | "tag" | "commit";
  /** `main`, `origin/main`, `v1`, or the hash. */
  short: string;
  hash: string;
}

/** What a (validated) ref is: full names (`refs/heads/x`) or short ones, local before remote before tag. */
async function classify(cwd: string, v: unknown): Promise<Ref> {
  const hash = await commitOf(cwd, v);
  const ref = v as string;
  const candidates = ref.startsWith("refs/") ? [ref] : [`refs/heads/${ref}`, `refs/remotes/${ref}`, `refs/tags/${ref}`];
  for (const full of candidates) {
    if (await ok(cwd, ["show-ref", "--verify", "-q", full])) {
      const [, kind] = full.split("/");
      return { kind: kind === "heads" ? "local" : kind === "remotes" ? "remote" : kind === "tags" ? "tag" : "commit", short: full.replace(/^refs\/(heads|remotes|tags)\//, ""), hash };
    }
  }
  return { kind: "commit", short: hash, hash };
}

/** Split `origin/feature/x` into a configured remote and the branch on it. */
async function splitRemote(cwd: string, name: string): Promise<{ remote: string; branch: string }> {
  const remotes = (await git(cwd, ["remote"])).split("\n").filter(Boolean).sort((a, b) => b.length - a.length);
  const remote = remotes.find((r) => name.startsWith(`${r}/`)) ?? fail("bad_request", `${name} is not a branch of a configured remote`);
  return { remote, branch: name.slice(remote.length + 1) };
}

async function currentBranch(cwd: string) {
  const r = await gitRaw(cwd, ["symbolic-ref", "--short", "-q", "HEAD"], { allowFail: true });
  return r.code === 0 ? new TextDecoder().decode(r.stdout).trim() : null;
}

const OP_STATE = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"];

/** Refuse to start when the worktree is in the middle of another operation (an agent's rebase must never be aborted by us). */
async function assertIdle(cwd: string) {
  const paths = (await git(cwd, ["rev-parse", ...OP_STATE.flatMap((s) => ["--git-path", s])])).split("\n").filter(Boolean);
  if (paths.some((p) => existsSync(resolve(cwd, p)))) {
    fail("bad_request", "a merge, rebase, cherry-pick or revert is in progress in this worktree; finish or abort it first");
  }
}

const conflictedPaths = async (cwd: string) => (await git(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => "")).split("\0").filter(Boolean);

/** Run merge / rebase / cherry-pick / revert; on failure abort it so the worktree is left as before (R-PROD-3). */
async function abortable(cwd: string, op: "merge" | "rebase" | "cherry-pick" | "revert", args: string[]) {
  await assertIdle(cwd);
  const r = await run(cwd, args);
  const output = text(r);
  if (r.code === 0) return { output };
  const conflicts = await conflictedPaths(cwd);
  await run(cwd, [op, "--abort"]);
  const name = op[0].toUpperCase() + op.slice(1);
  if (conflicts.length) {
    const list = conflicts.length > 10 ? `${conflicts.slice(0, 10).join(", ")} and ${conflicts.length - 10} more` : conflicts.join(", ");
    fail("conflict", `${name} hit conflicts in ${list}. It was aborted; the worktree is unchanged.\n\n${output}`);
  }
  return fail("git_failed", output || `git ${op} failed`);
}

/** Fail with git's output when a command did not succeed. */
async function must(cwd: string, args: string[]) {
  const r = await run(cwd, args);
  if (r.code !== 0) fail("git_failed", text(r) || `git ${args[0]} failed`);
  return { output: text(r) };
}

/** Full hashes of `hashes`, newest first (graph order: children before parents). */
async function newestFirst(d: Daemon, repo: Repo, cwd: string, hashes: unknown): Promise<string[]> {
  if (!Array.isArray(hashes) || !hashes.length || hashes.length > 500) fail("bad_request", "hashes must be a non-empty array");
  const full = [...new Set(await Promise.all((hashes as unknown[]).map((h) => commitOf(cwd, h, "commit"))))];
  await d.graphs.get(repo); // current snapshot (cached; the client loads it after the action anyway)
  const index = (await d.graphs.latest(repo.id))?.index;
  if (index && full.every((h) => index.has(h))) return full.sort((a, b) => index.get(a)! - index.get(b)!);
  // not in the cached graph yet: git's date order
  return (await git(cwd, ["rev-list", "--no-walk=sorted", ...full])).split("\n").filter(Boolean);
}

async function worktreeOf(d: Daemon, p: unknown): Promise<{ wt: Worktree; repo: Repo }> {
  const wt = await d.index.worktree(obj(p).worktreeId);
  return { wt, repo: await d.index.repo(wt.repoId) };
}

/** Wrap a handler so graph / worktree events go out right after it, also when it failed half-way. */
const poking = (h: (d: Daemon, p: any) => Promise<{ repoId: string; result: unknown }>): Handler => async (d, p) => {
  let repoId: string | null = null;
  try {
    const r = await h(d, p);
    repoId = r.repoId;
    return r.result;
  } finally {
    const id = repoId ?? (await d.index.worktree(p?.worktreeId).then((w) => w.repoId, () => (typeof p?.repoId === "string" ? p.repoId : null)));
    if (id) pokeRepo(d, id);
  }
};

/** Fetch every repository, one after another. */
export async function fetchAll(d: Daemon): Promise<FetchAllEntry[]> {
  const out: FetchAllEntry[] = [];
  for (const repo of await d.index.refresh()) {
    try {
      out.push({ repoId: repo.id, name: repo.name, ok: true, output: await gitOutput(repo.path, ["fetch", "--all", "--prune"]) });
    } catch (e) {
      out.push({ repoId: repo.id, name: repo.name, ok: false, output: (e as Error).message });
    }
    d.live.poke(`repo:${repo.id}`);
  }
  d.live.poke("repos");
  return out;
}

export const actionHandlers = {
  "repos.fetchAll": async (d) => ({ results: await fetchAll(d) }),

  "worktree.checkout": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    const ref = await classify(wt.path, p.ref);
    let args: string[];
    if (p.newBranch !== undefined && p.newBranch !== null) {
      const name = await refName(wt.path, p.newBranch, "heads");
      // a branch start point keeps git's upstream setup (a remote start point tracks it)
      args = ["switch", "-c", name, "--end-of-options", ref.kind === "local" || ref.kind === "remote" ? ref.short : ref.hash];
    } else if (ref.kind === "local") {
      args = ["switch", "--end-of-options", ref.short];
    } else if (ref.kind === "remote") {
      const { branch } = await splitRemote(wt.path, ref.short);
      if (await ok(wt.path, ["show-ref", "--verify", "-q", `refs/heads/${branch}`])) {
        fail("bad_request", `a local branch "${branch}" exists already. Check out "${branch}", or create a new branch from ${ref.short} under another name.`);
      }
      args = ["switch", "-c", branch, "--track", "--end-of-options", ref.short];
    } else {
      args = ["switch", "--detach", "--end-of-options", ref.hash];
    }
    const { output } = await must(wt.path, args);
    return { repoId: wt.repoId, result: { output, branch: await currentBranch(wt.path) } };
  }),

  "repo.branch.create": poking(async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    const name = await refName(repo.path, p.name, "heads");
    const at = await commitOf(repo.path, p.at, "at");
    return { repoId: repo.id, result: await must(repo.path, ["branch", "--end-of-options", name, at]) };
  }),

  "repo.branch.delete": poking(async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    const raw = str(p.name, "name");
    if (p.remote === true) {
      const { remote, branch } = await splitRemote(repo.path, raw.replace(/^refs\/remotes\//, ""));
      await refName(repo.path, branch, "heads");
      return { repoId: repo.id, result: await must(repo.path, ["push", "--delete", "--end-of-options", remote, branch]) };
    }
    const name = await refName(repo.path, raw.replace(/^refs\/heads\//, ""), "heads");
    if (!(await ok(repo.path, ["show-ref", "--verify", "-q", `refs/heads/${name}`]))) fail("not_found", `no local branch ${name}`);
    return { repoId: repo.id, result: await must(repo.path, ["branch", p.force === true ? "-D" : "-d", "--end-of-options", name]) };
  }),

  "repo.branch.push": poking(async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    const name = await refName(repo.path, str(p.name, "name").replace(/^refs\/heads\//, ""), "heads");
    if (!(await ok(repo.path, ["show-ref", "--verify", "-q", `refs/heads/${name}`]))) fail("not_found", `no local branch ${name}`);
    const configured = (await gitRaw(repo.path, ["config", "--get", `branch.${name}.remote`], { allowFail: true }));
    const remotes = (await git(repo.path, ["remote"])).split("\n").filter(Boolean);
    const upstream = configured.code === 0 ? new TextDecoder().decode(configured.stdout).trim() : null;
    const remote = upstream && remotes.includes(upstream) ? upstream : remotes.includes("origin") ? "origin" : (remotes[0] ?? fail("bad_request", "no remote to push to"));
    return { repoId: repo.id, result: await must(repo.path, ["push", ...(upstream ? [] : ["-u"]), "--end-of-options", remote, `refs/heads/${name}`]) };
  }),

  "repo.tag.create": poking(async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    const name = await refName(repo.path, p.name, "tags");
    const at = await commitOf(repo.path, p.at, "at");
    if (p.message !== undefined && typeof p.message !== "string") fail("bad_request", "message must be a string");
    const msg = p.message?.trim() ? ["-a", "-m", p.message as string] : [];
    return { repoId: repo.id, result: await must(repo.path, ["tag", ...msg, "--end-of-options", name, at]) };
  }),

  "repo.tag.delete": poking(async (d, p) => {
    const repo = await d.index.repo(obj(p).repoId);
    const name = await refName(repo.path, str(p.name, "name").replace(/^refs\/tags\//, ""), "tags");
    return { repoId: repo.id, result: await must(repo.path, ["tag", "-d", "--end-of-options", name]) };
  }),

  "worktree.cherryPick": poking(async (d, p) => {
    const { wt, repo } = await worktreeOf(d, p);
    const hashes = (await newestFirst(d, repo, wt.path, p.hashes)).reverse();
    return { repoId: repo.id, result: await abortable(wt.path, "cherry-pick", ["cherry-pick", ...hashes]) };
  }),

  "worktree.revert": poking(async (d, p) => {
    const { wt, repo } = await worktreeOf(d, p);
    const hashes = await newestFirst(d, repo, wt.path, p.hashes);
    return { repoId: repo.id, result: await abortable(wt.path, "revert", ["revert", "--no-edit", ...hashes]) };
  }),

  "worktree.merge": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    const ref = await classify(wt.path, p.ref);
    return { repoId: wt.repoId, result: await abortable(wt.path, "merge", ["merge", "--no-edit", "--end-of-options", ref.short]) };
  }),

  "worktree.rebase": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    const ref = await classify(wt.path, p.onto);
    return { repoId: wt.repoId, result: await abortable(wt.path, "rebase", ["rebase", "--end-of-options", ref.short]) };
  }),

  "worktree.reset": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    const mode = p.mode as ResetMode;
    if (!["soft", "mixed", "hard"].includes(mode)) fail("bad_request", "mode must be soft, mixed or hard");
    const to = await commitOf(wt.path, p.to, "to");
    return { repoId: wt.repoId, result: await must(wt.path, ["reset", `--${mode}`, to, "--"]) };
  }),

  "worktree.discard": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    const paths = p.paths;
    if (!Array.isArray(paths) || !paths.length || !paths.every((x) => typeof x === "string" && x)) fail("bad_request", "paths must be a non-empty array of strings");
    const changes = new Map(parseStatus(await runStatus(wt.path)).changes.map((c) => [c.path, c]));
    const tracked = new Set<string>();
    const untracked: string[] = [];
    for (const raw of paths as string[]) {
      const path = raw.replace(/\\/g, "/");
      const full = await insideWorktree(wt.path, path);
      const c = changes.get(path) ?? fail("bad_request", `${path} has no local changes`);
      if (c.status === "untracked") {
        untracked.push(full ?? fail("bad_request", `${path} not found`));
      } else {
        tracked.add(path);
        if (c.oldPath) tracked.add(c.oldPath);
      }
    }
    const out: string[] = [];
    if (tracked.size) out.push((await must(wt.path, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...[...tracked].map((x) => `:(literal)${x}`)])).output);
    for (const full of untracked) {
      const st = await lstat(full).catch(() => null);
      if (!st) continue;
      // a nested repository shows up as an untracked folder: never delete folders
      if (st.isDirectory()) fail("bad_request", `${full} is a folder; delete it by hand`);
      await rm(full, { force: true }); // unlinks a symlink itself, never its target
    }
    if (untracked.length) out.push(`Deleted ${untracked.length} untracked ${untracked.length === 1 ? "file" : "files"}`);
    return { repoId: wt.repoId, result: { output: out.filter(Boolean).join("\n") } };
  }),

  "worktree.stash": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    if (p.message !== undefined && typeof p.message !== "string") fail("bad_request", "message must be a string");
    const args = ["stash", "push", ...(p.includeUntracked === true ? ["--include-untracked"] : []), ...(p.message?.trim() ? ["-m", p.message as string] : [])];
    return { repoId: wt.repoId, result: await must(wt.path, args) };
  }),

  "worktree.stashPop": poking(async (d, p) => {
    const { wt } = await worktreeOf(d, p);
    await assertIdle(wt.path);
    const r = await run(wt.path, ["stash", "pop"]);
    if (r.code === 0) return { repoId: wt.repoId, result: { output: text(r) } };
    const conflicts = await conflictedPaths(wt.path);
    if (conflicts.length) {
      // git keeps the stash on conflicts; put the worktree back as it was
      await run(wt.path, ["reset", "--merge"]);
      fail("conflict", `Unstash hit conflicts in ${conflicts.join(", ")}. The worktree was reset; the stash is kept.\n\n${text(r)}`);
    }
    return fail("git_failed", text(r) || "git stash pop failed");
  }),

  "repo.stashes": async (d, p): Promise<StashEntry[]> => {
    const repo = await d.index.repo(obj(p).repoId);
    const out = await git(repo.path, ["stash", "list", "--format=%gd%x1f%H%x1f%ct%x1f%gs"]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [ref, hash, time, message] = l.split("\x1f");
        return { ref, hash, time: Number(time), message };
      });
  },
} satisfies Partial<Record<Method, Handler>>;
