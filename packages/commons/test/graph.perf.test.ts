import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildGraph, type GraphInput, type RefInfo, type SortType } from "../src";

/** Deterministic history in `git log --date-order` order: many branches forking, committing and merging back. */
function syntheticHistory(n: number, seed = 42): GraphInput {
  let s = seed;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const chronoParents: number[][] = [];
  const tips: number[] = []; // tips[0] is main
  const names: string[] = [];
  let branchNo = 0;
  for (let k = 0; k < n; k++) {
    if (k === 0) {
      chronoParents.push([]);
      tips.push(0);
      names.push("main");
      continue;
    }
    const r = rnd();
    if (r < 0.03 && tips.length < 80) {
      // fork a new branch from a random tip
      chronoParents.push([tips[Math.floor(rnd() * tips.length)]]);
      tips.push(k);
      names.push(`feature/${++branchNo}`);
    } else if (r < 0.06 && tips.length > 1) {
      // merge a branch into main
      const b = 1 + Math.floor(rnd() * (tips.length - 1));
      chronoParents.push([tips[0], tips[b]]);
      tips[0] = k;
      tips.splice(b, 1);
      names.splice(b, 1);
    } else {
      const b = rnd() < 0.4 ? 0 : Math.floor(rnd() * tips.length);
      chronoParents.push([tips[b]]);
      tips[b] = k;
    }
  }
  const idx = (k: number) => n - 1 - k;
  const parents = Array.from({ length: n }, (_, i) => chronoParents[n - 1 - i].map(idx));
  const times = Array.from({ length: n }, (_, i) => 1_600_000_000 + (n - 1 - i) * 600);
  const refs: RefInfo[] = tips.map((t, i) => ({
    name: names[i],
    full: `refs/heads/${names[i]}`,
    kind: "local",
    commit: idx(t),
    worktrees: [],
  }));
  refs.push({ name: "HEAD", full: "HEAD", kind: "head", commit: idx(tips[0]), worktrees: [] });
  refs.push({ name: "origin/main", full: "refs/remotes/origin/main", kind: "remote", commit: idx(tips[0]), worktrees: [] });
  return { parents, times, refs };
}

function measure(input: GraphInput, sort: SortType) {
  const t0 = performance.now();
  const g = buildGraph(input, { sort });
  const build = performance.now() - t0;
  const t1 = performance.now();
  const start = Math.floor(g.rowCount / 2);
  let elements = 0;
  for (let r = start; r < start + 100; r++) elements += g.printElements(r).length;
  const rows = performance.now() - t1;
  return { g, build, rows, elements };
}

const fmt = (ms: number) => `${ms.toFixed(0)} ms`;

describe("R-GRAPH-4: performance", () => {
  test("R-GRAPH-4: 50 000 synthetic commits build in < 1.5 s, 100 rows of print elements are fast", () => {
    const input = syntheticHistory(50_000);
    const merges = input.parents.filter((p) => p.length > 1).length;
    for (const sort of ["intellij", "date", "topological"] as const) {
      const { g, build, rows, elements } = measure(input, sort);
      console.log(`synthetic 50k (${merges} merges, ${input.refs!.length} refs) sort=${sort}: build ${fmt(build)}, 100 rows ${fmt(rows)} (${elements} elements), width ${g.recommendedWidth}`);
      expect(g.rowCount).toBe(50_000);
      expect(build).toBeLessThan(1500);
      expect(rows).toBeLessThan(200);
    }
    // filtered view: every 3rd commit
    const visible = new Set(input.parents.map((_, i) => i).filter((i) => i % 3 === 0));
    const t0 = performance.now();
    const g = buildGraph({ ...input, visible });
    const filtered = performance.now() - t0;
    let dashed = 0;
    for (let r = 0; r < 100; r++) dashed += g.printElements(r).filter((e) => e.type === "edge" && e.style === "dashed").length;
    console.log(`synthetic 50k filtered to ${visible.size}: build ${fmt(filtered)}, dashed half-edges in 100 rows: ${dashed}`);
    expect(g.rowCount).toBe(visible.size);
    expect(dashed).toBeGreaterThan(0);
  });

  // bare clone of git/git in $GITNUT_FIXTURES (see scripts/screenshots.ts); skipped without it
  const GIT_GIT = join(process.env.GITNUT_FIXTURES ?? join(import.meta.dir, "..", "..", "..", ".cache", "fixtures"), "git.git");
  test.skipIf(!existsSync(GIT_GIT))("R-GRAPH-4: real repository (git.git, all refs)", () => {
    const t0 = performance.now();
    const log = Bun.spawnSync(["git", "--git-dir", GIT_GIT, "log", "--all", "--date-order", "--format=%H %P %ct"]).stdout.toString();
    const refsOut = Bun.spawnSync(["git", "--git-dir", GIT_GIT, "for-each-ref", "--format=%(refname) %(objectname) %(*objectname)"]).stdout.toString();
    const gitMs = performance.now() - t0;

    const t1 = performance.now();
    const lines = log.trimEnd().split("\n");
    const index = new Map<string, number>();
    lines.forEach((l, i) => index.set(l.slice(0, 40), i));
    const parents: number[][] = [];
    const times: number[] = [];
    for (const l of lines) {
      const parts = l.split(" ");
      times.push(Number(parts[parts.length - 1]));
      parents.push(parts.slice(1, -1).map((h) => index.get(h) ?? -1));
    }
    const refs: RefInfo[] = [];
    for (const l of refsOut.trimEnd().split("\n")) {
      const [full, obj, peeled] = l.split(" ");
      const commit = index.get(peeled || obj);
      if (commit === undefined) continue;
      const kind = full.startsWith("refs/tags/") ? "tag" : full.startsWith("refs/remotes/") ? "remote" : "local";
      refs.push({ name: full.replace(/^refs\/(heads|remotes|tags)\//, ""), full, kind, commit, worktrees: [] });
    }
    const parseMs = performance.now() - t1;

    const input: GraphInput = { parents, times, refs };
    for (const sort of ["intellij", "date"] as const) {
      const { g, build, rows, elements } = measure(input, sort);
      console.log(
        `git.git ${g.rowCount} commits, ${refs.length} refs sort=${sort}: git ${fmt(gitMs)}, parse ${fmt(parseMs)}, build ${fmt(build)}, 100 rows ${fmt(rows)} (${elements} elements), width ${g.recommendedWidth}`,
      );
      expect(g.rowCount).toBe(lines.length);
      expect(build).toBeLessThan(3000);
    }
  }, 120_000);
});
