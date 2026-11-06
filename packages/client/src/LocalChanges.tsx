import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GitBranch } from "lucide-react";
import type { WorktreeCounts, WorktreeSummary } from "@gitnut/commons";
import { targetLabel, useLocalFileMenu } from "./actions";
import { ChangesBrowser } from "./ChangesBrowser";
import { ChangesTree } from "./ChangesTree";
import { CommitPanel } from "./CommitPanel";
import { GitActions } from "./GitActions";
import { useLocalChanges, useWorktree } from "./hooks";
import type { ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { changesFromList, type ChangeItem } from "./tree";
import { Empty, Spinner } from "./ui";

/** Props of {@link LocalChanges}. Give `worktreePath` or `worktreeId`. */
export interface LocalChangesProps extends StyleProps {
  /** Daemon to use (works without a GitnutProvider). */
  server?: ServerProp;
  /** Absolute path of the worktree on the daemon's machine. */
  worktreePath?: string;
  worktreeId?: string;
  /** Message box, Amend and Commit for the checked files. Default true. */
  showCommitPanel?: boolean;
  /** Fetch / pull / push / stash / unstash buttons. Default true. */
  showActions?: boolean;
  /** Header with the branch, upstream and ahead / behind. Default true. */
  showHeader?: boolean;
  /** Fix tree / flat. */
  mode?: "tree" | "flat";
  /** Where the diff goes: beside the tree (default), below it, or nowhere (tree only). */
  diff?: "right" | "bottom" | "none";
  /** A file got selected. */
  onSelectFile?: (item: ChangeItem | null) => void;
  /** Extra header content. */
  headerExtra?: ReactNode;
}

export const totalCount = (c: WorktreeCounts) => c.staged + c.unstaged + c.untracked + c.conflicted;
export const worktreeLabel = (wt: WorktreeSummary) => wt.branch ?? `detached at ${wt.head?.slice(0, 8) ?? "?"}`;
const base = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

/** Live uncommitted changes of one worktree, with commit, fetch / pull / push and a diff. */
export function LocalChanges(props: LocalChangesProps) {
  const cx = useCx();
  const target = props.worktreeId ?? props.worktreePath;
  const { worktree: wt, repo, loading: wtLoading, state } = useWorktree(target, props.server);
  const { changes, truncated, loading } = useLocalChanges(wt?.id, props.server);
  const items = useMemo(() => changesFromList(changes, repo && wt ? { server: props.server, repoId: repo.id, worktreeId: wt.id } : undefined), [changes, repo, wt, props.server]);
  // checked = everything except what the user unticked (new files arrive ticked)
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const checked = useMemo(() => new Set(items.filter((i) => !unchecked.has(i.key)).map((i) => i.key)), [items, unchecked]);
  const onChecked = (keys: Set<string>) => setUnchecked(new Set(items.filter((i) => !keys.has(i.key)).map((i) => i.key)));
  const paths = useMemo(() => {
    if (checked.size === items.length) return undefined;
    const out: string[] = [];
    for (const i of items) if (checked.has(i.key)) out.push(i.change.path, ...(i.change.oldPath ? [i.change.oldPath] : []));
    return out;
  }, [checked, items]);

  const showCommit = props.showCommitPanel !== false;
  const fileMenu = useLocalFileMenu(repo && wt ? targetLabel(repo, wt) : undefined);
  const treeProps = { checkable: showCommit, checked, onCheckedChange: onChecked, contextMenu: fileMenu };
  const notice = truncated && wt ? <div className="gitnut-notice">Showing {changes.length} of about {totalCount(wt.counts)} changed files</div> : null;
  const footer = (
    <>
      {notice}
      {showCommit && wt && <CommitPanel server={props.server} worktree={wt.id} paths={paths} fileCount={checked.size} />}
    </>
  );

  let body: ReactNode;
  if (!target) body = <Empty title="No worktree given" />;
  else if (state === "unauthorized") body = <Empty title="Not logged in">Log in to this daemon to see its changes.</Empty>;
  else if (!wt && wtLoading) body = <div className="gitnut-center"><Spinner /></div>;
  else if (!wt) body = <Empty title="Worktree not found">{target} is not a worktree of a repository this daemon knows. Add it with <code>gitnut repos add</code>.</Empty>;
  else if (loading) body = <div className="gitnut-center"><Spinner /></div>;
  else if (props.diff === "none")
    body = (
      <div className="gitnut-browser-tree">
        <ChangesTree items={items} mode={props.mode} {...treeProps} onSelect={props.onSelectFile} emptyText="No local changes" />
        {footer}
      </div>
    );
  else
    body = (
      <ChangesBrowser
        items={items}
        mode={props.mode}
        layout={props.diff === "bottom" ? "column" : "row"}
        splitId={`local.${props.diff ?? "right"}`}
        tree={treeProps}
        treeFooter={footer}
        onSelect={props.onSelectFile}
        emptyText="No local changes"
      />
    );

  return (
    <GitnutRoot component="local-changes" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {props.showHeader !== false && wt && (
        <div className={cx("header", "gitnut-local-header")}>
          <GitBranch size={14} className="gitnut-muted" />
          <span className="gitnut-local-branch">{worktreeLabel(wt)}</span>
          {wt.upstream && <span className="gitnut-muted">{wt.upstream}</span>}
          {wt.ahead > 0 && <span className="gitnut-ab" title={`${wt.ahead} to push`}><ArrowUp size={11} />{wt.ahead}</span>}
          {wt.behind > 0 && <span className="gitnut-ab" title={`${wt.behind} to pull`}><ArrowDown size={11} />{wt.behind}</span>}
          <span className="gitnut-muted gitnut-local-path" title={wt.path}>{repo && base(wt.path) !== repo.name ? `${repo.name} / ${base(wt.path)}` : base(wt.path)}</span>
          <span className="gitnut-toolbar-spacer" />
          {props.headerExtra}
          {props.showActions !== false && <GitActions server={props.server} worktree={wt.id} actions={["fetch", "pull", "push", "stash", "unstash"]} />}
        </div>
      )}
      <div className="gitnut-fill">{body}</div>
    </GitnutRoot>
  );
}
