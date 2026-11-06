import { createHash } from "node:crypto";
import {
  zipChanges,
  type ChangeStatus,
  type CommitDetails,
  type CommitFull,
  type FileChange,
  type GraphFilter,
  type GraphSnapshot,
  type RefInfo,
} from "@gitnut/commons";
import { fail } from "./errors";
import { git, isHash } from "./git";
import { parseWorktreeList, type Repo } from "./repos";

const MAX_CHANGES = 2000;
const PUBLIC_REF = /^refs\/(heads|remotes|tags)\//;

interface RefsState {
  graphId: string;
  refsOut: string;
  worktreesOut: string;
  /** Revision args for `git log`: every ref and worktree HEAD, minus the hidden namespaces. */
  revs: string[];
}

/**
 * Hash of every shown ref (with peeled tags) and every worktree HEAD. Changes iff the graph may
 * have changed. With `hideInternal`, refs outside heads/remotes/tags (agent checkpoints like
 * `refs/jean/checkpoints/*`, `refs/t3/*`) are dropped, so their commits and updates don't count.
 */
export async function refsState(repo: Repo, hideInternal = false): Promise<RefsState> {
  const [allRefs, worktreesOut] = await Promise.all([
    git(repo.path, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(symref)"]),
    git(repo.path, ["worktree", "list", "--porcelain", "-z"]),
  ]);
  const hidden = new Set(["refs/stash", "refs/notes/*"]);
  let refsOut = allRefs;
  if (hideInternal) {
    const keep: string[] = [];
    for (const line of allRefs.split("\n")) {
      const full = line.slice(0, line.indexOf("\0"));
      if (!full || PUBLIC_REF.test(full)) keep.push(line);
      else hidden.add(full.split("/").length > 2 ? full.split("/", 2).join("/") + "/*" : full);
    }
    refsOut = keep.join("\n");
  }
  const graphId = createHash("sha1").update(refsOut).update("\0").update(worktreesOut).digest("hex").slice(0, 16);
  return { graphId, refsOut, worktreesOut, revs: [...[...hidden].map((h) => `--exclude=${h}`), "--all"] };
}

interface Snapshot {
  snap: GraphSnapshot;
  revs: string[];
  hashes: string[];
  index: Map<string, number>;
  authorName: string[];
  authorEmail: string[];
  authorTime: number[];
  subject: string[];
}

const FIELDS = 7;

async function buildSnapshot(repo: Repo, state: RefsState): Promise<Snapshot> {
  const out = await git(repo.path, ["log", ...state.revs, "--date-order", "-z", "--format=%H%x00%P%x00%ct%x00%an%x00%ae%x00%at%x00%s"], {
    timeoutMs: 120_000,
  });
  const f = out.split("\0");
  const n = Math.floor(f.length / FIELDS);
  const hashes = new Array<string>(n);
  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set((hashes[i] = f[i * FIELDS]), i);
  const s: Snapshot = {
    snap: { repoId: repo.id, graphId: state.graphId, count: n, parents: new Array(n), times: new Array(n), refs: [] },
    revs: state.revs,
    hashes,
    index,
    authorName: new Array(n),
    authorEmail: new Array(n),
    authorTime: new Array(n),
    subject: new Array(n),
  };
  for (let i = 0; i < n; i++) {
    const o = i * FIELDS;
    const p = f[o + 1];
    s.snap.parents[i] = p ? p.split(" ").map((h) => index.get(h) ?? -1).filter((x) => x >= 0) : [];
    s.snap.times[i] = Number(f[o + 2]);
    s.authorName[i] = f[o + 3];
    s.authorEmail[i] = f[o + 4];
    s.authorTime[i] = Number(f[o + 5]);
    s.subject[i] = f[o + 6];
  }
  s.snap.refs = parseRefs(state, index);
  return s;
}

function parseRefs(state: RefsState, index: Map<string, number>): RefInfo[] {
  const wts = parseWorktreeList(state.worktreesOut);
  const refs: RefInfo[] = [];
  const main = wts[0];
  if (main && !main.bare && main.head && index.has(main.head)) {
    refs.push({ name: "HEAD", full: "HEAD", kind: "head", commit: index.get(main.head)!, worktrees: [main.path] });
  }
  for (const line of state.refsOut.split("\n")) {
    const [full, obj, peeled, symref] = line.split("\0");
    if (!full || symref) continue;
    const commit = index.get(peeled || obj);
    if (commit === undefined) continue;
    if (full.startsWith("refs/heads/")) {
      const worktrees = wts.filter((w) => w.branch === full).map((w) => w.path);
      refs.push({ name: full.slice(11), full, kind: "local", commit, worktrees });
    } else if (full.startsWith("refs/remotes/")) refs.push({ name: full.slice(13), full, kind: "remote", commit, worktrees: [] });
    else if (full.startsWith("refs/tags/")) refs.push({ name: full.slice(10), full, kind: "tag", commit, worktrees: [] });
  }
  return refs;
}

/** In-memory graph snapshots: a small LRU keyed by repo + graphId. */
export class GraphCache {
  private cache = new Map<string, Promise<Snapshot>>();
  constructor(
    private hideInternal: () => boolean = () => true,
    private max = 6,
  ) {}

  state(repo: Repo): Promise<RefsState> {
    return refsState(repo, this.hideInternal());
  }

  private load(repo: Repo, state: RefsState): Promise<Snapshot> {
    const key = `${repo.id}:${state.graphId}`;
    let p = this.cache.get(key);
    if (p) this.cache.delete(key);
    else p = buildSnapshot(repo, state);
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key));
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
    return p;
  }

  async get(repo: Repo): Promise<GraphSnapshot> {
    return (await this.load(repo, await this.state(repo))).snap;
  }

  /** Snapshot for a graphId the client holds; `not_found` when the refs moved on so the client refetches. */
  async snapshot(repo: Repo, graphId: unknown): Promise<Snapshot> {
    const cached = this.cache.get(`${repo.id}:${graphId}`);
    if (cached) return cached;
    const state = await this.state(repo);
    if (state.graphId !== graphId) fail("not_found", "graph changed, refetch graph.get");
    return this.load(repo, state);
  }

  /** Latest cached snapshot of a repo, if any (for hash -> index lookups). */
  async latest(repoId: string): Promise<Snapshot | null> {
    const keys = [...this.cache.keys()].filter((k) => k.startsWith(`${repoId}:`));
    return keys.length ? this.cache.get(keys[keys.length - 1])!.catch(() => null) : null;
  }

  async details(repo: Repo, graphId: unknown, indices: unknown): Promise<CommitDetails[]> {
    if (!Array.isArray(indices)) fail("bad_request", "indices must be an array");
    const s = await this.snapshot(repo, graphId);
    return (indices as unknown[])
      .filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < s.hashes.length)
      .map((i) => ({
        index: i,
        hash: s.hashes[i],
        subject: s.subject[i],
        authorName: s.authorName[i],
        authorEmail: s.authorEmail[i],
        authorTime: s.authorTime[i],
        commitTime: s.snap.times[i],
      }));
  }

  async filter(repo: Repo, graphId: unknown, filter: GraphFilter): Promise<number[]> {
    if (!filter || typeof filter !== "object") fail("bad_request", "filter must be an object");
    const s = await this.snapshot(repo, graphId);
    let keep: number[] = s.hashes.map((_, i) => i);
    const { text, author, path, refs, since, until } = filter;
    if (text || author || path || refs?.length) {
      const args = ["log", "--format=%H", "-i", "-F"];
      if (refs?.length) {
        const known = new Set(s.snap.refs.map((r) => r.full));
        for (const r of refs) if (!known.has(r)) fail("bad_request", `unknown ref ${r}`);
        args.push(...refs);
      } else args.push(...s.revs);
      if (text) args.push(`--grep=${text}`);
      if (author) args.push(`--author=${author}`);
      args.push("--");
      if (path) args.push(path);
      const hit = new Set((await git(repo.path, args, { timeoutMs: 120_000 })).split("\n"));
      keep = keep.filter((i) => hit.has(s.hashes[i]));
    }
    if (typeof since === "number") keep = keep.filter((i) => s.snap.times[i] >= since);
    if (typeof until === "number") keep = keep.filter((i) => s.snap.times[i] <= until);
    return keep;
  }

  async full(repo: Repo, hash: unknown): Promise<CommitFull> {
    if (!isHash(hash)) fail("bad_request", "hash must be a hex commit id");
    const out = await git(repo.path, [
      "show",
      "-s",
      "-z",
      "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%cn%x00%ce%x00%s%x00%b",
      `${hash}^{commit}`,
    ]).catch(() => fail("not_found", `unknown commit ${hash}`));
    const [h, p, an, ae, at, ct, cn, ce, subject, body] = out.split("\0");
    const latest = await this.latest(repo.id);
    return {
      index: latest?.index.get(h) ?? -1,
      hash: h,
      subject,
      authorName: an,
      authorEmail: ae,
      authorTime: Number(at),
      commitTime: Number(ct),
      body: (body ?? "").replace(/\n+$/, ""),
      committerName: cn,
      committerEmail: ce,
      parents: p ? p.split(" ") : [],
    };
  }
}

const STATUS: Record<string, ChangeStatus> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "typechange", U: "conflicted" };

/** Changed files of one commit against its first parent (root commits: everything added). */
export function parseNameStatus(out: string, parent: string | null, hash: string): FileChange[] {
  const f = out.split("\0");
  const changes: FileChange[] = [];
  for (let i = 0; i < f.length; i++) {
    const code = f[i];
    if (!code) continue;
    const status = STATUS[code[0]] ?? "modified";
    const two = code[0] === "R" || code[0] === "C";
    const oldPath = two ? f[++i] : f[i + 1];
    const path = two ? f[++i] : f[++i];
    const c: FileChange = {
      path,
      status,
      before: status === "added" || !parent ? null : { ref: parent, path: oldPath },
      after: status === "deleted" ? null : { ref: hash, path },
    };
    if (two) c.oldPath = oldPath;
    changes.push(c);
  }
  return changes;
}

/** Combined changes of several commits (IntelliJ zipChanges semantics), oldest first. */
export async function commitsChanges(repo: Repo, hashes: unknown, order?: Map<string, number>): Promise<{ changes: FileChange[]; truncated: boolean }> {
  if (!Array.isArray(hashes) || !hashes.length || hashes.length > 1000 || !hashes.every(isHash)) {
    fail("bad_request", "hashes must be 1..1000 hex commit ids");
  }
  // --no-walk sorts newest first by commit date; reverse for oldest first.
  const out = await git(repo.path, ["log", "--no-walk", "--date-order", "-z", "--format=%H %P", ...(hashes as string[]), "--"]).catch(() =>
    fail("not_found", "unknown commit"),
  );
  const commits = out
    .split("\0")
    .filter(Boolean)
    .map((l) => l.split(" "))
    .reverse();
  // Commit dates can tie (or lie); the snapshot's row order is topological, so prefer it.
  if (order && commits.every(([h]) => order.has(h))) commits.sort(([a], [b]) => order.get(b)! - order.get(a)!);
  const perCommit = await Promise.all(
    commits.map(async ([hash, parent]) => {
      const args = ["diff-tree", "-r", "-M", "-z", "--name-status", "--no-commit-id", "--root"];
      const d = await git(repo.path, parent ? [...args, parent, hash] : [...args, hash]);
      return parseNameStatus(d, parent ?? null, hash);
    }),
  );
  const changes = zipChanges(perCommit);
  return { changes: changes.slice(0, MAX_CHANGES), truncated: changes.length > MAX_CHANGES };
}
