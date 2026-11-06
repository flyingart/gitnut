import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { GraphCache } from "../src/graph";
import type { Repo } from "../src/repos";
import { commit, g, tmp } from "./helpers";

test("R-GRAPH-1: agent checkpoint refs (refs/jean, refs/t3) are hidden unless hideInternalRefs is off", async () => {
  const path = join(tmp(), "agent");
  mkdirSync(path);
  g(path, "init", "-q", "-b", "main");
  commit(path, "work", { "a.txt": "1\n" });
  // Jean / T3 Code keep snapshots of an agent turn as commits behind private refs.
  const snap = g(path, "commit-tree", "-p", "HEAD", "-m", "jean-checkpoint-end:abc", "HEAD^{tree}");
  g(path, "update-ref", "refs/jean/checkpoints/abc/end", snap);
  g(path, "update-ref", "refs/t3/orchestration-v2/checkpoints/x/ordinal/0", snap);
  const repo = { id: "r", path } as Repo;

  let hide = true;
  const cache = new GraphCache(() => hide);
  const hidden = await cache.get(repo);
  expect(hidden.count).toBe(1);
  expect(hidden.refs.map((r) => r.full).sort()).toEqual(["HEAD", "refs/heads/main"]);
  // A new checkpoint does not change the graph id, so clients don't reload for it.
  g(path, "update-ref", "refs/jean/checkpoints/def/end", snap);
  expect((await cache.state(repo)).graphId).toBe(hidden.graphId);

  hide = false;
  const shown = await cache.get(repo);
  expect(shown.count).toBe(2);
  expect(shown.graphId).not.toBe(hidden.graphId);
});
