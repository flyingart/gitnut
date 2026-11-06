import { useMemo, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, Box, ChevronDown, ChevronRight, EyeOff, FileDiff, FolderPlus, GitBranch, KeyRound, RefreshCw, Search } from "lucide-react";
import type { RepoSummary, WorktreeSummary } from "@gitnut/commons";
import { repoMenuItems, useGitAction } from "./actions";
import type { GitnutConnection } from "./connection";
import { useReposOf } from "./hooks";
import { totalCount, worktreeLabel } from "./LocalChanges";
import { resolveConnection, useServers, type ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { IconButton, isMenuKey, menuPointOf, Spinner, useContextMenu, type MenuItem } from "./ui";
import { useViewOptions } from "./viewOptions";

/** What is selected in the projects list. */
export interface ProjectSelection {
  /** Server URL. */
  server: string;
  repoId: string;
  worktreeId?: string;
}

/** Props of {@link ProjectsList}. */
export interface ProjectsListProps extends StyleProps {
  /** Servers to list. Default: all provider servers. */
  servers?: ServerProp[];
  /** Fix grouping (hides nothing here; the app's toggle reads the option). */
  grouping?: "server" | "flat";
  /** Show worktrees under repos. Default true. */
  showWorktrees?: boolean;
  /** Search field. Default true. */
  showSearch?: boolean;
  selected?: ProjectSelection | null;
  onSelectRepo?: (sel: ProjectSelection, repo: RepoSummary) => void;
  onSelectWorktree?: (sel: ProjectSelection, worktree: WorktreeSummary, repo: RepoSummary) => void;
  /** A server needs a login (row button). */
  onLogin?: (conn: GitnutConnection) => void;
  /** Extra content on server rows (right side). */
  serverActions?: (conn: GitnutConnection) => ReactNode;
  /** Shows an "Add projects" button on server rows and in empty servers. */
  onAddProjects?: (conn: GitnutConnection) => void;
  /**
   * Shows a "Remove from list" button on repo rows. Default when not given: no button.
   * Pass `true` to call `repos.remove` (a repo from a watched folder is hidden via `exclude`).
   */
  onRemoveRepo?: true | ((conn: GitnutConnection, repo: RepoSummary) => void);
}

function useConnStates(conns: GitnutConnection[]) {
  const sub = useMemo(() => (fn: () => void) => {
    const offs = conns.map((c) => c.subscribe(fn));
    return () => offs.forEach((o) => o());
  }, [conns]);
  return useSyncExternalStore(sub, () => conns.map((c) => `${c.state}:${c.version}`).join());
}

const dirty = (r: RepoSummary) => r.worktrees.reduce((s, w) => s + totalCount(w.counts), 0);

/** Repositories of all servers with their worktrees (branch, ahead / behind, changed files). */
export function ProjectsList(props: ProjectsListProps) {
  const cx = useCx();
  const { servers } = useServers();
  const { options } = useViewOptions({ projectsGrouping: props.grouping });
  const conns = useMemo(() => {
    const list = props.servers ?? servers.map((s) => s.conn.url);
    return [...new Map((list.length ? list : [undefined]).map((s) => resolveConnection(servers, s)).filter((c): c is GitnutConnection => !!c).map((c) => [c.url, c])).values()];
  }, [props.servers, servers]);
  useConnStates(conns);
  const repoStates = useReposOf(conns);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setClosed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));

  const q = query.trim().toLowerCase();
  const match = (r: RepoSummary) => !q || r.name.toLowerCase().includes(q) || r.worktrees.some((w) => (w.branch ?? "").toLowerCase().includes(q));
  const sortRepos = (list: RepoSummary[]) =>
    [...list].sort((a, b) => (options.projectsSort === "dirty" ? dirty(b) - dirty(a) : 0) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const sel = props.selected;
  const menu = useContextMenu();
  const { run, busy } = useGitAction();
  /** Right-click and the keyboard menu key open `items()` on a row. */
  const menuProps = (items: () => MenuItem[]) => ({
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      menu.open(e, items());
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (!isMenuKey(e)) return;
      e.preventDefault();
      menu.open(menuPointOf(e.currentTarget), items());
    },
  });
  const fetchRepo = (conn: GitnutConnection, repo: RepoSummary) => void run("repo.fetch", { repoId: repo.id }, { label: "Fetch", server: conn.url, success: `Fetched ${repo.name}` });
  const removeRepo = (conn: GitnutConnection, repo: RepoSummary) => {
    if (props.onRemoveRepo === true) void conn.call("repos.remove", { path: repo.path });
    else props.onRemoveRepo?.(conn, repo);
  };
  const fetchAll = (conn: GitnutConnection) =>
    void run("repos.fetchAll", undefined, {
      label: "Fetch all",
      server: conn.url,
      success: (r) => {
        const bad = r.results.filter((x) => !x.ok);
        return bad.length ? `Fetched ${r.results.length - bad.length} of ${r.results.length} repositories (${bad.map((x) => x.name).join(", ")} failed)` : `Fetched ${r.results.length} repositories on ${conn.name}`;
      },
    });

  const worktreeRow = (conn: GitnutConnection, repo: RepoSummary, wt: WorktreeSummary, depth: number) => {
    const n = totalCount(wt.counts);
    const isSel = sel?.server === conn.url && sel.worktreeId === wt.id;
    return (
      <div
        key={wt.id}
        role="treeitem"
        aria-selected={isSel}
        tabIndex={-1}
        data-worktree={wt.path}
        className={cx("row", "gitnut-proj-row", "gitnut-proj-wt", isSel && "gitnut-selected")}
        style={{ paddingLeft: 10 + depth * 14 }}
        title={wt.path}
        onClick={() => props.onSelectWorktree?.({ server: conn.url, repoId: repo.id, worktreeId: wt.id }, wt, repo)}
        {...menuProps((): MenuItem[] => [
          ...(props.onSelectWorktree ? [{ label: "Open changes", icon: <FileDiff size={13} />, onSelect: () => props.onSelectWorktree?.({ server: conn.url, repoId: repo.id, worktreeId: wt.id }, wt, repo) }, "separator" as const] : []),
          { label: "Fetch", icon: <RefreshCw size={13} />, onSelect: () => fetchRepo(conn, repo) },
          { label: wt.upstream ? `Pull from ${wt.upstream}` : "Pull", icon: <ArrowDownToLine size={13} />, onSelect: () => void run("worktree.pull", { worktreeId: wt.id }, { label: "Pull", server: conn.url }) },
          { label: wt.upstream ? `Push to ${wt.upstream}` : "Push", icon: <ArrowUpFromLine size={13} />, onSelect: () => void run("worktree.push", { worktreeId: wt.id }, { label: "Push", server: conn.url }) },
        ])}
      >
        <GitBranch size={12} className="gitnut-muted" />
        <span className="gitnut-proj-name">{worktreeLabel(wt)}</span>
        {!wt.isMain && <span className="gitnut-tree-hint">{wt.path.split("/").pop()}</span>}
        <span className="gitnut-toolbar-spacer" />
        {wt.ahead > 0 && <span className="gitnut-ab" title={`${wt.ahead} ahead`}><ArrowUp size={10} />{wt.ahead}</span>}
        {wt.behind > 0 && <span className="gitnut-ab" title={`${wt.behind} behind`}><ArrowDown size={10} />{wt.behind}</span>}
        {n > 0 && <span className={cx("badge", "gitnut-badge", "gitnut-badge-dirty")} title={`${n} changed files`}>{n}</span>}
      </div>
    );
  };

  const repoRow = (conn: GitnutConnection, repo: RepoSummary, depth: number, suffix?: string) => {
    const id = `${conn.url}|${repo.id}`;
    const open = !closed.has(id);
    const isSel = sel?.server === conn.url && sel.repoId === repo.id && !sel.worktreeId;
    const n = dirty(repo);
    const showWts = props.showWorktrees !== false && repo.worktrees.length > 0;
    return (
      <div key={id} role="group">
        <div
          role="treeitem"
          aria-selected={isSel}
          aria-expanded={showWts ? open : undefined}
          tabIndex={-1}
          data-repo={repo.name}
          className={cx("row", "gitnut-proj-row", "gitnut-proj-repo", isSel && "gitnut-selected")}
          style={{ paddingLeft: 4 + depth * 14 }}
          title={repo.path}
          onClick={() => props.onSelectRepo?.({ server: conn.url, repoId: repo.id }, repo)}
          {...menuProps(() =>
            repoMenuItems({
              open: props.onSelectRepo && (() => props.onSelectRepo?.({ server: conn.url, repoId: repo.id }, repo)),
              fetch: () => fetchRepo(conn, repo),
              remove: props.onRemoveRepo ? () => removeRepo(conn, repo) : undefined,
            }),
          )}
        >
          <span
            className="gitnut-tree-chevron"
            onClick={(e) => {
              e.stopPropagation();
              toggle(id);
            }}
          >
            {showWts ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
          </span>
          <Box size={13} className="gitnut-proj-icon" />
          <span className="gitnut-proj-name gitnut-strong">{repo.name}</span>
          {suffix && <span className="gitnut-tree-hint">{suffix}</span>}
          <span className="gitnut-toolbar-spacer" />
          {!open && n > 0 && <span className={cx("badge", "gitnut-badge", "gitnut-badge-dirty")}>{n}</span>}
          {props.onRemoveRepo && (
            <IconButton
              className="gitnut-proj-remove"
              title={`Remove ${repo.name} from the list`}
              icon={<EyeOff size={12} />}
              onClick={(e) => {
                e.stopPropagation();
                removeRepo(conn, repo);
              }}
            />
          )}
        </div>
        {showWts && open && repo.worktrees.map((wt) => worktreeRow(conn, repo, wt, depth + 1))}
      </div>
    );
  };

  const serverHeader = (conn: GitnutConnection, count: number) => {
    const open = !closed.has(conn.url);
    return (
      <div
        className={cx("row", "gitnut-proj-server")}
        onClick={() => toggle(conn.url)}
        role="treeitem"
        tabIndex={-1}
        aria-expanded={open}
        data-server={conn.url}
        {...menuProps(() => [{ label: "Fetch all repositories", icon: <RefreshCw size={13} />, disabled: conn.state !== "open", onSelect: () => fetchAll(conn) }])}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={`gitnut-status-dot gitnut-state-${conn.state}`} title={conn.error ?? conn.state} />
        <span className="gitnut-proj-name">{conn.name}</span>
        <span className="gitnut-tree-count">{count || ""}</span>
        <span className="gitnut-toolbar-spacer" />
        {conn.state === "unauthorized" && (
          <button
            type="button"
            className="gitnut-link"
            onClick={(e) => {
              e.stopPropagation();
              props.onLogin?.(conn);
            }}
          >
            <KeyRound size={11} /> Log in
          </button>
        )}
        {conn.state === "open" && count > 0 && (
          <IconButton
            className="gitnut-proj-fetchall"
            title={`Fetch all repositories on ${conn.name}`}
            icon={<RefreshCw size={12} />}
            busy={busy === "Fetch all"}
            onClick={(e) => {
              e.stopPropagation();
              fetchAll(conn);
            }}
          />
        )}
        {props.onAddProjects && conn.state === "open" && (
          <IconButton
            title={`Add projects on ${conn.name}`}
            icon={<FolderPlus size={12} />}
            onClick={(e) => {
              e.stopPropagation();
              props.onAddProjects?.(conn);
            }}
          />
        )}
        {props.serverActions?.(conn)}
      </div>
    );
  };

  let content: ReactNode;
  if (options.projectsGrouping === "flat") {
    const all = conns.flatMap((c, i) => (repoStates[i]?.data ?? []).filter(match).map((r) => ({ c, r })));
    const multi = conns.length > 1;
    content = sortRepos(all.map((x) => x.r)).map((r) => {
      const { c } = all.find((x) => x.r === r)!;
      return repoRow(c, r, 0, multi ? c.name : undefined);
    });
    const offline = conns.filter((c) => c.state !== "open");
    if (offline.length) content = [...(content as ReactNode[]), ...offline.map((c) => <div key={c.url}>{serverHeader(c, 0)}</div>)];
  } else {
    content = conns.map((c, i) => {
      const repos = sortRepos((repoStates[i]?.data ?? []).filter(match));
      return (
        <div key={c.url} role="group" className="gitnut-proj-group">
          {serverHeader(c, repoStates[i]?.data?.length ?? 0)}
          {!closed.has(c.url) &&
            (c.state === "open" && !repoStates[i]?.data ? (
              <div className="gitnut-proj-loading"><Spinner /></div>
            ) : c.state === "open" && !repos.length ? (
              <div className="gitnut-proj-empty">
                {q ? "No match" : props.onAddProjects ? (
                  <>No repositories yet. <button type="button" className="gitnut-link" onClick={() => props.onAddProjects?.(c)}>Add projects</button></>
                ) : (
                  <>No repositories yet. Run <code>gitnut repos add</code> or <code>gitnut roots add</code>.</>
                )}
              </div>
            ) : (
              repos.map((r) => repoRow(c, r, 1))
            ))}
        </div>
      );
    });
  }

  return (
    <GitnutRoot component="projects" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {props.showSearch !== false && (
        <div className="gitnut-proj-search">
          <label className={cx("input", "gitnut-search")}>
            <Search size={13} className="gitnut-muted" />
            <input placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
          </label>
        </div>
      )}
      <div className={cx("tree", "gitnut-proj-tree", "gitnut-scroll")} role="tree" aria-label="Projects" data-grouping={options.projectsGrouping}>
        {content}
      </div>
      {menu.menu}
    </GitnutRoot>
  );
}

/** Props of {@link WorktreeList}. */
export interface WorktreeListProps extends StyleProps {
  server?: ServerProp;
  repoId: string;
  selected?: string | null;
  onSelect?: (worktree: WorktreeSummary) => void;
}

/** Worktrees of one repository. */
export function WorktreeList(props: WorktreeListProps) {
  const cx = useCx();
  const { servers } = useServers();
  const conn = resolveConnection(servers, props.server);
  const conns = useMemo(() => (conn ? [conn] : []), [conn]);
  const [state] = useReposOf(conns);
  const repo = state?.data?.find((r) => r.id === props.repoId);
  return (
    <GitnutRoot component="worktrees" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      <div className={cx("tree", "gitnut-proj-tree")} role="listbox" aria-label="Worktrees">
        {!repo ? <div className="gitnut-proj-loading"><Spinner /></div> : repo.worktrees.map((wt) => {
          const n = totalCount(wt.counts);
          return (
            <div key={wt.id} role="option" aria-selected={props.selected === wt.id} className={cx("row", "gitnut-proj-row", props.selected === wt.id && "gitnut-selected")} onClick={() => props.onSelect?.(wt)} title={wt.path} style={{ paddingLeft: 10 }}>
              <GitBranch size={12} className="gitnut-muted" />
              <span className="gitnut-proj-name">{worktreeLabel(wt)}</span>
              <span className="gitnut-tree-hint">{wt.path}</span>
              <span className="gitnut-toolbar-spacer" />
              {wt.ahead > 0 && <span className="gitnut-ab"><ArrowUp size={10} />{wt.ahead}</span>}
              {wt.behind > 0 && <span className="gitnut-ab"><ArrowDown size={10} />{wt.behind}</span>}
              {n > 0 && <span className={cx("badge", "gitnut-badge", "gitnut-badge-dirty")}>{n}</span>}
            </div>
          );
        })}
      </div>
    </GitnutRoot>
  );
}
