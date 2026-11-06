import { expect, test } from "bun:test";
import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { lineBlocks, lineFirstDiff } from "../src/diff/lineDiff";

const doc = (n: number, edits: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => edits[i] ?? `line ${i} with some long padding text so the file is big ${"x".repeat(60)}`).join("\n");

test("R-DIFF-4: distant edits in a big file stay separate chunks (line-first diff)", () => {
  const a = doc(400);
  const b = doc(400, { 26: "changed line 26", 64: "changed line 64" });
  const chunks = Chunk.build(Text.of(a.split("\n")), Text.of(b.split("\n")), { override: (x, y) => lineFirstDiff(x, y) });
  expect(chunks.length).toBe(2);
  const lines = (pos: number) => a.slice(0, pos).split("\n").length;
  expect(lines(chunks[0].fromA)).toBe(27);
  expect(lines(chunks[1].fromA)).toBe(65);
});

test("R-DIFF-4: line blocks for inserts, deletes and replacements", () => {
  expect(lineBlocks([1, 2, 3], [1, 2, 3])).toEqual([]);
  expect(lineBlocks([1, 2, 3], [1, 9, 2, 3])).toEqual([[1, 1, 1, 2]]);
  expect(lineBlocks([1, 2, 3], [1, 3])).toEqual([[1, 2, 1, 1]]);
  expect(lineBlocks([1, 2, 3, 4, 5], [1, 7, 3, 8, 5])).toEqual([[1, 2, 1, 2], [3, 4, 3, 4]]);
  expect(lineBlocks([], [1])).toEqual([[0, 0, 0, 1]]);
});

test("R-DIFF-4: ignore whitespace drops indentation-only changes", () => {
  expect(lineFirstDiff("a\n  b\nc", "a\n\tb\nc", true)).toEqual([]);
  expect(lineFirstDiff("a\n  b\nc", "a\n\tb\nc", false).length).toBeGreaterThan(0);
});

test("R-DIFF-4: word-level changes inside a modified line", () => {
  const ch = lineFirstDiff("keep\nfoo bar baz\nkeep", "keep\nfoo qux baz\nkeep");
  expect(ch.length).toBe(1);
  expect("keep\nfoo bar baz\nkeep".slice(ch[0].fromA, ch[0].toA)).toBe("bar");
});

test("R-DIFF-4: changes stay inside both texts and rebuild the new text (also without final newlines)", () => {
  // tiny deterministic PRNG so failures reproduce
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  const doc = () => Array.from({ length: rnd(6) }, () => "abc"[rnd(3)].repeat(1 + rnd(2))).join("\n") + (rnd(2) ? "\n" : "");
  const cases: [string, string][] = [["a\nb", "a\nb\nc"], ["a\nb\nc", "a"], ["a", "a\nb\nc"], ["", "x"], ["x", ""]];
  for (let i = 0; i < 400; i++) cases.push([doc(), doc()]);
  for (const [a, b] of cases) {
    let out = "";
    let pos = 0;
    for (const c of lineFirstDiff(a, b)) {
      expect(c.fromA >= pos && c.fromA <= c.toA && c.toA <= a.length && c.fromB <= c.toB && c.toB <= b.length).toBe(true);
      out += a.slice(pos, c.fromA) + b.slice(c.fromB, c.toB);
      pos = c.toA;
    }
    expect(out + a.slice(pos)).toBe(b);
  }
});
