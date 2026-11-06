import { expect, test } from "bun:test";
import { parseWorktreeList } from "../src/repos";

const entries = [
  { path: "E:/Projects/acme", head: "c8149653ae3b4b32c8c64d3e053969f2a7e87ec5", branch: "refs/heads/master", bare: false, prunable: false },
  { path: "E:/wt/acme feat", head: "a".repeat(40), branch: null, bare: false, prunable: true },
];

test("R-DAEMON-7: worktree lists parse with and without -z, and with Windows line ends (git < 2.36)", () => {
  const plain = `worktree E:/Projects/acme\nHEAD ${entries[0].head}\nbranch refs/heads/master\n\nworktree E:/wt/acme feat\nHEAD ${"a".repeat(40)}\ndetached\nprunable gitdir file points to non-existent location\n\n`;
  expect(parseWorktreeList(plain)).toEqual(entries);
  expect(parseWorktreeList(plain.replace(/\n/g, "\r\n"))).toEqual(entries);
  expect(parseWorktreeList(plain.replace(/\n/g, "\0"))).toEqual(entries);
});
