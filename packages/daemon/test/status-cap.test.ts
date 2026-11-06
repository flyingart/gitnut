import { expect, test } from "bun:test";
import { MAX_CHANGES, parseStatus } from "../src/status";

test("R-LOCAL-1: status lists at most MAX_CHANGES paths but keeps exact counts", () => {
  const out = Array.from({ length: MAX_CHANGES + 10 }, (_, i) => `? f${i}.txt`).join("\0");
  const p = parseStatus(`# branch.oid ${"a".repeat(40)}\0# branch.head main\0${out}\0`);
  expect(p.changes.length).toBe(MAX_CHANGES);
  expect(p.counts.untracked).toBe(MAX_CHANGES + 10);
  expect(p.truncated).toBe(true);
});
