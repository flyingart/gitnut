import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Filter, Search } from "lucide-react";
import type { RefInfo } from "@gitnut/commons";
import { useLogActions } from "./actions";
import { useGraphSnapshot } from "./hooks";
import type { ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { RefIcon } from "./graph/refs";
import { Empty, isMenuKey, menuPointOf, Spinner, useContextMenu } from "./ui";

/** Props of {@link RefsList}. */
export interface RefsListProps extends StyleProps {
  server?: ServerProp;
  repoId: string;
  /** Single click: select the ref's commit in the log. */
  onNavigate?: (ref: RefInfo) => void;
  /** Double-click or the filter button: filter the log by this branch. */
  onFilter?: (ref: RefInfo) => void;
  /** Full names of refs in the active branch filter (highlighted). */
  filtered?: string[];
  /** Search field. Default true. */
  showSearch?: boolean;
  /** Right-click menu with checkout, new branch, merge, rebase, push, delete (R-ACT-3). Default true. */
  actions?: boolean;
  /** Worktree (id) that checkout / merge / rebase change. Default: the main worktree. */
  worktreeId?: string | null;
}

interface Section {
  id: string;
  title: string;
  refs: RefInfo[];
  children?: Section[];
}

/** Branches panel like IntelliJ's: HEAD, Local, Remote (per remote), Tags. */
export function RefsList(props: RefsListProps) {
  const cx = useCx();
  const { snapshot, loading } = useGraphSnapshot(props.repoId, props.server);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set(["tags"]));
  const logActions = useLogActions(props.repoId, props.server, props.worktreeId);
  const menu = useContextMenu();
  const openMenu = (at: { clientX: number; clientY: number }, r: RefInfo) => props.actions !== false && menu.open(at, logActions.refMenu(r));

  const sections = useMemo((): Section[] => {
    const q = query.trim().toLowerCase();
    const refs = (snapshot?.refs ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
    const by = (k: RefInfo["kind"]) => refs.filter((r) => r.kind === k).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const remotes = new Map<string, RefInfo[]>();
    for (const r of by("remote")) {
      const name = r.name.split("/")[0];
      remotes.set(name, [...(remotes.get(name) ?? []), r]);
    }
    const out: Section[] = [];
    const head = by("head");
    if (head.length) out.push({ id: "head", title: "HEAD (Current Branch)", refs: head });
    out.push({ id: "local", title: "Local", refs: by("local") });
    if (remotes.size) out.push({ id: "remote", title: "Remote", refs: [], children: [...remotes].map(([n, rs]) => ({ id: `remote:${n}`, title: n, refs: rs })) });
    const tags = by("tag").reverse();
    if (tags.length) out.push({ id: "tags", title: "Tags", refs: tags });
    return out;
  }, [snapshot, query]);

  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const head = snapshot?.refs.find((r) => r.kind === "head");
  const currentBranch = head && snapshot?.refs.find((r) => r.kind === "local" && r.commit === head.commit && head.worktrees.some((w) => r.worktrees.includes(w)));

  const renderRef = (r: RefInfo, depth: number, label?: string): ReactNode => (
    <div
      key={r.full}
      role="treeitem"
      tabIndex={-1}
      className={cx("row", "gitnut-refs-row", props.filtered?.includes(r.full) && "gitnut-selected")}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => props.onNavigate?.(r)}
      onDoubleClick={() => props.onFilter?.(r)}
      onContextMenu={(e) => {
        if (props.actions === false) return;
        e.preventDefault();
        openMenu(e, r);
      }}
      onKeyDown={(e) => {
        if (!isMenuKey(e)) return;
        e.preventDefault();
        openMenu(menuPointOf(e.currentTarget), r);
      }}
      title={r.worktrees.length ? `${r.full}\nChecked out in ${r.worktrees.join(", ")}` : r.full}
      data-ref={r.full}
    >
      <span className={`gitnut-ref-icon gitnut-ref-${r.kind}`}>
        <RefIcon kind={r.kind} size={12} />
      </span>
      <span className="gitnut-refs-name">{label ?? (r.kind === "remote" ? r.name.slice(r.name.indexOf("/") + 1) : r.name)}</span>
      {r.worktrees.length > 0 && r.kind === "local" && <span className="gitnut-refs-wt" title="Checked out in a worktree" />}
      {props.onFilter && (
        <button
          type="button"
          className="gitnut-refs-filter"
          title="Show only this branch"
          aria-label={`Filter by ${r.name}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onFilter!(r);
          }}
        >
          <Filter size={11} />
        </button>
      )}
    </div>
  );

  const renderSection = (s: Section, depth: number): ReactNode => {
    const open = !closed.has(s.id) || !!query;
    const n = s.refs.length + (s.children?.reduce((a, c) => a + c.refs.length, 0) ?? 0);
    return (
      <div key={s.id} role="group">
        <div className={cx("row", "gitnut-refs-section")} style={{ paddingLeft: 4 + depth * 14 }} onClick={() => toggle(s.id)} role="treeitem" aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{s.title}</span>
          <span className="gitnut-tree-count">{n}</span>
        </div>
        {open &&
          (s.id === "head"
            ? s.refs.map((r) => renderRef(r, depth + 1, currentBranch ? currentBranch.name : "HEAD (detached)"))
            : [...(s.children?.map((c) => renderSection(c, depth + 1)) ?? []), ...s.refs.map((r) => renderRef(r, depth + 1))])}
      </div>
    );
  };

  return (
    <GitnutRoot component="branches" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {props.showSearch !== false && (
        <div className={cx("toolbar", "gitnut-toolbar")}>
          <label className={cx("input", "gitnut-search")}>
            <Search size={13} className="gitnut-muted" />
            <input placeholder="Branches and tags" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search branches" />
          </label>
        </div>
      )}
      <div className={cx("tree", "gitnut-refs-tree", "gitnut-scroll")} role="tree" aria-label="Branches">
        {loading ? <div className="gitnut-center"><Spinner /></div> : sections.every((s) => !s.refs.length && !s.children?.length) ? <Empty title="No branches" /> : sections.map((s) => renderSection(s, 0))}
      </div>
      {menu.menu}
    </GitnutRoot>
  );
}
