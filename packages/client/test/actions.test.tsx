import { expect, test } from "bun:test";
import type { RefInfo } from "@gitnut/commons";
import { commitMenuItems, refMenuItems, type CommitMenuHandlers, type RefMenuHandlers } from "../src/actions";
import { checkRefName, createToastStore } from "../src/overlays";
import type { MenuItem } from "../src/ui";

const noop = () => {};
const commitH: CommitMenuHandlers = { copy: noop, checkout: noop, newBranch: noop, newTag: noop, cherryPick: noop, revert: noop, reset: noop };
const refH: RefMenuHandlers = { copy: noop, checkout: noop, newBranch: noop, merge: noop, rebase: noop, push: noop, remove: noop };
/** label -> enabled, separators dropped */
const state = (items: MenuItem[]) => Object.fromEntries(items.filter((i) => i !== "separator").map((i) => [i.label, !i.disabled]));

test("R-ACT-2: commit menu: single-commit items are off for a multi-selection, worktree items off without a worktree", () => {
  const one = state(commitMenuItems([{ hash: "a".repeat(40), subject: "s" }], true, commitH));
  expect(one).toEqual({
    "Copy revision number": true,
    "Copy subject": true,
    "Checkout revision": true,
    "New branch…": true,
    "New tag…": true,
    "Cherry-pick": true,
    "Revert commit": true,
    "Reset current branch to here…": true,
  });
  const multi = state(commitMenuItems([{ hash: "a".repeat(40), subject: "s" }, { hash: "b".repeat(40), subject: "t" }], true, commitH));
  expect(multi).toMatchObject({ "Copy 2 revision numbers": true, "Checkout revision": false, "New branch…": false, "New tag…": false, "Cherry-pick 2 commits": true, "Revert 2 commits": true, "Reset current branch to here…": false });
  const bare = state(commitMenuItems([{ hash: "a".repeat(40), subject: "s" }], false, commitH));
  expect(bare).toMatchObject({ "Checkout revision": false, "New branch…": true, "Cherry-pick": false, "Revert commit": false, "Reset current branch to here…": false });
});

test("R-ACT-2: cherry-pick gets the whole selection", () => {
  let got: string[] = [];
  const items = commitMenuItems([{ hash: "a1", subject: "x" }, { hash: "b2", subject: "y" }], true, { ...commitH, cherryPick: (h) => (got = h) });
  const pick = items.find((i) => i !== "separator" && i.label.startsWith("Cherry-pick"));
  (pick as Exclude<MenuItem, "separator">).onSelect!();
  expect(got).toEqual(["a1", "b2"]);
});

const ref = (r: Partial<RefInfo>): RefInfo => ({ name: "feature", full: "refs/heads/feature", kind: "local", commit: 0, worktrees: [], ...r });

test("R-ACT-3: ref menu: current branch, branch checked out elsewhere, remote, tag, HEAD", () => {
  const wt = { path: "/w/main", branch: "main" };
  expect(state(refMenuItems(ref({}), wt, refH))).toMatchObject({ Checkout: true, "Merge 'feature' into 'main'": true, "Rebase 'main' onto 'feature'": true, "Push 'feature'": true, "Delete 'feature'…": true });
  expect(state(refMenuItems(ref({ name: "main", full: "refs/heads/main", worktrees: ["/w/main"] }), wt, refH))).toMatchObject({ Checkout: false, "Merge 'main' into 'main'": false, "Delete 'main'…": false });
  expect(state(refMenuItems(ref({ worktrees: ["/w/other"] }), wt, refH))).toMatchObject({ Checkout: false, "Merge 'feature' into 'main'": true, "Delete 'feature'…": false });
  const remote = state(refMenuItems(ref({ name: "origin/x", full: "refs/remotes/origin/x", kind: "remote" }), wt, refH));
  expect(remote).toMatchObject({ "Checkout as new local branch": true, "Delete 'origin/x' on the remote…": true });
  expect(Object.keys(remote).some((k) => k.startsWith("Push"))).toBe(false);
  expect(state(refMenuItems(ref({ name: "v1", full: "refs/tags/v1", kind: "tag" }), wt, refH))).toMatchObject({ Checkout: true, "Delete tag 'v1'…": true });
  const head = state(refMenuItems(ref({ name: "HEAD", full: "HEAD", kind: "head", worktrees: ["/w/main"] }), wt, refH));
  expect(head).toMatchObject({ Checkout: false, "New branch from 'HEAD'…": true });
  expect(Object.keys(head).some((k) => k.startsWith("Delete"))).toBe(false);
  expect(state(refMenuItems(ref({}), null, refH))).toMatchObject({ Checkout: false, "Merge 'feature' into 'HEAD'": false, "New branch from 'feature'…": true });
});

test("R-ACT-5: toast store keeps errors, auto-closes the rest, caps the stack", async () => {
  const s = createToastStore({ max: 3, ttl: 30 });
  let calls = 0;
  s.subscribe(() => calls++);
  const err = s.push({ kind: "error", title: "Merge failed", output: "CONFLICT" });
  s.push({ kind: "success", title: "Fetched" });
  expect(s.get().map((t) => t.title)).toEqual(["Merge failed", "Fetched"]);
  await Bun.sleep(60);
  expect(s.get().map((t) => t.title)).toEqual(["Merge failed"]);
  for (const n of [1, 2, 3]) s.push({ kind: "error", title: `e${n}` });
  expect(s.get().map((t) => t.title)).toEqual(["e1", "e2", "e3"]);
  s.dismiss(err); // already dropped: no-op
  s.dismiss(s.get()[0].id);
  expect(s.get().map((t) => t.title)).toEqual(["e2", "e3"]);
  expect(calls).toBe(7);
});

test("checkRefName follows git check-ref-format for common mistakes", () => {
  for (const ok of ["main", "feature/dark-mode", "fix-1.2", "agent/claude_x"]) expect(checkRefName(ok)).toBeNull();
  for (const bad of ["", "a b", "-x", "a..b", "a~1", "x^", "a:b", "a/", "/a", "a//b", ".hidden", "a/.b", "x.lock", "a.", "@", "a@{1}", "a\\b", "q?"]) expect(checkRefName(bad)).not.toBeNull();
});
