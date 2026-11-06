import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import { Settings2, GitCommitHorizontal } from "lucide-react";
import { elementAt, graphPaintMetrics, type CommitDetails, type PrintElement, type RefInfo, type SortType } from "@gitnut/commons";
import { useLogActions } from "./actions";
import { useDetailsVersion, useGraph } from "./hooks";
import type { ServerProp } from "./provider";
import { GitnutRoot, useCx, useGitnutTheme, type StyleProps } from "./root";
import { rowHeightOf } from "./theme";
import { laneColors, paintRows, solidColor } from "./graph/canvas";
import { FilterBar, toGraphFilter, type LogFilter } from "./graph/FilterBar";
import { RefPills } from "./graph/refs";
import { clickSelection, moveSelection, type ListSelection } from "./selection";
import { Empty, formatDate, isMenuKey, Popover, Spinner, useContextMenu, useVirtualRows } from "./ui";
import { useViewOptions, type CommitColumn } from "./viewOptions";

/** Imperative access, e.g. for a branches panel. */
export interface CommitGraphController {
  /** Select a commit (snapshot index) and scroll it to the middle. */
  selectCommit(commit: number): void;
  setFilter(f: LogFilter): void;
}

/** Props of {@link CommitGraph}. */
export interface CommitGraphProps extends StyleProps {
  server?: ServerProp;
  repoId: string;
  /** Fix the sort (hides the option). Default: remembered, IntelliJ sort. */
  sort?: SortType;
  /** Fix "show long edges". */
  showLongEdges?: boolean;
  /** Fix the visible columns (author, date, hash). */
  columns?: CommitColumn[];
  /** Filter bar with text, branch, user, date and path filters. Default true. */
  showFilterBar?: boolean;
  /** Initial or controlled filter. */
  filter?: LogFilter;
  onFilterChange?: (f: LogFilter) => void;
  /** Selection changed: commit hashes in table order (newest first) and their rows. */
  onSelectionChange?: (hashes: string[], commits: CommitDetails[]) => void;
  /** Double-click or Enter on a commit. */
  onOpen?: (hash: string) => void;
  /** Max ref labels per row. Default 3. */
  maxRefLabels?: number;
  controllerRef?: Ref<CommitGraphController>;
  autoFocus?: boolean;
  /** Extra buttons at the end of the filter bar. */
  toolbarEnd?: ReactNode;
  /** Right-click menus on commits and ref labels with git actions (R-ACT-2, R-ACT-3). Default true. */
  actions?: boolean;
  /** Worktree (id) that checkout, cherry-pick, merge, reset… change. Default: the main worktree. */
  worktreeId?: string | null;
}

const COL_W: Record<CommitColumn, number> = { author: 136, date: 146, hash: 74 };
const NO_SEL: ListSelection = { rows: new Set(), anchor: null, lead: null };

/** IntelliJ log table: canvas graph + subject with ref labels + author + date + hash; virtualized, multi-select. */
export function CommitGraph(props: CommitGraphProps) {
  const cx = useCx();
  const theme = useGitnutTheme();
  const rh = rowHeightOf(theme);
  const { options, set, locked } = useViewOptions({ graphSort: props.sort, showLongEdges: props.showLongEdges, columns: props.columns });
  const [ownFilter, setOwnFilter] = useState<LogFilter>(props.filter ?? {});
  const filter = props.onFilterChange && props.filter ? props.filter : ownFilter;
  const setFilter = (f: LogFilter) => (props.onFilterChange ? props.onFilterChange(f) : setOwnFilter(f));

  // a hash in the text field navigates instead of filtering
  const [hashHit, setHashHit] = useState<{ text: string; index: number } | null>(null);
  const hashLike = !!filter.text && /^[0-9a-f]{6,40}$/i.test(filter.text);
  const effective = hashLike && hashHit?.text === filter.text && hashHit!.index >= 0 ? { ...filter, text: undefined } : filter;
  const graphFilter = useMemo(() => toGraphFilter(effective), [effective.text, effective.author, effective.path, effective.days]); // eslint-disable-line

  const data = useGraph(props.repoId, props.server, { sort: options.graphSort, showLongEdges: options.showLongEdges, filter: graphFilter, branches: effective.branches });
  const { graph, details, snapshot } = data;
  useDetailsVersion(details);
  const logActions = useLogActions(props.repoId, props.server, props.worktreeId);
  const menu = useContextMenu();

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowCount = graph?.rowCount ?? 0;
  const v = useVirtualRows(scrollRef, rowCount, rh, 4);

  // selection as snapshot commit indices (stable across sort / filter changes)
  const [selected, setSelected] = useState<{ commits: number[]; anchor: number | null; lead: number | null }>({ commits: [], anchor: null, lead: null });
  const selectedSet = useMemo(() => new Set(selected.commits), [selected.commits]);
  const selectedHashes = useRef<string[]>([]);

  const refsByCommit = useMemo(() => {
    const m = new Map<number, RefInfo[]>();
    for (const r of snapshot?.refs ?? []) {
      const list = m.get(r.commit);
      if (list) list.push(r);
      else m.set(r.commit, [r]);
    }
    return m;
  }, [snapshot]);

  const toRows = (): ListSelection => {
    if (!graph) return NO_SEL;
    const rows = new Set<number>();
    for (const c of selected.commits) {
      const r = graph.rowOf(c);
      if (r >= 0) rows.add(r);
    }
    const r = (c: number | null) => (c === null ? null : graph.rowOf(c) >= 0 ? graph.rowOf(c) : null);
    return { rows, anchor: r(selected.anchor), lead: r(selected.lead) };
  };
  const applyRows = (sel: ListSelection) => {
    if (!graph) return;
    const commits = [...sel.rows].sort((a, b) => a - b).map((r) => graph.commitAt(r));
    const c = (r: number | null) => (r === null ? null : graph.commitAt(r));
    setSelected({ commits, anchor: c(sel.anchor), lead: c(sel.lead) });
    if (sel.lead !== null) v.scrollToRow(sel.lead);
  };

  const selectCommit = useCallback(
    (commit: number) => {
      if (!graph) return;
      const row = graph.rowOf(commit);
      if (row < 0) return;
      setSelected({ commits: [commit], anchor: commit, lead: commit });
      v.scrollToRow(row, true);
    },
    [graph, v],
  );
  useImperativeHandle(props.controllerRef, () => ({ selectCommit, setFilter }));

  // report selection (hashes) once details are known
  const onSel = props.onSelectionChange;
  useEffect(() => {
    if (!details) return;
    let alive = true;
    void details.load(selected.commits).then((rows) => {
      if (!alive) return;
      const hashes = rows.map((r) => r.hash);
      if (hashes.join() === selectedHashes.current.join()) return;
      selectedHashes.current = hashes;
      onSel?.(hashes, rows);
    }, () => {});
    return () => {
      alive = false;
    };
  }, [selected.commits, details, onSel]);

  // keep the selection when the graph changes (new commits shift indices): remap by hash
  const lastGraphId = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot || !data.conn) return;
    const prev = lastGraphId.current;
    lastGraphId.current = snapshot.graphId;
    if (!prev || prev === snapshot.graphId || !selectedHashes.current.length) return;
    const conn = data.conn;
    void Promise.all(selectedHashes.current.slice(0, 50).map((hash) => conn.call("commit.full", { repoId: props.repoId, hash }).then((c) => c.index, () => -1))).then((idx) => {
      const commits = idx.filter((i) => i >= 0);
      setSelected({ commits, anchor: commits[0] ?? null, lead: commits[0] ?? null });
    });
  }, [snapshot, data.conn, props.repoId]);

  // select the first row (HEAD side) initially, like IntelliJ
  useEffect(() => {
    if (graph && rowCount && !selected.commits.length && !selectedHashes.current.length) {
      const head = snapshot?.refs.find((r) => r.kind === "head");
      const row = head ? graph.rowOf(head.commit) : -1;
      const c = graph.commitAt(Math.max(row, 0));
      setSelected({ commits: [c], anchor: c, lead: c });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // hash navigation
  useEffect(() => {
    if (!hashLike || !data.conn) return;
    const text = filter.text!;
    let alive = true;
    data.conn.call("commit.full", { repoId: props.repoId, hash: text }).then(
      (c) => alive && setHashHit({ text, index: c.index }),
      () => alive && setHashHit({ text, index: -1 }),
    );
    return () => {
      alive = false;
    };
  }, [hashLike, filter.text, data.conn, props.repoId]);
  useEffect(() => {
    if (hashHit && hashHit.index >= 0 && hashHit.text === filter.text) selectCommit(hashHit.index);
  }, [hashHit, graph]); // eslint-disable-line

  // lazy details for the visible rows
  useEffect(() => {
    if (!graph || !details) return;
    const want: number[] = [];
    for (let r = Math.max(0, v.first - 40); r < Math.min(rowCount, v.last + 40); r++) want.push(graph.commitAt(r));
    details.ensure(want);
  }, [graph, details, v.first, v.last, rowCount]);

  // graph geometry
  const paintParams = useMemo(() => ({ rowHeight: rh, colors: laneColors(theme), markColor: theme.colors.text, neutralColor: theme.colors.mutedText }), [rh, theme]);
  const metrics = useMemo(() => graphPaintMetrics(paintParams), [paintParams]);
  const lane = metrics.elementWidth;
  let maxLanes = 1;
  if (graph) for (let r = v.first; r < v.last; r++) maxLanes = Math.max(maxLanes, graph.maxPosition(r) + 1);
  const graphWidth = Math.min(maxLanes * lane + 6, 600);

  const [hovered, setHovered] = useState<{ row: number; element: PrintElement } | null>(null);
  const bg = useRef<{ base: string; selected: string } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const base = solidColor(el, "var(--gitnut-background)", "var(--gitnut-background)");
    bg.current = { base, selected: solidColor(el, "var(--gitnut-selection)", base) };
  }, [theme, graph]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;
    paintRows({
      canvas,
      graph,
      first: v.first,
      last: v.last,
      scrollTop: v.top,
      width: graphWidth,
      height: v.height,
      params: paintParams,
      background: (row) => (selectedSet.has(graph.commitAt(row)) ? bg.current?.selected : bg.current?.base) ?? "#000",
      hovered,
    });
  });

  const rowFromEvent = (e: MouseEvent) => {
    const el = scrollRef.current!;
    const y = e.clientY - el.getBoundingClientRect().top + el.scrollTop;
    return Math.floor(y / rh);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!graph) return;
    const row = rowFromEvent(e);
    const x = e.clientX - scrollRef.current!.getBoundingClientRect().left;
    const y = e.clientY - scrollRef.current!.getBoundingClientRect().top + scrollRef.current!.scrollTop - row * rh;
    const el = row >= 0 && row < rowCount && x < graphWidth ? elementAt(graph.printElements(row), x, y, paintParams) : null;
    if (el?.type === "node") return hovered && setHovered(null); // IntelliJ highlights edges, a node just selects
    if ((el ?? null) !== (hovered?.element ?? null)) setHovered(el ? { row, element: el } : null);
  };

  const onRowMouseDown = (e: MouseEvent, row: number) => {
    if (e.button !== 0 || !graph) return;
    // click on a cut edge's arrow jumps to the commit at its other end
    if (hovered?.row === row && hovered.element.type === "edge" && hovered.element.jumpTo !== undefined) {
      selectCommit(hovered.element.jumpTo);
      return;
    }
    applyRows(clickSelection(toRows(), row, { toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey }));
  };

  // right-click: a row outside the selection selects it alone first (IntelliJ)
  const openCommitMenu = (at: { clientX: number; clientY: number }, row: number) => {
    if (props.actions === false || !graph || !details) return;
    const commit = graph.commitAt(row);
    let commits = selected.commits;
    if (!selectedSet.has(commit)) {
      commits = [commit];
      setSelected({ commits, anchor: commit, lead: commit });
    }
    void details.load(commits).then((rows) => rows.length && menu.open(at, logActions.commitMenu(rows)), () => {});
  };
  const openRefMenu = (at: { clientX: number; clientY: number }, ref: RefInfo) => {
    if (props.actions !== false) menu.open(at, logActions.refMenu(ref));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!graph) return;
    if (isMenuKey(e)) {
      const lead = toRows().lead;
      if (lead === null) return;
      e.preventDefault();
      const r = scrollRef.current!.getBoundingClientRect();
      openCommitMenu({ clientX: r.left + 40, clientY: r.top + (lead + 1) * rh - scrollRef.current!.scrollTop }, lead);
      return;
    }
    const page = Math.max(1, Math.floor(v.height / rh) - 1);
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, End: rowCount, Home: -rowCount };
    if (e.key in moves) {
      e.preventDefault();
      applyRows(moveSelection(toRows(), moves[e.key], rowCount, e.shiftKey));
    } else if (e.key === "Enter" && selectedHashes.current[0]) {
      e.preventDefault();
      props.onOpen?.(selectedHashes.current[0]);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      if (rowCount <= 1000) applyRows({ rows: new Set(Array.from({ length: rowCount }, (_, i) => i)), anchor: 0, lead: toRows().lead ?? 0 });
    }
  };

  const authors = useMemo(() => {
    if (!graph || !details) return [];
    const s = new Set<string>();
    for (let r = v.first; r < v.last; r++) {
      const d = details.get(graph.commitAt(r));
      if (d) s.add(d.authorName);
    }
    return [...s].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, details, details?.version, v.first]);

  const cols = options.columns;
  const rowHandlers = {
    down: onRowMouseDown,
    open: (h: string) => props.onOpen?.(h),
    menu: (e: MouseEvent, row: number) => {
      if (props.actions === false) return;
      e.preventDefault();
      openCommitMenu(e, row);
    },
    refMenu: (e: MouseEvent, ref: RefInfo) => {
      if (props.actions === false) return;
      e.preventDefault();
      e.stopPropagation();
      openRefMenu(e, ref);
    },
  };
  const handlers = useRef(rowHandlers);
  handlers.current = rowHandlers;
  const rows = [];
  if (graph) {
    for (let row = v.first; row < v.last; row++) {
      const commit = graph.commitAt(row);
      rows.push(
        <LogRow
          key={row}
          row={row}
          rh={rh}
          commit={commit}
          d={details?.get(commit)}
          selected={selectedSet.has(commit)}
          indent={(graph.maxPosition(row) + 1) * lane + 8}
          refs={refsByCommit.get(commit)}
          cols={cols}
          maxRefs={props.maxRefLabels ?? 3}
          jump={row === hovered?.row && hovered.element.type === "edge" && hovered.element.jumpTo !== undefined}
          handlers={handlers}
          rowClass={cx("row", "gitnut-log-row")}
        />,
      );
    }
  }

  return (
    <GitnutRoot component="log" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {props.showFilterBar !== false && (
        <div className="gitnut-log-top">
          <FilterBar value={filter} onChange={setFilter} refs={snapshot?.refs ?? []} authors={authors} busy={data.filtering} />
          {props.toolbarEnd}
          <Popover title="View options" icon={<Settings2 size={14} />} align="right">
            {() => (
              <div className="gitnut-menu">
                {!locked("graphSort") && (
                  <>
                    <div className="gitnut-menu-label">Sort</div>
                    {(
                      [
                        ["intellij", "IntelliSort"],
                        ["topological", "Topological"],
                        ["date", "By date"],
                      ] as const
                    ).map(([k, label]) => (
                      <button key={k} type="button" className={`gitnut-menu-item${options.graphSort === k ? " gitnut-active" : ""}`} onClick={() => set("graphSort", k)}>
                        <input type="radio" readOnly checked={options.graphSort === k} tabIndex={-1} />
                        {label}
                      </button>
                    ))}
                  </>
                )}
                {!locked("showLongEdges") && (
                  <label className="gitnut-menu-item">
                    <input type="checkbox" checked={options.showLongEdges} onChange={() => set("showLongEdges", !options.showLongEdges)} />
                    Show long edges
                  </label>
                )}
                {!locked("columns") && (
                  <>
                    <div className="gitnut-menu-label">Columns</div>
                    {(["author", "date", "hash"] as const).map((c) => (
                      <label key={c} className="gitnut-menu-item">
                        <input type="checkbox" checked={cols.includes(c)} onChange={() => set("columns", cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c])} />
                        {c === "author" ? "Author" : c === "date" ? "Date" : "Hash"}
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </Popover>
        </div>
      )}
      <div className="gitnut-log-body">
        <canvas ref={canvasRef} className="gitnut-log-canvas" aria-hidden />
        <div
          ref={scrollRef}
          className={cx("table", "gitnut-log-scroll", "gitnut-scroll")}
          role="grid"
          aria-label="Commits"
          aria-rowcount={rowCount}
          tabIndex={0}
          autoFocus={props.autoFocus}
          onKeyDown={onKeyDown}
          onMouseMove={onMouseMove}
          onMouseLeave={() => hovered && setHovered(null)}
        >
          <div style={{ height: rowCount * rh, position: "relative" }}>{rows}</div>
        </div>
        {(data.loading || (!graph && data.filtering)) && (
          <div className="gitnut-center gitnut-overlay">
            <Spinner size={18} />
            <span className="gitnut-muted">{data.loading ? "Loading history…" : "Filtering…"}</span>
          </div>
        )}
        {data.error && !snapshot && <Empty title="Couldn't load the history">{data.error.message}</Empty>}
        {graph && !rowCount && <Empty icon={<GitCommitHorizontal size={22} />} title={hasAnyFilter(filter) ? "No commits match the filters" : "No commits yet"} />}
      </div>
      {menu.menu}
    </GitnutRoot>
  );
}

const hasAnyFilter = (f: LogFilter) => !!(f.text || f.author || f.path || f.days || f.branches?.length);

interface LogRowProps {
  row: number;
  rh: number;
  commit: number;
  d: CommitDetails | undefined;
  selected: boolean;
  indent: number;
  refs: RefInfo[] | undefined;
  cols: CommitColumn[];
  maxRefs: number;
  jump: boolean;
  rowClass: string;
  handlers: {
    current: {
      down: (e: MouseEvent, row: number) => void;
      open: (hash: string) => void;
      menu: (e: MouseEvent, row: number) => void;
      refMenu: (e: MouseEvent, ref: RefInfo) => void;
    };
  };
}

/** One commit row; memoized so scrolling only renders rows that come into view. */
const LogRow = memo(function LogRow({ row, rh, commit, d, selected, indent, refs, cols, maxRefs, jump, rowClass, handlers }: LogRowProps) {
  return (
    <div
      role="row"
      aria-selected={selected}
      data-commit={commit}
      data-hash={d?.hash}
      className={`${rowClass}${selected ? " gitnut-selected" : ""}${jump ? " gitnut-jump" : ""}`}
      style={{ top: row * rh, height: rh }}
      onMouseDown={(e) => handlers.current.down(e, row)}
      onDoubleClick={() => d && handlers.current.open(d.hash)}
      onContextMenu={(e) => handlers.current.menu(e, row)}
    >
      <div role="gridcell" className="gitnut-log-subject" style={{ paddingLeft: indent }}>
        {refs && <RefPills refs={refs} max={maxRefs} onContextMenu={(e, l) => handlers.current.refMenu(e, l.refs[0])} />}
        <span className={d ? "gitnut-log-subject-text" : "gitnut-log-subject-text gitnut-skeleton"}>{d?.subject ?? "\u00a0"}</span>
      </div>
      {cols.includes("author") && (
        <div role="gridcell" className="gitnut-log-cell gitnut-log-author" style={{ width: COL_W.author }} title={d?.authorEmail}>
          {d?.authorName}
        </div>
      )}
      {cols.includes("date") && (
        <div role="gridcell" className="gitnut-log-cell gitnut-log-date" style={{ width: COL_W.date }}>
          {d && formatDate(d.authorTime)}
        </div>
      )}
      {cols.includes("hash") && (
        <div role="gridcell" className="gitnut-log-cell gitnut-log-hash gitnut-mono" style={{ width: COL_W.hash }}>
          {d?.hash.slice(0, 8)}
        </div>
      )}
    </div>
  );
});
