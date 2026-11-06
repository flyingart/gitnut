import { useEffect } from "react";
import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import type { StashEntry } from "@gitnut/commons";
import { targetLabel, useGitAction } from "./actions";
import { useQuery, useWorktree } from "./hooks";
import { promptAction } from "./overlays";
import type { ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { Button } from "./ui";

export type GitAction = "fetch" | "pull" | "push" | "stash" | "unstash";

/** Props of {@link GitActions}. */
export interface GitActionsProps extends StyleProps {
  server?: ServerProp;
  /** Worktree (id or absolute path) for pull / push / stash; its repo is fetched. */
  worktree: string;
  /** Buttons to show. Default fetch, pull, push. */
  actions?: GitAction[];
  /** Show text labels next to the icons. Default true. */
  labels?: boolean;
  size?: "sm" | "md";
  /** Called with the git output after an action. */
  onDone?: (action: GitAction, output: string) => void;
}

const LABELS: Record<GitAction, string> = { fetch: "Fetch", pull: "Pull", push: "Push", stash: "Stash", unstash: "Unstash" };

/** Fetch / pull / push / stash / unstash buttons with progress and a toast with the git output. Pull and push show behind / ahead counts. */
export function GitActions(props: GitActionsProps) {
  const cx = useCx();
  const { worktree: wt, repo, conn } = useWorktree(props.worktree, props.server);
  const { run, busy } = useGitAction(props.server);
  const actions = props.actions ?? ["fetch", "pull", "push"];

  // latest stash for Unstash; refs/stash moves the graph id, so refetch on graph changes
  const stashKey = actions.includes("unstash") && repo ? `stashes:${repo.id}` : null;
  const stashes = useQuery<StashEntry[]>(conn, stashKey, () => conn!.call("repo.stashes", { repoId: repo!.id }));
  useEffect(() => {
    if (!conn || !stashKey || !repo) return;
    const id = repo.id;
    return conn.on("graph.changed", (e) => e.repoId === id && void conn.query(stashKey, () => conn.call("repo.stashes", { repoId: id })).refetch());
  }, [conn, stashKey, repo]);
  const latest = stashes.data?.[0];

  const go = async (action: GitAction) => {
    if (!conn || !wt || !repo) return;
    const label = LABELS[action];
    let r: { output: string } | undefined;
    if (action === "fetch") r = await run("repo.fetch", { repoId: repo.id }, { label, success: (x) => (x.output.trim() ? "Fetched" : "Fetched: everything is up to date") });
    else if (action === "pull") r = await run("worktree.pull", { worktreeId: wt.id }, { label });
    else if (action === "push") r = await run("worktree.push", { worktreeId: wt.id }, { label });
    else if (action === "unstash") r = await run("worktree.stashPop", { worktreeId: wt.id }, { label, success: latest ? `Unstashed ${latest.message}` : "Unstashed" });
    else {
      const p = await promptAction({
        title: "Stash local changes",
        label: "Message",
        placeholder: "Optional",
        optional: true,
        worktree: targetLabel(repo, wt),
        checkbox: { label: "Include untracked files" },
        command: (v, u) => `git stash push${u ? " --include-untracked" : ""}${v ? ` -m "${v}"` : ""}`,
        confirmLabel: "Stash",
      });
      if (p) r = await run("worktree.stash", { worktreeId: wt.id, message: p.value || undefined, includeUntracked: p.checked }, { label, success: "Stashed the local changes" });
    }
    if (r && stashKey) void conn.query(stashKey, () => conn.call("repo.stashes", { repoId: repo.id })).refetch();
    if (r) props.onDone?.(action, r.output);
  };

  const label = (a: GitAction) => (props.labels === false ? undefined : LABELS[a]);
  const icons = { fetch: <RefreshCw size={13} />, pull: <ArrowDownToLine size={13} />, push: <ArrowUpFromLine size={13} />, stash: <Archive size={13} />, unstash: <ArchiveRestore size={13} /> };
  const counts = { fetch: 0, pull: wt?.behind ?? 0, push: wt?.ahead ?? 0, stash: 0, unstash: 0 };
  const titles = {
    fetch: "Fetch all remotes",
    pull: wt?.upstream ? `Pull from ${wt.upstream}` : "Pull",
    push: wt?.upstream ? `Push to ${wt.upstream}` : "Push (sets the upstream)",
    stash: "Stash the local changes",
    unstash: latest ? `Unstash ${latest.ref}: ${latest.message}` : "No stashes",
  };

  return (
    <GitnutRoot component="git-actions" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {actions.map((a) => (
        <Button
          key={a}
          size={props.size ?? "sm"}
          variant="ghost"
          icon={icons[a]}
          busy={busy === LABELS[a]}
          disabled={!wt || (!!busy && busy !== LABELS[a]) || (a === "unstash" && !latest)}
          title={titles[a]}
          aria-label={props.labels === false ? LABELS[a] : undefined}
          onClick={() => void go(a)}
        >
          {label(a)}
          {counts[a] > 0 && <span className={cx("badge", "gitnut-badge")}>{counts[a]}</span>}
        </Button>
      ))}
    </GitnutRoot>
  );
}
