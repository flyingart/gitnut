import { createHash } from "node:crypto";
import { realpath, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { BrowseResult, DiscoverResult, RepoSummary, Settings, WorktreeSummary } from "@gitnut/commons";
import { fail } from "./errors";
import { git } from "./git";
import { parseStatus, runStatus, toSummary } from "./status";

export interface Worktree {
  id: string;
  repoId: string;
  path: string;
  isMain: boolean;
}

export interface Repo {
  id: string;
  name: string;
  /** Main worktree, or the git dir of a bare repo. */
  path: string;
  commonDir: string;
  root: string | null;
  worktrees: Worktree[];
}

export const shortId = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

export function isExcluded(path: string, exclude: string[]): boolean {
  const parts = path.split(/[\\/]/);
  return exclude.some((e) => (e.includes("/") || e.includes("\\") ? inside(path, resolve(e)) : parts.includes(e)));
}

/** A folder listing that is a repo: has `.git`, or is a bare repo (`HEAD` + `objects` + `refs`). */
const isRepoListing = (names: Set<string>) => names.has(".git") || (names.has("HEAD") && names.has("objects") && names.has("refs"));
const isRepoDir = (dir: string) => readdir(dir).then((n) => isRepoListing(new Set(n)), () => false);

/** Directories under `dir` (to `depth` levels) that are git repos. Does not descend into repos or dot folders. */
async function scan(dir: string, depth: number, exclude: string[], out: string[]) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (isRepoListing(new Set(entries.map((e) => e.name)))) {
    out.push(dir);
    return;
  }
  if (depth <= 0) return;
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => join(dir, e.name))
      .filter((p) => !isExcluded(p, exclude))
      .map((p) => scan(p, depth - 1, exclude, out)),
  );
}

const expand = (p: string) => resolve(p.replace(/^~(?=$|[\\/])/, homedir()));

/** Sub-folders of a folder on this machine, for the client's folder picker. */
export async function browse(raw?: unknown): Promise<BrowseResult> {
  const home = homedir();
  const path = typeof raw === "string" && raw ? expand(raw) : home;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => fail("not_found", `${path} is not a readable folder`));
  const dirs = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith(".") && (e.isDirectory() || e.isSymbolicLink()))
      .map(async (e) => {
        const p = join(path, e.name);
        if (e.isSymbolicLink() && !(await stat(p).then((st) => st.isDirectory(), () => false))) return null;
        const repo = await isRepoDir(p);
        return { name: e.name, path: p, repo };
      }),
  );
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    home,
    dirs: dirs.filter((d) => d !== null).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Repositories under a folder and whether each one is listed already. Ignores `exclude`, so hidden repos can be added back. */
export async function discoverIn(raw: unknown, depth: unknown, s: Settings, listed: Repo[]): Promise<DiscoverResult> {
  if (typeof raw !== "string" || !raw) fail("bad_request", "path required");
  const dir = expand(raw as string);
  const d = typeof depth === "number" && depth >= 0 ? Math.min(depth, 6) : s.scanDepth;
  const found: string[] = [];
  await scan(dir, d, [], found);
  const shown = new Set(listed.flatMap((r) => [r.path, ...r.worktrees.map((w) => w.path)]));
  return {
    path: dir,
    watchedBy: s.roots.map((r) => resolve(r)).find((r) => inside(dir, r)) ?? null,
    repos: found.sort().map((p) => ({ path: p, name: basename(p), added: shown.has(p) })),
  };
}

interface WorktreeListEntry {
  path: string;
  head: string | null;
  /** Full ref, `refs/heads/x`. */
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

export function parseWorktreeList(out: string): WorktreeListEntry[] {
  return out
    .split("\0\0")
    .filter((b) => b.trim())
    .map((block) => {
      const e: WorktreeListEntry = { path: "", head: null, branch: null, bare: false, prunable: false };
      for (const line of block.split("\0")) {
        const [k, ...rest] = line.split(" ");
        const v = rest.join(" ");
        if (k === "worktree") e.path = v;
        else if (k === "HEAD") e.head = v;
        else if (k === "branch") e.branch = v;
        else if (k === "bare") e.bare = true;
        else if (k === "prunable") e.prunable = true;
      }
      return e;
    });
}

export const listWorktrees = async (cwd: string) => parseWorktreeList(await git(cwd, ["worktree", "list", "--porcelain", "-z"]));

/** Find all repositories from settings, worktrees grouped under their main repo. */
export async function discover(s: Settings): Promise<Repo[]> {
  const candidates: string[] = [];
  await Promise.all(s.roots.map((r) => scan(resolve(r), s.scanDepth, s.exclude, candidates)));
  candidates.push(...s.repos.map((r) => resolve(r)));
  const byCommon = new Map<string, string>();
  await Promise.all(
    candidates.map(async (c) => {
      const out = await git(c, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null);
      if (!out) return;
      const common = await realpath(out.trim()).catch(() => out.trim());
      if (!byCommon.has(common)) byCommon.set(common, c);
    }),
  );
  const roots = s.roots.map((r) => resolve(r));
  const repos = await Promise.all(
    [...byCommon].map(async ([commonDir, cwd]): Promise<Repo | null> => {
      const list = await listWorktrees(cwd).catch(() => null);
      if (!list?.length) return null;
      const main = list[0];
      const path = main.bare ? commonDir : main.path;
      if (isExcluded(path, s.exclude)) return null;
      const id = shortId(commonDir);
      const worktrees = list
        .filter((w) => !w.bare && !w.prunable && !isExcluded(w.path, s.exclude))
        .map((w) => ({ id: shortId(w.path), repoId: id, path: w.path, isMain: w === main }));
      return {
        id,
        name: basename(path).replace(/\.git$/, "") || path,
        path,
        commonDir,
        root: roots.find((r) => inside(path, r)) ?? null,
        worktrees,
      };
    }),
  );
  return repos.filter((r): r is Repo => r !== null).sort((a, b) => a.path.localeCompare(b.path));
}

export async function worktreeSummary(w: Worktree): Promise<WorktreeSummary> {
  const base = { id: w.id, repoId: w.repoId, path: w.path, isMain: w.isMain };
  try {
    return toSummary(base, parseStatus(await runStatus(w.path)));
  } catch {
    // A worktree that git can't read right now (being created, removed, locked) still shows up.
    return { ...base, branch: null, head: null, upstream: null, ahead: 0, behind: 0, counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } };
  }
}

export async function repoSummaries(repos: Repo[]): Promise<RepoSummary[]> {
  return Promise.all(
    repos.map(async (r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      root: r.root,
      worktrees: await Promise.all(r.worktrees.map(worktreeSummary)),
    })),
  );
}

/** Latest discovery result with lookups by id. */
export class RepoIndex {
  repos = new Map<string, Repo>();
  worktrees = new Map<string, Worktree>();
  private pending: Promise<Repo[]> | null = null;

  constructor(private settings: () => Settings) {}

  refresh(): Promise<Repo[]> {
    this.pending ??= discover(this.settings())
      .then((list) => {
        this.repos = new Map(list.map((r) => [r.id, r]));
        this.worktrees = new Map(list.flatMap((r) => r.worktrees.map((w) => [w.id, w] as const)));
        return list;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async list(): Promise<Repo[]> {
    return this.repos.size ? [...this.repos.values()] : this.refresh();
  }

  async repo(id: unknown): Promise<Repo> {
    if (typeof id !== "string") fail("bad_request", "repoId must be a string");
    if (!this.repos.has(id as string)) await this.refresh();
    return this.repos.get(id as string) ?? fail("not_found", `unknown repo ${id}`);
  }

  async worktree(id: unknown): Promise<Worktree> {
    if (typeof id !== "string") fail("bad_request", "worktreeId must be a string");
    if (!this.worktrees.has(id as string)) await this.refresh();
    return this.worktrees.get(id as string) ?? fail("not_found", `unknown worktree ${id}`);
  }
}

