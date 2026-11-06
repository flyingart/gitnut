import { useMemo } from "react";
import { Layers, SlidersHorizontal } from "lucide-react";
import type { FileChange, RepoSummary, WorktreeSummary } from "@gitnut/commons";
import type { GitnutConnection } from "./connection";
import { useLocalFileMenu } from "./actions";
import { ChangesBrowser } from "./ChangesBrowser";
import { totalCount, worktreeLabel } from "./LocalChanges";
import { resolveConnection, useServers, type ServerProp } from "./provider";
import { useQueries, useReposOf } from "./hooks";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import type { ChangeItem, TreeGroup } from "./tree";
import { Empty, Popover } from "./ui";
import { useViewOptions } from "./viewOptions";

/** A worktree on a server. */
export interface WorktreeRef {
  server?: ServerProp;
  /** Worktree id or absolute path. */
  worktree: string;
}

/** Props of {@link CombinedLocalChanges}. */
export interface CombinedLocalChangesProps extends StyleProps {
  /** Servers to include. Default: all servers of the GitnutProvider. */
  servers?: ServerProp[];
  /** Exactly these worktrees (overrides `servers` and the chooser). */
  worktrees?: WorktreeRef[];
  /** Default: worktrees with changes. "all" also lists clean ones in the chooser. */
  include?: "changed" | "all";
  /** Worktree chooser (remembered). Default true unless `worktrees` is given. */
  showChooser?: boolean;
  mode?: "tree" | "flat";
  /** Diff beside (default) or below the tree. */
  layout?: "row" | "column";
  onSelect?: (item: ChangeItem | null) => void;
}

interface Target {
  conn: GitnutConnection;
  repo: RepoSummary;
  wt: WorktreeSummary;
  key: string;
}

/** Uncommitted changes of several worktrees / repos / servers in one tree: server → repo → worktree → folders. */
export function CombinedLocalChanges(props: CombinedLocalChangesProps) {
  const cx = useCx();
  const { servers } = useServers();
  const { options, set } = useViewOptions();
  const conns = useMemo(() => {
    const list = props.worktrees ? props.worktrees.map((w) => w.server) : (props.servers ?? servers.map((s) => s.conn.url));
    const out = new Map<string, GitnutConnection>();
    for (const s of list.length ? list : [undefined]) {
      const c = resolveConnection(servers, s);
      if (c) out.set(c.url, c);
    }
    return [...out.values()];
  }, [props.worktrees, props.servers, servers]);

  const repoStates = useReposOf(conns);
  const fileMenu = useLocalFileMenu();

  const all = useMemo(() => {
    const out: Target[] = [];
    conns.forEach((conn, i) => {
      for (const repo of repoStates[i]?.data ?? []) for (const wt of repo.worktrees) out.push({ conn, repo, wt, key: `${conn.url}|${wt.id}` });
    });
    return out;
  }, [conns, repoStates]);

  const explicit = props.worktrees;
  const targets = useMemo(() => {
    if (explicit) {
      return all.filter((t) => explicit.some((w) => resolveConnection(servers, w.server)?.url === t.conn.url && (w.worktree === t.wt.id || w.worktree.replace(/\/+$/, "") === t.wt.path)));
    }
    return all.filter((t) => totalCount(t.wt.counts) > 0 && !options.combinedExclude.includes(t.key));
  }, [all, explicit, servers, options.combinedExclude]);

  const targetKey = targets.map((t) => t.key).join(",");
  const statusQueries = useMemo(
    () => targets.map((t) => t.conn.query<{ changes: FileChange[]; truncated?: boolean }>(`status:${t.wt.id}`, () => t.conn.call("worktree.status", { worktreeId: t.wt.id }), `worktree:${t.wt.id}`)),
    [targetKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const statuses = useQueries(statusQueries);

  const multiServer = new Set(targets.map((t) => t.conn.url)).size > 1;
  const items = useMemo(() => {
    const out: ChangeItem[] = [];
    targets.forEach((t, i) => {
      const groups: TreeGroup[] = [];
      if (multiServer) groups.push({ id: t.conn.url, label: t.conn.name, kind: "server" });
      groups.push({ id: `${t.conn.url}|${t.repo.id}`, label: t.repo.name, kind: "repo" });
      groups.push({ id: t.key, label: worktreeLabel(t.wt), kind: "worktree", detail: t.wt.isMain ? undefined : t.wt.path.split("/").pop() });
      for (const change of statuses[i]?.data?.changes ?? []) {
        out.push({ key: `${t.key}|${change.path}`, change, groups, source: { server: t.conn.url, repoId: t.repo.id, worktreeId: t.wt.id } });
      }
    });
    return out;
  }, [targets, statuses, multiServer]);
  const truncated = statuses.some((s) => s.data?.truncated);

  const chooserList = props.include === "all" ? all : all.filter((t) => totalCount(t.wt.counts) > 0);
  const chooser = props.showChooser ?? !explicit;
  const loading = repoStates.some((s) => !s.data && !s.error) || statuses.some((s) => !s.data && !s.error);

  return (
    <GitnutRoot component="combined-changes" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      <div className={cx("header", "gitnut-local-header")}>
        <Layers size={14} className="gitnut-muted" />
        <span className="gitnut-local-branch">All uncommitted changes</span>
        <span className="gitnut-muted">
          {targets.length} {targets.length === 1 ? "worktree" : "worktrees"}
        </span>
        <span className="gitnut-toolbar-spacer" />
        {chooser && (
          <Popover title="Choose worktrees" icon={<SlidersHorizontal size={13} />} label="Worktrees" align="right">
            {() => (
              <div className="gitnut-menu gitnut-scroll" style={{ maxHeight: 360 }}>
                {!chooserList.length && <div className="gitnut-menu-label">No worktree has changes</div>}
                {chooserList.map((t) => {
                  const on = !options.combinedExclude.includes(t.key);
                  return (
                    <label key={t.key} className="gitnut-menu-item">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => set("combinedExclude", on ? [...options.combinedExclude, t.key] : options.combinedExclude.filter((k) => k !== t.key))}
                      />
                      <span>{t.repo.name}</span>
                      <span className="gitnut-muted">{worktreeLabel(t.wt)}</span>
                      <span className="gitnut-muted gitnut-menu-right">{totalCount(t.wt.counts)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Popover>
        )}
      </div>
      {truncated && <div className="gitnut-notice">Some worktrees have more than 5000 changed files; only the first 5000 of each are shown.</div>}
      <div className="gitnut-fill">
        {!conns.length ? (
          <Empty title="No servers">Add a server to see its local changes.</Empty>
        ) : !items.length && !loading ? (
          <Empty icon={<Layers size={22} />} title="No local changes">Uncommitted changes of your worktrees appear here while agents work.</Empty>
        ) : (
          <ChangesBrowser items={items} mode={props.mode} layout={props.layout} splitId="combined" onSelect={props.onSelect} emptyText="Loading…" tree={{ contextMenu: fileMenu }} />
        )}
      </div>
    </GitnutRoot>
  );
}
