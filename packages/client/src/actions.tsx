// Git actions for the UI (R-ACT): `useGitAction` runs one daemon action with busy state and a toast; the menu
// builders turn a commit selection, a ref or changed files into context-menu items (pure, unit-tested); the
// hooks wire those items to confirm / prompt dialogs and the daemon.
import { useCallback, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CircleDot, Copy, Eraser, GitBranchPlus, GitCommitHorizontal, GitMerge, GitPullRequestArrow, EyeOff, RotateCcw, Tag, Trash2, Undo2, Cherry } from "lucide-react";
import type { CommitDetails, Method, ParamsOf, RefInfo, RepoSummary, ResultOf, WorktreeSummary } from "@gitnut/commons";
import type { GitnutRpcError } from "./connection";
import { useRepos } from "./hooks";
import { checkRefName, confirmAction, promptAction, toasts, type ConfirmSpec } from "./overlays";
import { resolveConnection, useConnection, useServers, type ServerProp } from "./provider";
import type { ChangeItem } from "./tree";
import { copyText, shortHash, worktreeFolder, worktreeLabel, type MenuItem } from "./ui";

/** Options of one {@link useGitAction} run. */
export interface GitActionOptions<R> {
  /** Short name for the busy state and the toast: "Fetch", "Cherry-pick". */
  label: string;
  /** Ask first (destructive actions). */
  confirm?: ConfirmSpec;
  /** Toast title on success. Default "<label> finished". */
  success?: string | ((result: R) => string);
  /** Run on another server than the hook's. */
  server?: ServerProp;
}

/**
 * Run daemon actions with a busy state and a toast with the git output (errors and aborted conflicts too).
 * `run` resolves the result, or undefined when cancelled or failed.
 */
export function useGitAction(server?: ServerProp) {
  const { servers } = useServers();
  const base = useConnection(server);
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <M extends Method>(method: M, params: ParamsOf<M>, opts: GitActionOptions<ResultOf<M>>): Promise<ResultOf<M> | undefined> => {
      const conn = opts.server !== undefined ? resolveConnection(servers, opts.server) : base;
      if (!conn) return undefined;
      if (opts.confirm && !(await confirmAction(opts.confirm))) return undefined;
      setBusy(opts.label);
      try {
        const r = await (conn.call as (m: M, p: ParamsOf<M>) => Promise<ResultOf<M>>)(method, params);
        const title = typeof opts.success === "function" ? opts.success(r) : (opts.success ?? `${opts.label} finished`);
        toasts.push({ kind: "success", title, output: (r as { output?: string } | undefined)?.output });
        return r;
      } catch (e) {
        const err = e as GitnutRpcError;
        toasts.push({ kind: "error", title: err.code === "conflict" ? `${opts.label} hit conflicts and was aborted` : `${opts.label} failed`, output: err.message });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [base, servers],
  );
  return { run, busy, conn: base };
}

/** "main", plus the folder for linked worktrees: "feature/x (acme-web-x)". */
const wtName = (wt: WorktreeSummary) => `${worktreeLabel(wt)}${wt.isMain ? "" : ` (${worktreeFolder(wt.path)})`}`;
/** "acme-web / main": where an action runs. */
export const targetLabel = (repo: RepoSummary, wt: WorktreeSummary) => `${repo.name} / ${wtName(wt)}`;

function copy(text: string, what: string) {
  void copyText(text).then((ok) => toasts.push(ok ? { kind: "info", title: `Copied ${what}` } : { kind: "error", title: "Couldn't copy", output: "The browser blocked clipboard access." }));
}

// ---- menu builders (pure) -------------------------------------------------------------------

export interface CommitMenuHandlers {
  copy(text: string, what: string): void;
  checkout(hash: string): void;
  newBranch(hash: string): void;
  newTag(hash: string): void;
  cherryPick(hashes: string[]): void;
  revert(hashes: string[]): void;
  reset(hash: string): void;
}

/** R-ACT-2 menu for selected commits (table order). Single-commit items are disabled for a multi-selection, worktree items without a worktree. */
export function commitMenuItems(commits: Pick<CommitDetails, "hash" | "subject">[], hasWorktree: boolean, h: CommitMenuHandlers): MenuItem[] {
  const n = commits.length;
  const one = n === 1;
  const hashes = commits.map((c) => c.hash);
  return [
    { label: one ? "Copy revision number" : `Copy ${n} revision numbers`, icon: <Copy size={13} />, onSelect: () => h.copy(hashes.join("\n"), one ? shortHash(hashes[0]) : `${n} hashes`) },
    { label: one ? "Copy subject" : `Copy ${n} subjects`, icon: <Copy size={13} />, onSelect: () => h.copy(commits.map((c) => c.subject).join("\n"), one ? "the subject" : `${n} subjects`) },
    "separator",
    { label: "Checkout revision", icon: <CircleDot size={13} />, disabled: !one || !hasWorktree, onSelect: () => h.checkout(hashes[0]) },
    { label: "New branch…", icon: <GitBranchPlus size={13} />, disabled: !one, onSelect: () => h.newBranch(hashes[0]) },
    { label: "New tag…", icon: <Tag size={13} />, disabled: !one, onSelect: () => h.newTag(hashes[0]) },
    "separator",
    { label: one ? "Cherry-pick" : `Cherry-pick ${n} commits`, icon: <Cherry size={13} />, disabled: !hasWorktree || !n, onSelect: () => h.cherryPick(hashes) },
    { label: one ? "Revert commit" : `Revert ${n} commits`, icon: <Undo2 size={13} />, disabled: !hasWorktree || !n, onSelect: () => h.revert(hashes) },
    "separator",
    { label: "Reset current branch to here…", icon: <RotateCcw size={13} />, disabled: !one || !hasWorktree, onSelect: () => h.reset(hashes[0]) },
  ];
}

export interface RefMenuHandlers {
  copy(text: string, what: string): void;
  checkout(ref: RefInfo): void;
  newBranch(ref: RefInfo): void;
  merge(ref: RefInfo): void;
  rebase(ref: RefInfo): void;
  push(ref: RefInfo): void;
  remove(ref: RefInfo): void;
}

/**
 * R-ACT-3 menu for a ref. `worktree`: the target worktree (path + current branch), null when the repo has none.
 * Checkout is off for the current branch and branches checked out elsewhere; merge / rebase off for the current one.
 */
export function refMenuItems(ref: RefInfo, worktree: { path: string; branch: string | null } | null, h: RefMenuHandlers): MenuItem[] {
  const head = ref.kind === "head";
  const name = head ? "HEAD" : ref.name;
  const current = (ref.kind === "local" && ref.name === worktree?.branch) || (head && ref.worktrees.includes(worktree?.path ?? "\0"));
  const elsewhere = ref.kind === "local" && ref.worktrees.some((p) => p !== worktree?.path);
  const into = worktree?.branch ?? "HEAD";
  const items: MenuItem[] = [
    { label: ref.kind === "remote" ? "Checkout as new local branch" : "Checkout", icon: <CircleDot size={13} />, disabled: !worktree || current || elsewhere || head, hint: elsewhere && !current ? "in another worktree" : undefined, onSelect: () => h.checkout(ref) },
    { label: `New branch from '${name}'…`, icon: <GitBranchPlus size={13} />, onSelect: () => h.newBranch(ref) },
    "separator",
    { label: `Merge '${name}' into '${into}'`, icon: <GitMerge size={13} />, disabled: !worktree || current || head, onSelect: () => h.merge(ref) },
    { label: `Rebase '${into}' onto '${name}'`, icon: <GitPullRequestArrow size={13} />, disabled: !worktree || current || head, onSelect: () => h.rebase(ref) },
  ];
  if (ref.kind === "local") items.push("separator", { label: `Push '${name}'`, icon: <ArrowUpFromLine size={13} />, onSelect: () => h.push(ref) });
  if (!head) {
    items.push("separator", {
      label: ref.kind === "tag" ? `Delete tag '${name}'…` : ref.kind === "remote" ? `Delete '${name}' on the remote…` : `Delete '${name}'…`,
      icon: <Trash2 size={13} />,
      danger: true,
      disabled: ref.kind === "local" && ref.worktrees.length > 0,
      hint: ref.kind === "local" && ref.worktrees.length > 0 ? "checked out" : undefined,
      onSelect: () => h.remove(ref),
    });
  }
  items.push("separator", { label: "Copy name", icon: <Copy size={13} />, onSelect: () => h.copy(name, name) });
  return items;
}

// ---- hooks wiring the menus ------------------------------------------------------------------

/**
 * Commit and ref menus of one repository's log, acting on `worktreeId` (default: the main worktree).
 * Used by CommitGraph and RefsList; usable for custom menus.
 */
export function useLogActions(repoId: string, server?: ServerProp, worktreeId?: string | null) {
  const { repos } = useRepos(server);
  const { run, busy } = useGitAction(server);
  const repo = repos.find((r) => r.id === repoId) ?? null;
  const wt = repo?.worktrees.find((w) => w.id === worktreeId) ?? repo?.worktrees.find((w) => w.isMain) ?? null;
  const where = repo && wt ? targetLabel(repo, wt) : undefined;

  const newBranch = useCallback(
    async (at: string, from: string) => {
      const r = await promptAction({
        title: `New branch from ${from}`,
        label: "Branch name",
        validate: checkRefName,
        checkbox: wt ? { label: `Check out in ${where}`, initial: false } : undefined,
        command: (v, checked) => (checked ? `git switch -c ${v || "<name>"} ${from}` : `git branch ${v || "<name>"} ${from}`),
        confirmLabel: "Create",
      });
      if (!r) return;
      if (r.checked && wt) await run("worktree.checkout", { worktreeId: wt.id, ref: at, newBranch: r.value }, { label: "New branch", success: `Created and checked out ${r.value}` });
      else await run("repo.branch.create", { repoId, name: r.value, at }, { label: "New branch", success: `Created branch ${r.value}` });
    },
    [run, wt, where, repoId],
  );

  const commitMenu = useCallback(
    (commits: Pick<CommitDetails, "hash" | "subject">[]) =>
      commitMenuItems(commits, !!wt, {
        copy,
        checkout: (h) => wt && void run("worktree.checkout", { worktreeId: wt.id, ref: h }, { label: "Checkout", success: `Checked out ${shortHash(h)} (detached) in ${where}` }),
        newBranch: (h) => void newBranch(h, shortHash(h)),
        newTag: async (h) => {
          const r = await promptAction({
            title: `New tag at ${shortHash(h)}`,
            label: "Tag name",
            validate: checkRefName,
            message: { label: "Message (makes an annotated tag)", placeholder: "Optional" },
            command: (v, _c, m) => (m ? `git tag -a -m "${m}" ${v || "<name>"} ${shortHash(h)}` : `git tag ${v || "<name>"} ${shortHash(h)}`),
            confirmLabel: "Create tag",
          });
          if (r) await run("repo.tag.create", { repoId, name: r.value, at: h, message: r.message || undefined }, { label: "New tag", success: `Created tag ${r.value}` });
        },
        cherryPick: (hs) => wt && void run("worktree.cherryPick", { worktreeId: wt.id, hashes: hs }, { label: "Cherry-pick", success: `Cherry-picked ${hs.length === 1 ? shortHash(hs[0]) : `${hs.length} commits`} into ${where}` }),
        revert: (hs) => wt && void run("worktree.revert", { worktreeId: wt.id, hashes: hs }, { label: "Revert", success: `Reverted ${hs.length === 1 ? shortHash(hs[0]) : `${hs.length} commits`} in ${where}` }),
        reset: async (h) => {
          if (!wt) return;
          const r = await confirmAction({
            title: `Reset ${wt.branch ?? "HEAD"} to ${shortHash(h)}`,
            worktree: where,
            choices: [
              { value: "soft", label: "Soft", hint: "Keep all changes staged" },
              { value: "mixed", label: "Mixed", hint: "Keep the changes in the files, unstaged" },
              { value: "hard", label: "Hard", hint: "Throw away all changes, also uncommitted ones" },
            ],
            initialChoice: "mixed",
            danger: (c) => c === "hard",
            command: (c) => `git reset --${c} ${shortHash(h)}`,
            confirmLabel: "Reset",
          });
          if (r?.choice) await run("worktree.reset", { worktreeId: wt.id, to: h, mode: r.choice as "soft" | "mixed" | "hard" }, { label: "Reset", success: `Reset ${wt.branch ?? "HEAD"} to ${shortHash(h)} (${r.choice})` });
        },
      }),
    [wt, where, run, newBranch, repoId],
  );

  const refMenu = useCallback(
    (ref: RefInfo) =>
      refMenuItems(ref, wt ? { path: wt.path, branch: wt.branch } : null, {
        copy,
        checkout: (r) => wt && void run("worktree.checkout", { worktreeId: wt.id, ref: r.full }, { label: "Checkout", success: (x) => `Checked out ${x.branch ?? `${r.name} (detached)`} in ${where}` }),
        newBranch: (r) => void newBranch(r.full, r.name),
        merge: (r) => wt && void run("worktree.merge", { worktreeId: wt.id, ref: r.full }, { label: "Merge", success: `Merged ${r.name} into ${wt.branch ?? "HEAD"}` }),
        rebase: (r) => wt && void run("worktree.rebase", { worktreeId: wt.id, onto: r.full }, { label: "Rebase", success: `Rebased ${wt.branch ?? "HEAD"} onto ${r.name}` }),
        push: (r) => void run("repo.branch.push", { repoId, name: r.name }, { label: "Push", success: `Pushed ${r.name}` }),
        remove: async (r) => {
          if (r.kind === "tag") {
            await run("repo.tag.delete", { repoId, name: r.name }, { label: "Delete tag", success: `Deleted tag ${r.name}`, confirm: { title: `Delete tag ${r.name}`, danger: true, command: `git tag -d ${r.name}`, confirmLabel: "Delete" } });
          } else if (r.kind === "remote") {
            const slash = r.name.indexOf("/");
            await run("repo.branch.delete", { repoId, name: r.name, remote: true }, {
              label: "Delete remote branch",
              success: `Deleted ${r.name}`,
              confirm: { title: `Delete ${r.name}`, message: "The branch is deleted on the remote for everyone.", danger: true, command: `git push ${r.name.slice(0, slash)} --delete ${r.name.slice(slash + 1)}`, confirmLabel: "Delete" },
            });
          } else {
            const c = await confirmAction({ title: `Delete branch ${r.name}`, danger: true, checkbox: { label: "Force: delete even if it is not merged" }, command: (_x, force) => `git branch ${force ? "-D" : "-d"} ${r.name}`, confirmLabel: "Delete" });
            if (c) await run("repo.branch.delete", { repoId, name: r.name, force: c.checked }, { label: "Delete branch", success: `Deleted branch ${r.name}` });
          }
        },
      }),
    [wt, where, run, newBranch, repoId],
  );

  return { repo, worktree: wt, target: where, commitMenu, refMenu, busy, run };
}

/** "Copy path" items for changed files. */
export const copyPathItems = (paths: string[]): MenuItem[] => [{ label: paths.length === 1 ? "Copy path" : `Copy ${paths.length} paths`, icon: <Copy size={13} />, onSelect: () => copy(paths.join("\n"), paths.length === 1 ? "the path" : `${paths.length} paths`) }];

/**
 * Menu for uncommitted files (LocalChanges, CombinedLocalChanges): Discard changes… (confirmed) and Copy path.
 * Items must carry their `source` (worktree); discarding across worktrees at once is not offered.
 * `where`: worktree label for the confirm dialog when the items have no groups.
 */
export function useLocalFileMenu(where?: string) {
  const { run } = useGitAction();
  return useCallback(
    (items: ChangeItem[]): MenuItem[] => {
      const src = items[0]?.source;
      const one = !!src?.worktreeId && items.every((i) => i.source?.worktreeId === src.worktreeId && i.source?.server === src.server);
      const discard = async () => {
        const untracked = items.filter((i) => i.change.status === "untracked").map((i) => i.change.path);
        const tracked = items.filter((i) => i.change.status !== "untracked").flatMap((i) => [i.change.path, ...(i.change.oldPath && i.change.oldPath !== i.change.path ? [i.change.oldPath] : [])]);
        const q = (p: string) => (/^[\w./@-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);
        const group = items[0].groups?.filter((g) => g.kind !== "server").map((g) => g.label).join(" / ");
        await run("worktree.discard", { worktreeId: src!.worktreeId!, paths: items.map((i) => i.change.path) }, {
          label: "Discard",
          server: src!.server,
          success: `Discarded changes in ${items.length === 1 ? items[0].change.path : `${items.length} files`}`,
          confirm: {
            title: items.length === 1 ? `Discard changes in ${items[0].change.path.split("/").pop()}` : `Discard changes in ${items.length} files`,
            message: untracked.length ? "Tracked files go back to HEAD; untracked files are deleted. This can't be undone." : "The files go back to HEAD (staged and unstaged changes). This can't be undone.",
            worktree: group || where,
            danger: true,
            command: [tracked.length && `git restore --source=HEAD --staged --worktree -- ${tracked.map(q).join(" ")}`, untracked.length && `rm -- ${untracked.map(q).join(" ")}`].filter(Boolean).join("\n"),
            confirmLabel: "Discard",
          },
        });
      };
      return [
        { label: items.length === 1 ? "Discard changes…" : `Discard changes in ${items.length} files…`, icon: <Eraser size={13} />, danger: true, disabled: !one || !items.length, onSelect: () => void discard() },
        "separator",
        ...copyPathItems(items.map((i) => i.change.path)),
      ];
    },
    [run, where],
  );
}

/** Menu of a repository row in the projects list. */
export function repoMenuItems(h: { open?: () => void; fetch: () => void; remove?: () => void }): MenuItem[] {
  return [
    ...(h.open ? [{ label: "Open log", icon: <GitCommitHorizontal size={13} />, onSelect: h.open }] : []),
    { label: "Fetch", icon: <ArrowDownToLine size={13} />, onSelect: h.fetch },
    ...(h.remove ? (["separator", { label: "Remove from list", icon: <EyeOff size={13} />, onSelect: h.remove }] as MenuItem[]) : []),
  ];
}

/** Props of {@link WorktreePicker}. */
export interface WorktreePickerProps {
  /** Repository whose worktrees are offered. */
  repo: RepoSummary | null;
  /** Selected worktree id; default the main worktree. */
  value: string | null | undefined;
  onChange: (worktreeId: string) => void;
}

/** Picks the worktree that log actions change ("in: main ▾"); hidden when the repo has one worktree. */
export function WorktreePicker({ repo, value, onChange }: WorktreePickerProps) {
  const list = repo?.worktrees ?? [];
  const current = useMemo(() => list.find((w) => w.id === value) ?? list.find((w) => w.isMain), [list, value]);
  if (list.length < 2 || !current) return null;
  return (
    <label className="gitnut-wt-picker" title={`Checkout, merge, reset and other actions run in ${current.path}`}>
      <span className="gitnut-muted">in:</span>
      <select value={current.id} onChange={(e) => onChange(e.target.value)} aria-label="Worktree for actions">
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {wtName(w)}
          </option>
        ))}
      </select>
    </label>
  );
}
