import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipChanges, type FileChange, type GraphSnapshot, type RepoSummary } from "@gitnut/commons";
import { Client, bearer, commit, g, makeFixture, startDaemon, tmp, write, type Fixture } from "./helpers";
import { parseNameStatus } from "../src/graph";

let fx: Fixture;
let env: Awaited<ReturnType<typeof startDaemon>>;
let c: Client;
let repo: RepoSummary;

beforeAll(async () => {
  fx = makeFixture();
  env = await startDaemon({ roots: [fx.root] });
  c = await Client.connect(env.wsUrl, bearer(env.token));
  repo = (await c.call<RepoSummary[]>("repos.list"))[0];
});
afterAll(async () => {
  c?.close();
  await env?.d.stop();
});

const mainWt = () => repo.worktrees.find((w) => w.isMain)!;

describe("server", () => {
  test("R-DAEMON-2: server.info and settings.get", async () => {
    const info = await c.call("server.info");
    expect(info).toMatchObject({ version: expect.any(String), protocol: 1, platform: "linux-x64", listen: `127.0.0.1:${env.d.port}` });
    expect(info.id).toBe(env.d.cfg.id);
    const s = await c.call("settings.get");
    expect(s.auth).toEqual({ enabled: true });
    expect(JSON.stringify(s)).not.toContain(env.token);
  });

  test("R-DAEMON-2: unknown method and bad JSON give errors", async () => {
    expect((await c.send("nope.nope")).error.code).toBe("bad_request");
    expect((await c.send("graph.get", { repoId: "000000000000" })).error.code).toBe("not_found");
  });
});

describe("discovery", () => {
  test("R-DAEMON-7: repos from roots with worktrees grouped under the main repo", () => {
    expect(repo.name).toBe("alpha");
    expect(repo.root).toBe(fx.root);
    expect(repo.worktrees.map((w) => w.path).sort()).toEqual([fx.repo, fx.worktree].sort());
    const wt = repo.worktrees.find((w) => !w.isMain)!;
    expect(wt.branch).toBe("feat2");
    expect(mainWt()).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 0, behind: 0, head: fx.hashes.c3 });
  });

  test("R-DAEMON-7: repos.add / repos.remove for an explicit repo outside roots", async () => {
    const other = join(tmp(), "beta");
    mkdirSync(other);
    g(other, "init", "-q");
    commit(other, "b", { "x.txt": "x" });
    let list = await c.call<RepoSummary[]>("repos.add", { path: other });
    expect(list.find((r) => r.path === other)?.root).toBeNull();
    expect((await c.send("repos.add", { path: tmp() })).error.code).toBe("bad_request");
    list = await c.call<RepoSummary[]>("repos.remove", { path: other });
    expect(list.some((r) => r.path === other)).toBe(false);
    // Removing a scanned repo excludes it; adding it back un-excludes it.
    list = await c.call<RepoSummary[]>("repos.remove", { path: fx.repo });
    expect(list.length).toBe(0);
    list = await c.call<RepoSummary[]>("repos.add", { path: fx.repo });
    expect(list.map((r) => r.id)).toEqual([repo.id]);
    await c.call("settings.update", { patch: { repos: [] } });
  });
});

describe("graph", () => {
  let snap: GraphSnapshot;
  beforeAll(async () => {
    snap = await c.call("graph.get", { repoId: repo.id });
  });

  test("R-GRAPH-1: graph.get has all commits, parents by index, all ref kinds", async () => {
    expect(snap.count).toBe(6);
    const details = await c.call("graph.details", { repoId: repo.id, graphId: snap.graphId, indices: [...Array(snap.count).keys()] });
    const idx = (h: string) => details.find((d: any) => d.hash === h).index;
    expect(snap.parents[idx(fx.hashes.merge)].sort()).toEqual([idx(fx.hashes.c2), idx(fx.hashes.f1)].sort());
    expect(snap.parents[idx(fx.hashes.c1)]).toEqual([]);
    for (let i = 0; i < snap.count; i++) for (const p of snap.parents[i]) expect(p).toBeGreaterThan(i);
    const refs = Object.fromEntries(snap.refs.map((r) => [r.full, r]));
    expect(refs.HEAD).toMatchObject({ kind: "head", commit: idx(fx.hashes.c3), worktrees: [fx.repo] });
    expect(refs["refs/heads/main"]).toMatchObject({ kind: "local", name: "main", worktrees: [fx.repo] });
    expect(refs["refs/heads/feat2"].worktrees).toEqual([fx.worktree]);
    expect(refs["refs/remotes/origin/main"]).toMatchObject({ kind: "remote", name: "origin/main" });
    // Annotated tag is peeled to its commit.
    expect(refs["refs/tags/v1.0"]).toMatchObject({ kind: "tag", commit: idx(fx.hashes.merge) });
  });

  test("R-GRAPH-6: graph.details returns lazy details; stale graphId is not_found", async () => {
    const [d] = await c.call("graph.details", { repoId: repo.id, graphId: snap.graphId, indices: [0] });
    expect(d).toMatchObject({ index: 0, hash: fx.hashes.c3, subject: "edit b", authorName: "Ada Agent", authorEmail: "ada@example.com" });
    expect(d.commitTime).toBe(snap.times[0]);
    expect((await c.send("graph.details", { repoId: repo.id, graphId: "deadbeef", indices: [0] })).error.code).toBe("not_found");
  });

  test("R-GRAPH-5: graph.filter by text, author, path, refs, date", async () => {
    const f = async (filter: object) => {
      const { indices } = await c.call("graph.filter", { repoId: repo.id, graphId: snap.graphId, filter });
      const d = await c.call("graph.details", { repoId: repo.id, graphId: snap.graphId, indices });
      return d.map((x: any) => x.subject).sort();
    };
    expect(await f({ text: "WORK" })).toEqual(["feature work", "main work"]);
    expect(await f({ author: "ADA@example" })).toHaveLength(6);
    expect(await f({ author: "nobody" })).toEqual([]);
    expect(await f({ text: "work", author: "ada" })).toEqual(["feature work", "main work"]);
    expect(await f({ path: "feature.txt" })).toEqual(["feature work"]);
    expect(await f({ path: "src" })).toEqual(["initial"]);
    expect(await f({ refs: ["refs/heads/feature"] })).toEqual(["feature work", "initial"]);
    expect(await f({ since: snap.times[1] })).toEqual(["edit b", "rename a to b"]);
    expect(await f({ until: snap.times[snap.count - 1] })).toEqual(["initial"]);
    expect((await c.send("graph.filter", { repoId: repo.id, graphId: snap.graphId, filter: { refs: ["--output=/tmp/x"] } })).error.code).toBe("bad_request");
  });

  test("R-GRAPH-6: commit.full has body, committer and parents", async () => {
    const full = await c.call("commit.full", { repoId: repo.id, hash: fx.hashes.merge });
    expect(full).toMatchObject({ subject: "Merge feature", committerName: "Ada Agent", parents: [fx.hashes.c2, fx.hashes.f1] });
    expect(full.index).toBeGreaterThanOrEqual(0);
    const body = commit(fx.worktree, "subject line\n\nbody line 1\nbody line 2", { "wt.txt": "w" });
    const f2 = await c.call("commit.full", { repoId: repo.id, hash: body });
    expect(f2.body).toBe("body line 1\nbody line 2");
    expect((await c.send("commit.full", { repoId: repo.id, hash: "HEAD" })).error.code).toBe("bad_request");
  });
});

describe("changes", () => {
  test("R-DIFF-1: commits.changes for one commit, a rename, and a root commit", async () => {
    const one = await c.call("commits.changes", { repoId: repo.id, hashes: [fx.hashes.c2] });
    expect(one.changes).toEqual([
      { path: "a.txt", status: "modified", before: { ref: fx.hashes.c1, path: "a.txt" }, after: { ref: fx.hashes.c2, path: "a.txt" } },
    ]);
    const ren = await c.call("commits.changes", { repoId: repo.id, hashes: [fx.hashes.rename] });
    expect(ren.changes[0]).toMatchObject({ path: "b.txt", oldPath: "a.txt", status: "renamed", before: { ref: fx.hashes.merge, path: "a.txt" } });
    const root = await c.call("commits.changes", { repoId: repo.id, hashes: [fx.hashes.c1] });
    expect(root.changes.map((x: FileChange) => [x.path, x.status, x.before])).toEqual([
      ["a.txt", "added", null],
      ["src/lib.ts", "added", null],
    ]);
    expect(root.truncated).toBe(false);
  });

  test("R-DIFF-1: multi-select matches zipChanges over per-commit changes, oldest first, renames chain", async () => {
    // Selected newest first and non-adjacent on purpose.
    const sel = [fx.hashes.c3, fx.hashes.c2, fx.hashes.rename];
    const res = await c.call("commits.changes", { repoId: repo.id, hashes: sel });
    const per = [fx.hashes.c2, fx.hashes.rename, fx.hashes.c3].map((h) => {
      const parent = g(fx.repo, "rev-parse", `${h}^`);
      return parseNameStatus(g(fx.repo, "diff-tree", "-r", "-M", "-z", "--name-status", "--no-commit-id", parent, h), parent, h);
    });
    expect(res.changes).toEqual(zipChanges(per));
    const b = res.changes.find((x: FileChange) => x.path === "b.txt");
    expect(b.before).toEqual({ ref: fx.hashes.c1, path: "a.txt" });
    expect(b.after).toEqual({ ref: fx.hashes.c3, path: "b.txt" });
  });
});

describe("local changes", () => {
  test("R-LOCAL-1: worktree.status covers modified, staged, added, deleted, renamed, untracked", async () => {
    const wt = mainWt();
    write(fx.repo, "b.txt", "changed\n");
    write(fx.repo, "staged.txt", "s\n");
    g(fx.repo, "add", "staged.txt");
    g(fx.repo, "mv", "src/lib.ts", "src/lib2.ts");
    g(fx.repo, "rm", "-q", "feature.txt");
    write(fx.repo, "new dir/untracked file.txt", "u\n");
    const { changes } = await c.call("worktree.status", { worktreeId: wt.id });
    const by = Object.fromEntries(changes.map((x: FileChange) => [x.path, x]));
    const head = fx.hashes.c3;
    expect(by["b.txt"]).toEqual({ path: "b.txt", status: "modified", before: { ref: head, path: "b.txt" }, after: { ref: "WORKTREE", path: "b.txt" }, staged: false });
    expect(by["staged.txt"]).toMatchObject({ status: "added", before: null, staged: true });
    expect(by["src/lib2.ts"]).toMatchObject({ status: "renamed", oldPath: "src/lib.ts", before: { ref: head, path: "src/lib.ts" }, staged: true });
    expect(by["feature.txt"]).toMatchObject({ status: "deleted", after: null, staged: true });
    expect(by["new dir/untracked file.txt"]).toMatchObject({ status: "untracked", before: null, after: { ref: "WORKTREE" } });
    const [summary] = (await c.call<RepoSummary[]>("repos.list"))[0].worktrees.filter((w) => w.isMain);
    expect(summary.counts).toEqual({ staged: 3, unstaged: 1, untracked: 1, conflicted: 0 });
    g(fx.repo, "reset", "-q", "--hard");
    g(fx.repo, "clean", "-qfd");
  });

  test("R-DIFF-6: file.diff reads commit, INDEX and WORKTREE sides", async () => {
    const wt = mainWt();
    write(fx.repo, "b.txt", "on disk\n");
    const r = await c.call("file.diff", {
      repoId: repo.id,
      worktreeId: wt.id,
      before: { ref: fx.hashes.c3, path: "b.txt" },
      after: { ref: "WORKTREE", path: "b.txt" },
    });
    expect(r.before).toEqual({ binary: false, size: 14, text: "one\ntwo\nthree\n" });
    expect(r.after.text).toBe("on disk\n");
    const idx = await c.call("file.diff", { repoId: repo.id, worktreeId: wt.id, before: { ref: "INDEX", path: "b.txt" }, after: null });
    expect(idx.before.text).toBe("one\ntwo\nthree\n");
    expect(idx.after).toBeNull();
    const missing = await c.call("file.diff", { repoId: repo.id, worktreeId: wt.id, before: { ref: fx.hashes.c1, path: "nope" }, after: { ref: "WORKTREE", path: "nope" } });
    expect(missing).toEqual({ before: null, after: null });
    expect((await c.send("file.diff", { repoId: repo.id, before: null, after: { ref: "WORKTREE", path: "b.txt" } })).result).toBeTruthy();
    g(fx.repo, "checkout", "-q", "--", "b.txt");
  });

  test("R-DIFF-6: file.diff rejects paths escaping the worktree", async () => {
    const wt = mainWt();
    const outside = tmp();
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(fx.repo, "linkdir"));
    symlinkSync(join(outside, "secret.txt"), join(fx.repo, "link.txt"));
    const bad = async (path: string) => (await c.send("file.diff", { repoId: repo.id, worktreeId: wt.id, before: null, after: { ref: "WORKTREE", path } })).error?.code;
    expect(await bad("../../../etc/passwd")).toBe("bad_request");
    expect(await bad("/etc/passwd")).toBe("bad_request");
    expect(await bad("src/../../x")).toBe("bad_request");
    expect(await bad("linkdir/secret.txt")).toBe("bad_request");
    // A symlink file shows its target like git does, never the content behind it.
    const link = await c.call("file.diff", { repoId: repo.id, worktreeId: wt.id, before: null, after: { ref: "WORKTREE", path: "link.txt" } });
    expect(link.after.text).toBe(join(outside, "secret.txt"));
    expect((await c.send("file.diff", { repoId: repo.id, worktreeId: wt.id, before: { ref: "--output=x", path: "a" }, after: null })).error.code).toBe("bad_request");
    Bun.spawnSync(["rm", join(fx.repo, "linkdir"), join(fx.repo, "link.txt")]);
  });

  test("R-DIFF-6: binary and tooLarge placeholders", async () => {
    const wt = mainWt();
    write(fx.repo, "bin.dat", new Uint8Array([1, 2, 0, 3]));
    write(fx.repo, "big.txt", "x".repeat(5 * 1024 * 1024 + 1));
    const r = await c.call("file.diff", { repoId: repo.id, worktreeId: wt.id, before: { ref: "WORKTREE", path: "bin.dat" }, after: { ref: "WORKTREE", path: "big.txt" } });
    expect(r.before).toEqual({ binary: true, size: 4 });
    expect(r.after).toEqual({ binary: false, size: 5 * 1024 * 1024 + 1, tooLarge: true });
    g(fx.repo, "add", "bin.dat", "big.txt");
    const idx = await c.call("file.diff", { repoId: repo.id, worktreeId: wt.id, before: { ref: "INDEX", path: "bin.dat" }, after: { ref: "INDEX", path: "big.txt" } });
    expect(idx.before.binary).toBe(true);
    expect(idx.after.tooLarge).toBe(true);
    g(fx.repo, "rm", "-q", "--cached", "bin.dat", "big.txt");
    Bun.spawnSync(["rm", join(fx.repo, "bin.dat"), join(fx.repo, "big.txt")]);
  });

  test("R-LOCAL-3: worktree.commit (selected paths, amend), push, fetch, pull against the bare remote", async () => {
    const wt = mainWt();
    write(fx.repo, "one.txt", "1\n");
    write(fx.repo, "two.txt", "2\n");
    const { hash } = await c.call("worktree.commit", { worktreeId: wt.id, message: "add one", paths: ["one.txt"] });
    expect(g(fx.repo, "rev-parse", "HEAD")).toBe(hash);
    expect(g(fx.repo, "status", "--porcelain")).toBe("?? two.txt");
    const amended = await c.call("worktree.commit", { worktreeId: wt.id, message: "add one and two", paths: [], amend: true });
    expect(g(fx.repo, "log", "-1", "--format=%s %P", amended.hash)).toBe(`add one and two ${fx.hashes.c3}`);
    expect((await c.send("worktree.commit", { worktreeId: wt.id, message: " ", paths: [] })).error.code).toBe("bad_request");

    const push = await c.call("worktree.push", { worktreeId: wt.id });
    expect(push.output).toContain("main -> main");
    expect(g(fx.remote, "rev-parse", "main")).toBe(amended.hash);

    // Linked worktree without upstream: push -u origin HEAD.
    const feat = repo.worktrees.find((w) => !w.isMain)!;
    await c.call("worktree.push", { worktreeId: feat.id });
    expect(g(fx.worktree, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/feat2");

    // Someone else pushes; fetch then pull.
    const other = join(tmp(), "clone");
    g(fx.base, "clone", "-q", fx.remote, other);
    const theirs = commit(other, "from elsewhere", { "else.txt": "e\n" });
    g(other, "push", "-q", "origin", "main");
    await c.call("repo.fetch", { repoId: repo.id });
    expect(g(fx.repo, "rev-parse", "origin/main")).toBe(theirs);
    const pull = await c.call("worktree.pull", { worktreeId: wt.id });
    expect(pull.output).toMatch(/Fast-forward|Updating/);
    expect(g(fx.repo, "rev-parse", "HEAD")).toBe(theirs);
    const failed = await c.send("worktree.pull", { worktreeId: wt.id, extra: 1 });
    expect(failed.result.output).toContain("Already up to date");
  });
});

describe("live updates", () => {
  test("R-GRAPH-7 R-DAEMON-8: a commit by an agent sends graph.changed", async () => {
    await c.call("subscribe", { topics: [`repo:${repo.id}`] });
    await Bun.sleep(300);
    c.events = [];
    const before = (await c.call("graph.get", { repoId: repo.id })).graphId;
    commit(fx.worktree, "agent commit", { "agent.txt": "a" });
    const ev = await c.waitEvent("graph.changed", (e) => e.repoId === repo.id);
    expect(ev.graphId).not.toBe(before);
    expect((await c.call("graph.get", { repoId: repo.id })).graphId).toBe(ev.graphId);
    await c.call("unsubscribe", { topics: [`repo:${repo.id}`] });
  });

  test("R-LOCAL-1 R-DAEMON-8: editing files sends worktree.changed, also for an already modified file", async () => {
    const wt = mainWt();
    await c.call("subscribe", { topics: [`worktree:${wt.id}`] });
    await Bun.sleep(300);
    c.events = [];
    write(fx.repo, "b.txt", "edit 1\n");
    const ev = await c.waitEvent("worktree.changed", (e) => e.id === wt.id);
    expect(ev.counts.unstaged).toBe(1);
    await Bun.sleep(300);
    c.events = [];
    write(fx.repo, "b.txt", "edit 2 longer\n");
    await c.waitEvent("worktree.changed", (e) => e.id === wt.id);
    // No change, no event.
    c.events = [];
    await Bun.sleep(700);
    expect(c.events.filter((e) => e.event === "worktree.changed")).toEqual([]);
    g(fx.repo, "checkout", "-q", "--", "b.txt");
    expect((await c.send("subscribe", { topics: ["bogus"] })).error.code).toBe("bad_request");
  });

  test("R-DAEMON-7 R-DAEMON-8: a new repo in a root sends repos.changed", async () => {
    await c.call("subscribe", { topics: ["repos"] });
    await Bun.sleep(300);
    c.events = [];
    const fresh = join(fx.root, "gamma");
    mkdirSync(fresh);
    g(fresh, "init", "-q");
    const ev = await c.waitEvent("repos.changed", (list) => list.some((r) => r.name === "gamma"), 12_000);
    expect(ev.find((r) => r.name === "gamma")!.root).toBe(fx.root);
  }, 15_000);

  test("R-DAEMON-6: settings.update persists and broadcasts settings.changed", async () => {
    c.events = [];
    const r = await c.call("settings.update", { patch: { name: "box", scanDepth: 2 } });
    expect(r).toMatchObject({ restartRequired: false, settings: { name: "box", scanDepth: 2 } });
    expect((await c.waitEvent("settings.changed")).name).toBe("box");
    expect(env.d.cfg.settings.name).toBe("box");
    expect((await c.send("settings.update", { patch: { port: "x" } })).error.code).toBe("bad_request");
    expect((await c.send("settings.update", { patch: { nope: 1 } })).error.code).toBe("bad_request");
  });
});
