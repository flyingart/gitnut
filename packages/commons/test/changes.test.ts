import { describe, expect, test } from "bun:test";
import { zipChanges, type FileChange } from "../src";

const side = (ref: string, path: string) => ({ ref, path });
const add = (path: string, c: string): FileChange => ({ path, status: "added", before: null, after: side(c, path) });
const mod = (path: string, p: string, c: string): FileChange => ({ path, status: "modified", before: side(p, path), after: side(c, path) });
const del = (path: string, p: string): FileChange => ({ path, status: "deleted", before: side(p, path), after: null });
const ren = (from: string, to: string, p: string, c: string): FileChange => ({
  path: to,
  oldPath: from,
  status: "renamed",
  before: side(p, from),
  after: side(c, to),
});

describe("R-DIFF-1: zipChanges (CommittedChangesTreeBrowser.zipChanges)", () => {
  test("R-DIFF-1: one commit is returned as is", () => {
    const changes = [mod("a", "p", "c1"), add("b", "c1")];
    expect(zipChanges([changes])).toEqual(changes);
  });

  test("R-DIFF-1: non-adjacent selection: before of the first commit, after of the last one", () => {
    // commits c1 and c3 selected, c2 (not selected) touched other files
    expect(zipChanges([[mod("a", "c0", "c1"), mod("x", "c0", "c1")], [mod("a", "c2", "c3")]])).toEqual([
      mod("a", "c0", "c3"),
      mod("x", "c0", "c1"),
    ]);
  });

  test("R-DIFF-1: renames chain a -> b -> c", () => {
    expect(zipChanges([[ren("a", "b", "c0", "c1")], [ren("b", "c", "c1", "c2")]])).toEqual([ren("a", "c", "c0", "c2")]);
  });

  test("R-DIFF-1: rename then modify keeps the rename", () => {
    expect(zipChanges([[ren("a", "b", "c0", "c1")], [mod("b", "c1", "c2")]])).toEqual([ren("a", "b", "c0", "c2")]);
  });

  test("R-DIFF-1: renamed back is a modification", () => {
    expect(zipChanges([[ren("a", "b", "c0", "c1")], [ren("b", "a", "c1", "c2")]])).toEqual([mod("a", "c0", "c2")]);
  });

  test("R-DIFF-1: add then modify = add", () => {
    expect(zipChanges([[add("a", "c1")], [mod("a", "c1", "c2")]])).toEqual([add("a", "c2")]);
  });

  test("R-DIFF-1: modify then delete = delete", () => {
    expect(zipChanges([[mod("a", "c0", "c1")], [del("a", "c1")]])).toEqual([del("a", "c0")]);
  });

  test("R-DIFF-1: add then delete = gone", () => {
    expect(zipChanges([[add("a", "c1"), add("b", "c1")], [del("a", "c1")]])).toEqual([add("b", "c1")]);
  });

  test("R-DIFF-1: deletions are placed at their path", () => {
    expect(zipChanges([[mod("a", "c0", "c1"), del("z", "c0")], [mod("b", "c1", "c2")]])).toEqual([
      mod("a", "c0", "c1"),
      mod("b", "c1", "c2"),
      del("z", "c0"),
    ]);
  });

  test("R-DIFF-1: IntelliJ collision case 'delete a' then 'new a' keeps both", () => {
    expect(zipChanges([[del("a", "c0")], [add("a", "c1")]])).toEqual([add("a", "c1"), del("a", "c0")]);
  });

  test("R-DIFF-1: a copy does not consume its source; copy then modify stays a copy", () => {
    const copy: FileChange = { path: "b", oldPath: "a", status: "copied", before: side("c0", "a"), after: side("c1", "b") };
    expect(zipChanges([[mod("a", "c0", "c1"), copy], [mod("b", "c1", "c2")]])).toEqual([
      mod("a", "c0", "c1"),
      { path: "b", oldPath: "a", status: "copied", before: side("c0", "a"), after: side("c2", "b") },
    ]);
  });
});
