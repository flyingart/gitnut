import { useCallback, useMemo, useRef, useState } from "react";
import { Maximize2, PanelBottom, PanelLeft, RefreshCw, X } from "lucide-react";
import { useGitAction, WorktreePicker } from "./actions";
import { ChangesBrowser } from "./ChangesBrowser";
import { ChangesTree } from "./ChangesTree";
import { CommitDetails } from "./CommitDetails";
import { CommitGraph, type CommitGraphController } from "./CommitGraph";
import { DiffViewer, type DiffController } from "./DiffViewer";
import type { LogFilter } from "./graph/FilterBar";
import { useCommitsChanges, useRepos } from "./hooks";
import type { ServerProp } from "./provider";
import { RefsList } from "./RefsList";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { Split } from "./Split";
import { buildChangesTree, changesFromList, filesOf, type ChangeItem } from "./tree";
import { Button, IconButton } from "./ui";
import { useViewOptions } from "./viewOptions";

/** Props of {@link LogView}. */
export interface LogViewProps extends StyleProps {
  server?: ServerProp;
  repoId: string;
  /** Fix the branches panel visibility. */
  showRefs?: boolean;
  /** Fix the diff preview pane. */
  diffPreview?: "bottom" | "off";
  /** Worktree (id) that log actions change. Default: the main one, with a picker when there are several. */
  worktreeId?: string;
  /** Git actions (toolbar Fetch, right-click menus). Default true. */
  actions?: boolean;
}

/** IntelliJ's Git log tab: branches, filters + graph, changes of the selection with details, diff preview. */
export function LogView(props: LogViewProps) {
  const cx = useCx();
  const { server, repoId } = props;
  const { options, set, locked } = useViewOptions({ showRefs: props.showRefs, diffPreview: props.diffPreview });
  const [hashes, setHashes] = useState<string[]>([]);
  const [filter, setFilter] = useState<LogFilter>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<"first" | "last">("first");
  const [full, setFull] = useState(false);
  const graphCtl = useRef<CommitGraphController>(null);
  const diffCtl = useRef<DiffController>(null);
  const { changes, truncated, loading } = useCommitsChanges(repoId, hashes, server);
  const { repos } = useRepos(server);
  const repo = repos.find((r) => r.id === repoId) ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const target = props.worktreeId ?? picked ?? undefined;
  const { run, busy } = useGitAction(server);
  const actions = props.actions !== false;
  const source = useMemo(() => ({ server, repoId }), [server, repoId]);
  const items = useMemo(() => changesFromList(changes, source), [changes, source]);
  const ordered = useMemo(() => filesOf(buildChangesTree(items, options.changesMode)), [items, options.changesMode]);
  const selected = ordered.find((i) => i.key === selectedKey) ?? ordered[0] ?? null;

  const onSelection = useCallback((h: string[]) => {
    setHashes(h);
    setSelectedKey(null);
  }, []);
  const move = (dir: 1 | -1) => {
    const next = ordered[(selected ? ordered.indexOf(selected) : -1) + dir];
    if (!next) return false;
    setStartAt(dir > 0 ? "first" : "last");
    setSelectedKey(next.key);
    return true;
  };
  const open = (item?: ChangeItem) => {
    if (item) setSelectedKey(item.key);
    setFull(true);
  };

  const graph = (
    <CommitGraph
      server={server}
      repoId={repoId}
      controllerRef={graphCtl}
      filter={filter}
      onFilterChange={setFilter}
      onSelectionChange={onSelection}
      onOpen={() => open()}
      autoFocus
      actions={actions}
      worktreeId={target}
      toolbarEnd={
        <>
          {actions && !props.worktreeId && <WorktreePicker repo={repo} value={target} onChange={setPicked} />}
          {actions && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={13} />}
              busy={busy === "Fetch"}
              title="Fetch all remotes"
              onClick={() => void run("repo.fetch", { repoId }, { label: "Fetch", success: (r) => (r.output.trim() ? "Fetched" : "Fetched: everything is up to date") })}
            >
              Fetch
            </Button>
          )}
          {!locked("showRefs") && <IconButton title={options.showRefs ? "Hide branches" : "Show branches"} icon={<PanelLeft size={14} />} active={options.showRefs} onClick={() => set("showRefs", !options.showRefs)} />}
          {!locked("diffPreview") && (
            <IconButton title={options.diffPreview === "off" ? "Show diff preview" : "Hide diff preview"} icon={<PanelBottom size={14} />} active={options.diffPreview !== "off"} onClick={() => set("diffPreview", options.diffPreview === "off" ? "bottom" : "off")} />
          )}
          <IconButton title="Open diff (Ctrl+D)" icon={<Maximize2 size={14} />} disabled={!selected} onClick={() => setFull(true)} />
        </>
      }
    />
  );
  const right = (
    <Split direction="column" id="log.details" defaultSize={260} sized="second" min={80}>
      <ChangesTree
        items={items}
        selected={selected?.key ?? null}
        onSelect={(i) => setSelectedKey(i.key)}
        onOpen={open}
        emptyText={loading ? "Loading changes…" : hashes.length ? "No changed files" : "Select a commit"}
        toolbar={truncated ? <span className="gitnut-muted gitnut-count">first 2000 files</span> : undefined}
      />
      <CommitDetails server={server} repoId={repoId} hashes={hashes} onNavigate={(h) => setFilter({ ...filter, text: h })} />
    </Split>
  );
  const main = (
    <Split direction="row" id="log.right" defaultSize={340} sized="second" min={200}>
      {graph}
      {right}
    </Split>
  );
  const top = (
    <Split direction="row" id="log.refs" defaultSize={210} min={140} hideFirst={!options.showRefs}>
      <RefsList
        server={server}
        repoId={repoId}
        filtered={filter.branches}
        actions={actions}
        worktreeId={target}
        onNavigate={(r) => graphCtl.current?.selectCommit(r.commit)}
        onFilter={(r) => setFilter({ ...filter, branches: filter.branches?.length === 1 && filter.branches[0] === r.full ? undefined : [r.full] })}
      />
      {main}
    </Split>
  );

  return (
    <GitnutRoot
      component="log-view"
      theme={props.theme}
      className={props.className}
      classNames={props.classNames}
      style={props.style}
      onKeyDown={(e) => {
        if (e.key === "F7" && options.diffPreview !== "off") {
          e.preventDefault();
          if (e.shiftKey) diffCtl.current?.prev();
          else diffCtl.current?.next();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selected) {
          e.preventDefault();
          setFull(true);
        }
      }}
    >
      <div className="gitnut-fill gitnut-rel">
        {(
          <Split direction="column" id="log.preview" defaultSize={300} sized="second" min={120} collapsed={options.diffPreview === "off"}>
            {top}
            <DiffViewer
              server={server}
              repoId={repoId}
              change={selected?.change ?? null}
              startAt={startAt}
              controllerRef={diffCtl}
              onNextFile={() => move(1)}
              onPrevFile={() => move(-1)}
            />
          </Split>
        )}
        {full && (
          <div className="gitnut-full-diff gitnut-glass" role="dialog" aria-label="Changes" onKeyDown={(e) => e.key === "Escape" && setFull(false)}>
            <div className={cx("toolbar", "gitnut-toolbar")}>
              <span className="gitnut-strong">{hashes.length === 1 ? `Changes in ${hashes[0].slice(0, 8)}` : `Changes in ${hashes.length} commits`}</span>
              <span className="gitnut-toolbar-spacer" />
              <IconButton title="Close (Esc)" icon={<X size={14} />} onClick={() => setFull(false)} />
            </div>
            <ChangesBrowser items={items} selected={selected?.key ?? null} onSelect={(i) => i && setSelectedKey(i.key)} splitId="full" tree={{ autoFocus: true }} />
          </div>
        )}
      </div>
    </GitnutRoot>
  );
}
