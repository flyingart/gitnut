import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoSummary, WorktreeSummary } from "@gitnut/commons";
import { patchFromCli } from "../src/config";
import { Client, bearer, commit, g, makeFixture, startDaemon, tmp, write, type Fixture } from "./helpers";

let env: Awaited<ReturnType<typeof startDaemon>>;
let c: Client;

beforeAll(async () => {
  env = await startDaemon();
  c = await Client.connect(env.wsUrl, bearer(env.token));
});
afterAll(async () => {
  c?.close();
  await env?.d.stop();
});

/** A fresh fixture repo (roots/alpha + remote + feat2 worktree), watched by the daemon. */
async function setup(): Promise<{ fx: Fixture; repo: RepoSummary; main: WorktreeSummary; feat2: WorktreeSummary }> {
  const fx = makeFixture();
  const list = await c.call<RepoSummary[]>("roots.add", { path: fx.root });
  const repo = list.find((r) => r.path === fx.repo)!;
  return { fx, repo, main: repo.worktrees.find((w) => w.isMain)!, feat2: repo.worktrees.find((w) => !w.isMain)! };
}

const err = async (method: string, params: unknown) => (await c.send(method, params)).error as { code: string; message: string } | undefined;
const head = (dir: string) => g(dir, "rev-parse", "HEAD");
const branch = (dir: string) => g(dir, "branch", "--show-current");
const clean = (dir: string) => g(dir, "status", "--porcelain") === "";
const subjects = (dir: string, n: number) => g(dir, "log", `-${n}`, "--format=%s").split("\n");

describe("checkout", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    s = await setup();
  });

  test("R-ACT-3: local branch switches, remote branch creates a tracking branch (once)", async () => {
    const r = await c.call("worktree.checkout", { worktreeId: s.main.id, ref: "refs/heads/feature" });
    expect(r.branch).toBe("feature");
    expect(branch(s.fx.repo)).toBe("feature");
    await c.call("worktree.checkout", { worktreeId: s.main.id, ref: "main" });
    expect(branch(s.fx.repo)).toBe("main");

    g(s.fx.repo, "push", "-q", "origin", "feature:refs/heads/remote-only");
    g(s.fx.repo, "fetch", "-q", "origin");
    const t = await c.call("worktree.checkout", { worktreeId: s.main.id, ref: "refs/remotes/origin/remote-only" });
    expect(t.branch).toBe("remote-only");
    expect(g(s.fx.repo, "rev-parse", "--abbrev-ref", "remote-only@{u}")).toBe("origin/remote-only");
    await c.call("worktree.checkout", { worktreeId: s.main.id, ref: "main" });
    const e = await err("worktree.checkout", { worktreeId: s.main.id, ref: "refs/remotes/origin/remote-only" });
    expect(e?.code).toBe("bad_request");
    expect(e?.message).toContain('"remote-only" exists');
  });

  test("R-ACT-2: a commit hash checks out detached; newBranch creates and switches", async () => {
    const r = await c.call("worktree.checkout", { worktreeId: s.main.id, ref: s.fx.hashes.c2 });
    expect(r.branch).toBeNull();
    expect(head(s.fx.repo)).toBe(s.fx.hashes.c2);
    const n = await c.call("worktree.checkout", { worktreeId: s.main.id, ref: s.fx.hashes.c1, newBranch: "from-c1" });
    expect(n.branch).toBe("from-c1");
    expect(head(s.fx.repo)).toBe(s.fx.hashes.c1);
    await c.call("worktree.checkout", { worktreeId: s.main.id, ref: "main" });
  });

  test("R-ACT-5: git's refusal to overwrite local changes passes through; bad refs and names are rejected", async () => {
    write(s.fx.repo, "b.txt", "agent edit\n");
    const e = await err("worktree.checkout", { worktreeId: s.main.id, ref: s.fx.hashes.c1 });
    expect(e?.code).toBe("git_failed");
    expect(e?.message).toContain("overwritten");
    g(s.fx.repo, "checkout", "--", "b.txt");
    expect((await err("worktree.checkout", { worktreeId: s.main.id, ref: "--orphan" }))?.code).toBe("bad_request");
    expect((await err("worktree.checkout", { worktreeId: s.main.id, ref: "main~1" }))?.code).toBe("bad_request");
    expect((await err("worktree.checkout", { worktreeId: s.main.id, ref: "nope" }))?.code).toBe("not_found");
    expect((await err("worktree.checkout", { worktreeId: s.main.id, ref: "main", newBranch: "bad..name" }))?.code).toBe("bad_request");
    expect((await err("worktree.checkout", { worktreeId: s.main.id, ref: "main", newBranch: "-x" }))?.code).toBe("bad_request");
  });
});

describe("branches and tags", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    s = await setup();
  });

  test("R-ACT-2 R-ACT-3: create and delete a branch; the graph event goes out at once", async () => {
    await c.call("subscribe", { topics: [`repo:${s.repo.id}`] });
    await Bun.sleep(100);
    const before = c.events.length;
    await c.call("repo.branch.create", { repoId: s.repo.id, name: "tmp", at: s.fx.hashes.c2 });
    expect(g(s.fx.repo, "rev-parse", "tmp")).toBe(s.fx.hashes.c2);
    await c.waitEvent("graph.changed", (e) => e.repoId === s.repo.id, 1500);
    expect(c.events.length).toBeGreaterThan(before);
    expect((await err("repo.branch.create", { repoId: s.repo.id, name: "tmp", at: s.fx.hashes.c1 }))?.code).toBe("git_failed");
    await c.call("repo.branch.delete", { repoId: s.repo.id, name: "refs/heads/tmp" });
    expect(g(s.fx.repo, "branch", "--list", "tmp")).toBe("");
  });

  test("R-ACT-3: an unmerged branch needs force; a remote branch is deleted on the remote", async () => {
    g(s.fx.repo, "checkout", "-q", "-b", "unmerged");
    commit(s.fx.repo, "unmerged work", { "u.txt": "u\n" });
    g(s.fx.repo, "checkout", "-q", "main");
    const e = await err("repo.branch.delete", { repoId: s.repo.id, name: "unmerged" });
    expect(e?.code).toBe("git_failed");
    expect(e?.message).toContain("not fully merged");
    await c.call("repo.branch.delete", { repoId: s.repo.id, name: "unmerged", force: true });
    expect(g(s.fx.repo, "branch", "--list", "unmerged")).toBe("");

    g(s.fx.repo, "push", "-q", "origin", "feature");
    expect(g(s.fx.remote, "branch", "--list", "feature")).toContain("feature");
    await c.call("repo.branch.delete", { repoId: s.repo.id, name: "origin/feature", remote: true });
    expect(g(s.fx.remote, "branch", "--list", "feature")).toBe("");
    expect(g(s.fx.repo, "branch", "-r", "--list", "origin/feature")).toBe("");
    expect((await err("repo.branch.delete", { repoId: s.repo.id, name: "nowhere/x", remote: true }))?.code).toBe("bad_request");
  });

  test("R-ACT-3: push a local branch sets its upstream", async () => {
    g(s.fx.repo, "branch", "to-push", s.fx.hashes.c1);
    await c.call("repo.branch.push", { repoId: s.repo.id, name: "to-push" });
    expect(g(s.fx.remote, "rev-parse", "to-push")).toBe(s.fx.hashes.c1);
    expect(g(s.fx.repo, "rev-parse", "--abbrev-ref", "to-push@{u}")).toBe("origin/to-push");
  });

  test("R-ACT-2: lightweight and annotated tags, delete", async () => {
    await c.call("repo.tag.create", { repoId: s.repo.id, name: "light", at: s.fx.hashes.c1 });
    await c.call("repo.tag.create", { repoId: s.repo.id, name: "v2.0", at: "main", message: "second release" });
    expect(g(s.fx.repo, "cat-file", "-t", "light")).toBe("commit");
    expect(g(s.fx.repo, "cat-file", "-t", "v2.0")).toBe("tag");
    expect(g(s.fx.repo, "rev-parse", "v2.0^{commit}")).toBe(s.fx.hashes.c3);
    await c.call("repo.tag.delete", { repoId: s.repo.id, name: "light" });
    await c.call("repo.tag.delete", { repoId: s.repo.id, name: "refs/tags/v2.0" });
    expect(g(s.fx.repo, "tag", "--list", "light", "v2.0")).toBe("");
    expect((await err("repo.tag.create", { repoId: s.repo.id, name: "bad tag", at: "main" }))?.code).toBe("bad_request");
  });
});

describe("cherry-pick, revert, merge, rebase, reset", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  const picks: string[] = [];
  beforeAll(async () => {
    s = await setup();
    g(s.fx.repo, "checkout", "-q", "-b", "picks", s.fx.hashes.c1);
    for (const n of [1, 2, 3]) picks.push(commit(s.fx.repo, `p${n}`, { [`p${n}.txt`]: `${n}\n` }));
    g(s.fx.repo, "checkout", "-q", "main");
  });

  test("R-ACT-2: cherry-pick several commits applies them oldest first", async () => {
    await c.call("graph.get", { repoId: s.repo.id }); // graph order from the cached snapshot
    await c.call("worktree.cherryPick", { worktreeId: s.main.id, hashes: [picks[2], picks[0], picks[1]] });
    expect(subjects(s.fx.repo, 3)).toEqual(["p3", "p2", "p1"]);
  });

  test("R-ACT-2: revert several commits, newest first, without an editor", async () => {
    const [p3, , p1] = g(s.fx.repo, "log", "-3", "--format=%H").split("\n");
    await c.call("worktree.revert", { worktreeId: s.main.id, hashes: [p1.slice(0, 10), p3] });
    expect(subjects(s.fx.repo, 2)).toEqual(['Revert "p1"', 'Revert "p3"']);
    expect(existsSync(join(s.fx.repo, "p2.txt"))).toBe(true);
    expect(existsSync(join(s.fx.repo, "p1.txt"))).toBe(false);
  });

  test("R-ACT-5: a conflicting cherry-pick is aborted with the conflict error", async () => {
    g(s.fx.repo, "checkout", "-q", "-b", "cp-x", s.fx.hashes.c3);
    const x = commit(s.fx.repo, "x edits b", { "b.txt": "theirs\n" });
    g(s.fx.repo, "checkout", "-q", "main");
    commit(s.fx.repo, "main edits b", { "b.txt": "ours\n" });
    const before = head(s.fx.repo);
    const e = await err("worktree.cherryPick", { worktreeId: s.main.id, hashes: [x] });
    expect(e?.code).toBe("conflict");
    expect(e?.message).toContain("b.txt");
    expect(head(s.fx.repo)).toBe(before);
    expect(clean(s.fx.repo)).toBe(true);
  });

  test("R-ACT-3: merge clean, and a conflicting merge is aborted leaving the worktree clean", async () => {
    g(s.fx.repo, "checkout", "-q", "-b", "m-clean");
    commit(s.fx.repo, "clean change", { "m.txt": "m\n" });
    g(s.fx.repo, "checkout", "-q", "main");
    await c.call("worktree.merge", { worktreeId: s.main.id, ref: "refs/heads/m-clean" });
    expect(existsSync(join(s.fx.repo, "m.txt"))).toBe(true);

    g(s.fx.repo, "checkout", "-q", "-b", "m-conflict");
    commit(s.fx.repo, "conflict theirs", { "b.txt": "conflict theirs\n" });
    g(s.fx.repo, "checkout", "-q", "main");
    commit(s.fx.repo, "conflict ours", { "b.txt": "conflict ours\n" });
    write(s.fx.repo, "agent-notes.txt", "untracked work survives\n");
    const before = head(s.fx.repo);
    const e = await err("worktree.merge", { worktreeId: s.main.id, ref: "m-conflict" });
    expect(e?.code).toBe("conflict");
    expect(e?.message).toContain("b.txt");
    expect(head(s.fx.repo)).toBe(before);
    expect(existsSync(join(s.fx.repo, ".git", "MERGE_HEAD"))).toBe(false);
    expect(g(s.fx.repo, "status", "--porcelain")).toBe("?? agent-notes.txt");
    g(s.fx.repo, "clean", "-fq");
  });

  test("R-ACT-3: rebase clean, and a conflicting rebase is aborted", async () => {
    commit(s.fx.worktree, "feat2 work", { "f2.txt": "f2\n" });
    await c.call("worktree.rebase", { worktreeId: s.feat2.id, onto: "main" });
    expect(g(s.fx.worktree, "rev-parse", "HEAD~1")).toBe(head(s.fx.repo));

    const mine = commit(s.fx.worktree, "feat2 edits b", { "b.txt": "feat2 says\n" });
    commit(s.fx.repo, "main edits b again", { "b.txt": "main says\n" });
    const e = await err("worktree.rebase", { worktreeId: s.feat2.id, onto: "refs/heads/main" });
    expect(e?.code).toBe("conflict");
    expect(e?.message).toContain("b.txt");
    expect(head(s.fx.worktree)).toBe(mine);
    expect(clean(s.fx.worktree)).toBe(true);
  });

  test("R-ACT-5: an operation already in progress is never aborted by us", async () => {
    g(s.fx.repo, "checkout", "-q", "-b", "ip");
    commit(s.fx.repo, "ip theirs", { "b.txt": "ip theirs\n" });
    g(s.fx.repo, "checkout", "-q", "main");
    commit(s.fx.repo, "ip ours", { "b.txt": "ip ours\n" });
    Bun.spawnSync(["git", "merge", "ip"], { cwd: s.fx.repo, stdout: "ignore", stderr: "ignore" }); // the agent's own conflicted merge
    expect((await err("worktree.merge", { worktreeId: s.main.id, ref: "feature" }))?.message).toContain("in progress");
    expect(existsSync(join(s.fx.repo, ".git", "MERGE_HEAD"))).toBe(true);
    g(s.fx.repo, "merge", "--abort");
  });

  test("R-ACT-2: reset soft, mixed and hard", async () => {
    const base = head(s.fx.repo);
    const one = () => commit(s.fx.repo, "to reset", { "r.txt": "r\n" });
    one();
    await c.call("worktree.reset", { worktreeId: s.main.id, to: base, mode: "soft" });
    expect(head(s.fx.repo)).toBe(base);
    expect(g(s.fx.repo, "status", "--porcelain")).toBe("A  r.txt");
    g(s.fx.repo, "commit", "-qm", "again");
    await c.call("worktree.reset", { worktreeId: s.main.id, to: base, mode: "mixed" });
    expect(g(s.fx.repo, "status", "--porcelain")).toBe("?? r.txt");
    g(s.fx.repo, "add", "r.txt");
    g(s.fx.repo, "commit", "-qm", "again");
    await c.call("worktree.reset", { worktreeId: s.main.id, to: base, mode: "hard" });
    expect(head(s.fx.repo)).toBe(base);
    expect(clean(s.fx.repo)).toBe(true);
    expect((await err("worktree.reset", { worktreeId: s.main.id, to: base, mode: "keep" }))?.code).toBe("bad_request");
  });
});

describe("local changes", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    s = await setup();
  });

  test("R-ACT-4: discard tracked (staged and unstaged) and untracked files", async () => {
    write(s.fx.repo, "b.txt", "unstaged edit\n");
    write(s.fx.repo, "src/lib.ts", "staged edit\n");
    g(s.fx.repo, "add", "src/lib.ts");
    write(s.fx.repo, "new dir/new*.txt", "untracked\n");
    write(s.fx.repo, "keep.txt", "keep\n");
    await c.call("worktree.discard", { worktreeId: s.main.id, paths: ["b.txt", "src/lib.ts", "new dir/new*.txt"] });
    expect(g(s.fx.repo, "status", "--porcelain")).toBe("?? keep.txt");
    expect(existsSync(join(s.fx.repo, "new dir/new*.txt"))).toBe(false);
  });

  test("R-ACT-4: discard rejects paths outside the worktree, unchanged paths, and deletes symlinks, not their targets", async () => {
    const outside = tmp("gitnut-outside-");
    writeFileSync(join(outside, "precious.txt"), "do not delete\n");
    symlinkSync(outside, join(s.fx.repo, "lnk"));
    for (const p of ["../outside.txt", "/etc/passwd", "lnk/precious.txt", "a/../../x"]) {
      expect((await err("worktree.discard", { worktreeId: s.main.id, paths: [p] }))?.code).toBe("bad_request");
    }
    expect((await err("worktree.discard", { worktreeId: s.main.id, paths: ["b.txt"] }))?.message).toContain("no local changes");
    await c.call("worktree.discard", { worktreeId: s.main.id, paths: ["lnk"] });
    expect(existsSync(join(s.fx.repo, "lnk"))).toBe(false);
    expect(existsSync(join(outside, "precious.txt"))).toBe(true);
    mkdirSync(join(s.fx.repo, "nested"));
    g(join(s.fx.repo, "nested"), "init", "-q");
    commit(join(s.fx.repo, "nested"), "n", { "n.txt": "n" });
    expect((await err("worktree.discard", { worktreeId: s.main.id, paths: ["nested/"] }))?.code).toBe("bad_request");
    g(s.fx.repo, "clean", "-fdfq");
  });

  test("R-ACT-4: stash with untracked files and a message, list, pop", async () => {
    write(s.fx.repo, "b.txt", "wip\n");
    write(s.fx.repo, "u.txt", "untracked wip\n");
    await c.call("worktree.stash", { worktreeId: s.main.id, message: "agent wip", includeUntracked: true });
    expect(clean(s.fx.repo)).toBe(true);
    const list = await c.call("repo.stashes", { repoId: s.repo.id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: "stash@{0}", message: expect.stringContaining("agent wip") });
    await c.call("worktree.stashPop", { worktreeId: s.main.id });
    expect(g(s.fx.repo, "status", "--porcelain").split("\n").map((l) => l.trim()).sort()).toEqual(["?? u.txt", "M b.txt"]);
    expect(await c.call("repo.stashes", { repoId: s.repo.id })).toHaveLength(0);
  });

  test("R-ACT-4: an unstash with conflicts resets the worktree and keeps the stash", async () => {
    g(s.fx.repo, "clean", "-fq");
    g(s.fx.repo, "stash", "-q");
    commit(s.fx.repo, "conflicts with the stash", { "b.txt": "committed meanwhile\n" });
    const e = await err("worktree.stashPop", { worktreeId: s.main.id });
    expect(e?.code).toBe("conflict");
    expect(clean(s.fx.repo)).toBe(true);
    expect(await c.call("repo.stashes", { repoId: s.repo.id })).toHaveLength(1);
  });
});

describe("fetch", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  let other: string;
  const pushFromOther = (msg: string) => {
    commit(other, msg, { "remote.txt": `${msg}\n` });
    g(other, "push", "-q", "origin", "main");
    return head(other);
  };
  beforeAll(async () => {
    s = await setup();
    other = join(tmp(), "other");
    g(s.fx.base, "clone", "-q", s.fx.remote, other);
  });

  test("R-ACT-1: repos.fetchAll fetches every repository and reports each", async () => {
    const pushed = pushFromOther("from another machine");
    const { results } = await c.call("repos.fetchAll");
    expect(results.length).toBeGreaterThanOrEqual(4);
    expect(results.find((r: any) => r.repoId === s.repo.id)).toMatchObject({ ok: true, name: "alpha" });
    expect(g(s.fx.repo, "rev-parse", "origin/main")).toBe(pushed);
  });

  test("R-ACT-1: autoFetchMinutes fetches on its interval, and 0 turns it off", async () => {
    expect(patchFromCli("autoFetchMinutes", "15")).toEqual({ autoFetchMinutes: 15 });
    expect((await err("settings.update", { patch: { autoFetchMinutes: -1 } }))?.code).toBe("bad_request");
    const pushed = pushFromOther("auto fetched");
    const runs = env.d.autoFetchRuns;
    await c.call("settings.update", { patch: { autoFetchMinutes: 0.004 } }); // 240 ms
    for (let i = 0; i < 100 && env.d.autoFetchRuns < runs + 2; i++) await Bun.sleep(100);
    expect(env.d.autoFetchRuns).toBeGreaterThanOrEqual(runs + 2);
    expect(g(s.fx.repo, "rev-parse", "origin/main")).toBe(pushed);
    await c.call("settings.update", { patch: { autoFetchMinutes: 0 } });
    await Bun.sleep(600); // a round that was running finishes
    const after = env.d.autoFetchRuns;
    await Bun.sleep(600);
    expect(env.d.autoFetchRuns).toBe(after);
  });
});
