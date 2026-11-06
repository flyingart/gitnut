import { describe, expect, test } from "bun:test";
import type { FileChange } from "@gitnut/commons";
import { buildChangesTree, changesFromList, containerIds, filesOf, flattenTree, type ChangeItem } from "../src/tree";

const ch = (path: string, status: FileChange["status"] = "modified"): FileChange => ({ path, status, before: { ref: "a", path }, after: { ref: "b", path } });
const names = (rows: ReturnType<typeof flattenTree>) => rows.map((r) => `${"  ".repeat(r.depth)}${r.node.name}${r.node.kind !== "file" ? ` (${r.node.fileCount})` : ""}`);

describe("changes tree", () => {
  test("R-DIFF-2: nests by folder, compacts single-child folders, counts files", () => {
    const items = changesFromList([ch("src/main/kotlin/App.kt"), ch("src/main/kotlin/util/Str.kt"), ch("src/test/AppTest.kt"), ch("README.md")]);
    const rows = flattenTree(buildChangesTree(items, "tree"), new Set());
    expect(names(rows)).toEqual([
      "src (3)",
      "  main/kotlin (2)",
      "    util (1)",
      "      Str.kt",
      "    App.kt",
      "  test (1)",
      "    AppTest.kt",
      "README.md",
    ]);
  });

  test("R-DIFF-2: a whole chain of single folders compacts into one node", () => {
    const rows = flattenTree(buildChangesTree(changesFromList([ch("a/b/c/d.txt"), ch("a/b/c/e.txt")])), new Set());
    expect(names(rows)).toEqual(["a/b/c (2)", "  d.txt", "  e.txt"]);
  });

  test("R-DIFF-2: flat mode lists files with their folder", () => {
    const roots = buildChangesTree(changesFromList([ch("src/x/b.ts"), ch("a.ts"), ch("src/c.ts")]), "flat");
    const rows = flattenTree(roots, new Set());
    expect(rows.map((r) => [r.node.name, r.node.dir ?? ""])).toEqual([
      ["a.ts", ""],
      ["b.ts", "src/x"],
      ["c.ts", "src"],
    ]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  test("R-LOCAL-2: groups (server → repo → worktree) sit above the folders", () => {
    const g = (wt: string) => [
      { id: "s", label: "box", kind: "server" as const },
      { id: "r", label: "repo", kind: "repo" as const },
      { id: wt, label: wt, kind: "worktree" as const },
    ];
    const items: ChangeItem[] = [
      { key: "1", change: ch("src/a.ts"), groups: g("main") },
      { key: "2", change: ch("b.ts"), groups: g("feat") },
    ];
    expect(names(flattenTree(buildChangesTree(items), new Set()))).toEqual(["box (2)", "  repo (2)", "    main (1)", "      src (1)", "        a.ts", "    feat (1)", "      b.ts"]);
  });

  test("collapsing hides children; container ids and file order", () => {
    const roots = buildChangesTree(changesFromList([ch("src/a.ts"), ch("src/b.ts"), ch("z.ts")]));
    expect(containerIds(roots)).toEqual(["d:src/"]);
    expect(names(flattenTree(roots, new Set(["d:src/"])))).toEqual(["src (2)", "z.ts"]);
    expect(filesOf(roots).map((i) => i.key)).toEqual(["src/a.ts", "src/b.ts", "z.ts"]);
  });
});
