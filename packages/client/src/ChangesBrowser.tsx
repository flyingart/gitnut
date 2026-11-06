import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { FileChange } from "@gitnut/commons";
import { ChangesTree, type ChangesTreeProps } from "./ChangesTree";
import { DiffViewer, type DiffController, type DiffViewerProps } from "./DiffViewer";
import type { ServerProp } from "./provider";
import { GitnutRoot, type StyleProps } from "./root";
import { Split } from "./Split";
import { buildChangesTree, changesFromList, filesOf, type ChangeItem } from "./tree";
import { useViewOptions } from "./viewOptions";

/** Props of {@link ChangesBrowser}. */
export interface ChangesBrowserProps extends StyleProps {
  changes?: FileChange[];
  items?: ChangeItem[];
  /** Diff source for items without their own `source`. */
  server?: ServerProp;
  repoId?: string;
  worktreeId?: string;
  /** Tree beside the diff ("row", default) or above it ("column"). */
  layout?: "row" | "column";
  /** Splitter id to remember the tree size. */
  splitId?: string;
  /** Tree / flat (fixes the option). */
  mode?: "tree" | "flat";
  /** Options passed to the diff viewer. */
  diff?: Pick<DiffViewerProps, "mode" | "ignoreWhitespace" | "collapseUnchanged" | "highlightWords" | "showHeader" | "showToolbar">;
  /** Selected file key (controlled). */
  selected?: string | null;
  onSelect?: (item: ChangeItem | null) => void;
  onOpen?: (item: ChangeItem) => void;
  /** Extra props for the tree (checkboxes, toolbar…). */
  tree?: Omit<ChangesTreeProps, "changes" | "items" | "selected" | "onSelect" | "onOpen" | "mode">;
  /** Content below the tree (commit panel). */
  treeFooter?: ReactNode;
  /** Select the first file when nothing is selected. Default true. */
  autoSelect?: boolean;
  emptyText?: ReactNode;
}

/** Changes tree + diff viewer. Arrow keys in the tree update the diff; F7 / Shift+F7 move through changes and files. */
export function ChangesBrowser(props: ChangesBrowserProps) {
  const { options } = useViewOptions({ changesMode: props.mode });
  const items = useMemo(
    () => props.items ?? changesFromList(props.changes ?? [], props.repoId ? { server: props.server, repoId: props.repoId, worktreeId: props.worktreeId } : undefined),
    [props.items, props.changes, props.server, props.repoId, props.worktreeId],
  );
  // files in display order, for F7 across files
  const ordered = useMemo(() => filesOf(buildChangesTree(items, options.changesMode)), [items, options.changesMode]);
  const [own, setOwn] = useState<string | null>(null);
  const selectedKey = props.selected !== undefined ? props.selected : own;
  const selected = ordered.find((i) => i.key === selectedKey) ?? null;
  const [startAt, setStartAt] = useState<"first" | "last">("first");
  const ctl = useRef<DiffController>(null);

  const select = (item: ChangeItem | null, at: "first" | "last" = "first") => {
    setStartAt(at);
    setOwn(item?.key ?? null);
    props.onSelect?.(item);
  };

  useEffect(() => {
    if (props.autoSelect === false) return;
    if (!selected && ordered.length) select(ordered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, selected]);

  const move = (dir: 1 | -1) => {
    const i = selected ? ordered.indexOf(selected) : -1;
    const next = ordered[i + dir];
    if (!next) return false;
    select(next, dir > 0 ? "first" : "last");
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "F7") return;
    e.preventDefault();
    if (e.shiftKey) ctl.current?.prev();
    else ctl.current?.next();
  };

  const src = selected?.source ?? (props.repoId ? { server: props.server, repoId: props.repoId, worktreeId: props.worktreeId } : null);
  const tree = (
    <div className="gitnut-browser-tree">
      <ChangesTree
        {...props.tree}
        items={items}
        mode={props.mode}
        selected={selected?.key ?? null}
        onSelect={(i) => select(i)}
        onOpen={props.onOpen}
        emptyText={props.emptyText}
      />
      {props.treeFooter}
    </div>
  );
  const diff = (
    <DiffViewer
      {...props.diff}
      server={src?.server}
      repoId={src?.repoId}
      worktreeId={src?.worktreeId}
      change={selected?.change ?? null}
      startAt={startAt}
      controllerRef={ctl}
      onNextFile={() => move(1)}
      onPrevFile={() => move(-1)}
    />
  );
  const layout = props.layout ?? "row";
  return (
    <GitnutRoot component="changes-browser" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style} onKeyDown={onKeyDown}>
      <Split direction={layout} id={props.splitId ?? `browser.${layout}`} defaultSize={layout === "row" ? 300 : 320} min={140}>
        {tree}
        {diff}
      </Split>
    </GitnutRoot>
  );
}
