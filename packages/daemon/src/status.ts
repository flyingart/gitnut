import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ChangeStatus, FileChange, WorktreeCounts, WorktreeSummary } from "@gitnut/commons";
import { git } from "./git";

export interface ParsedStatus {
  head: string | null;
  /** Short branch name, null when detached. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  counts: WorktreeCounts;
  changes: FileChange[];
  /** True when more than MAX_CHANGES paths changed; counts stay exact. */
  truncated: boolean;
}

// ponytail: fixed cap so a non-ignored node_modules can't flood clients; make it a setting if someone needs more.
export const MAX_CHANGES = 5000;

const STATUS_ARGS = ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--branch"];

export const runStatus = (path: string) => git(path, STATUS_ARGS);

export function parseStatus(out: string): ParsedStatus {
  const p: ParsedStatus = {
    head: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    changes: [],
    truncated: false,
  };
  const recs = out.split("\0");
  const entries: { kind: string; xy: string; path: string; orig?: string }[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    if (r.startsWith("# ")) {
      const [, key, ...rest] = r.split(" ");
      const val = rest.join(" ");
      if (key === "branch.oid") p.head = val === "(initial)" ? null : val;
      else if (key === "branch.head") p.branch = val === "(detached)" ? null : val;
      else if (key === "branch.upstream") p.upstream = val;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(val);
        if (m) [p.ahead, p.behind] = [Number(m[1]), Number(m[2])];
      }
    } else if (r[0] === "1") entries.push({ kind: "1", xy: r.slice(2, 4), path: field(r, 8) });
    else if (r[0] === "2") entries.push({ kind: "2", xy: r.slice(2, 4), path: field(r, 9), orig: recs[++i] });
    else if (r[0] === "u") entries.push({ kind: "u", xy: r.slice(2, 4), path: field(r, 10) });
    else if (r[0] === "?") entries.push({ kind: "?", xy: "??", path: r.slice(2) });
  }
  const head = p.head;
  const before = (path: string) => (head ? { ref: head, path } : null);
  for (const e of entries) {
    if (p.changes.length >= MAX_CHANGES) p.truncated = true;
    const [x, y] = e.xy;
    if (e.kind === "?") {
      p.counts.untracked++;
      if (!p.truncated) p.changes.push({ path: e.path, status: "untracked", before: null, after: { ref: "WORKTREE", path: e.path } });
      continue;
    }
    if (e.kind === "u") {
      p.counts.conflicted++;
      if (!p.truncated) p.changes.push({ path: e.path, status: "conflicted", before: before(e.path), after: { ref: "WORKTREE", path: e.path } });
      continue;
    }
    if (x !== ".") p.counts.staged++;
    if (y !== ".") p.counts.unstaged++;
    const staged = y === ".";
    const oldPath = e.orig;
    let status: ChangeStatus = "modified";
    let after: FileChange["after"] = { ref: "WORKTREE", path: e.path };
    if (x === "A" && y === "D") after = { ref: "INDEX", path: e.path };
    else if (y === "D" || (x === "D" && y === ".")) after = null;
    if (after === null) status = "deleted";
    else if (x === "A" || !head) status = "added";
    else if (x === "R") status = "renamed";
    else if (x === "C") status = "copied";
    else if (x === "T" || y === "T") status = "typechange";
    const c: FileChange = {
      path: e.path,
      status,
      before: status === "added" ? null : before(oldPath ?? e.path),
      after,
      staged,
    };
    if (oldPath) c.oldPath = oldPath;
    if (!p.truncated) p.changes.push(c);
  }
  return p;
}

/** The n-th space separated field; the last one (path) may contain spaces. */
function field(r: string, n: number): string {
  let i = 0;
  for (let k = 0; k < n; k++) i = r.indexOf(" ", i) + 1;
  return r.slice(i);
}

export function toSummary(base: Pick<WorktreeSummary, "id" | "repoId" | "path" | "isMain">, p: ParsedStatus): WorktreeSummary {
  return { ...base, branch: p.branch, head: p.head, upstream: p.upstream, ahead: p.ahead, behind: p.behind, counts: p.counts };
}

/**
 * Hash of the status output plus size/mtime of every changed file, so edits to an
 * already-modified file also count as a change.
 */
export async function statusHash(path: string, out: string, p: ParsedStatus): Promise<string> {
  const h = createHash("sha1").update(out);
  const stats = await Promise.all(
    p.changes.map((c) =>
      lstat(join(path, c.path)).then(
        (s) => `${c.path}:${s.size}:${s.mtimeMs}`,
        () => `${c.path}:-`,
      ),
    ),
  );
  return h.update(stats.join("\n")).digest("hex");
}
