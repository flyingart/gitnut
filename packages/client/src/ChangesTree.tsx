import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, File, Folder, GitBranch, List, ListTree, Server, Box } from "lucide-react";
import type { ChangeStatus, FileChange } from "@gitnut/commons";
import { copyPathItems } from "./actions";
import { GitnutRoot, useCx, useGitnutTheme, type StyleProps } from "./root";
import { rowHeightOf } from "./theme";
import { buildChangesTree, changesFromList, containerIds, filesOf, flattenTree, type ChangeItem, type TreeNode, type TreeRow } from "./tree";
import { Empty, IconButton, isMenuKey, menuPointOf, useContextMenu, useVirtualRows, type MenuItem } from "./ui";
import { useViewOptions } from "./viewOptions";

const STATUS_LETTER: Record<ChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  conflicted: "U",
  untracked: "?",
};

/** Props of {@link ChangesTree}. */
export interface ChangesTreeProps extends StyleProps {
  /** Changed files (keys = paths). Use `items` for grouped / multi-source trees. */
  changes?: FileChange[];
  /** Files with unique keys, optional groups (server → repo → worktree) and diff sources. */
  items?: ChangeItem[];
  /** Fix tree / flat (hides the toggle). Default: remembered view option. */
  mode?: "tree" | "flat";
  /** Key of the selected file (controlled). */
  selected?: string | null;
  /** A file got selected (click or arrow keys). */
  onSelect?: (item: ChangeItem) => void;
  /** Enter or double-click on a file. */
  onOpen?: (item: ChangeItem) => void;
  /** Show checkboxes (commit selection). */
  checkable?: boolean;
  /** Checked file keys (controlled, with `checkable`). */
  checked?: ReadonlySet<string>;
  onCheckedChange?: (keys: Set<string>) => void;
  /** Toolbar with expand / collapse all and the tree / flat toggle. Default true. */
  showToolbar?: boolean;
  /** Extra toolbar content (left side). */
  toolbar?: ReactNode;
  /** Shown when there are no files. */
  emptyText?: ReactNode;
  /** Status letters next to file names. Default false (IntelliJ only colours names). */
  showStatusLetters?: boolean;
  autoFocus?: boolean;
  /**
   * Right-click menu for a file or folder (`items`: the files below it). Default: Copy path.
   * Pass `false` for no menu.
   */
  contextMenu?: ((items: ChangeItem[]) => MenuItem[]) | false;
}

/** Changed files as a folder tree (IntelliJ compact middle packages, counts, status colours) or flat list. */
export function ChangesTree(props: ChangesTreeProps) {
  const { changes, items: givenItems, selected, onSelect, onOpen, checkable, checked, onCheckedChange, showToolbar = true, toolbar, emptyText, autoFocus } = props;
  const cx = useCx();
  const theme = useGitnutTheme();
  const rowHeight = rowHeightOf(theme);
  const { options, set, locked } = useViewOptions({ changesMode: props.mode });
  const mode = options.changesMode;
  const items = useMemo(() => givenItems ?? changesFromList(changes ?? []), [givenItems, changes]);
  const roots = useMemo(() => buildChangesTree(items, mode), [items, mode]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => flattenTree(roots, collapsed), [roots, collapsed]);
  const [leadId, setLeadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualRows(scrollRef, rows.length, rowHeight);
  const menu = useContextMenu();
  const openMenu = (at: { clientX: number; clientY: number }, node: TreeNode) => {
    if (props.contextMenu === false) return;
    const files = node.item ? [node.item] : filesOf([node]);
    if (!files.length) return;
    menu.open(at, props.contextMenu ? props.contextMenu(files) : copyPathItems(files.map((f) => f.change.path)));
  };

  // controlled selection by file key
  useEffect(() => {
    if (selected === undefined) return;
    const row = rows.find((r) => r.node.item?.key === selected);
    if (row && row.node.id !== leadId) setLeadId(row.node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows]);

  const leadIndex = rows.findIndex((r) => r.node.id === leadId);

  const checkedCount = useMemo(() => {
    const m = new Map<string, number>();
    if (!checkable || !checked) return m;
    const walk = (n: TreeNode): number => {
      const c = n.item ? (checked.has(n.item.key) ? 1 : 0) : n.children.reduce((s, x) => s + walk(x), 0);
      m.set(n.id, c);
      return c;
    };
    roots.forEach(walk);
    return m;
  }, [roots, checked, checkable]);

  const select = (row: TreeRow | undefined, scroll = true) => {
    if (!row) return;
    setLeadId(row.node.id);
    if (scroll) v.scrollToRow(rows.indexOf(row));
    if (row.node.item) onSelect?.(row.node.item);
  };
  const toggle = (node: TreeNode, open?: boolean) => {
    setCollapsed((c) => {
      const n = new Set(c);
      const isOpen = !n.has(node.id);
      if (open ?? !isOpen) n.delete(node.id);
      else n.add(node.id);
      return n;
    });
  };
  const toggleCheck = (node: TreeNode) => {
    if (!checked || !onCheckedChange) return;
    const files = node.item ? [node.item] : filesOf([node]);
    const all = files.every((f) => checked.has(f.key));
    const next = new Set(checked);
    for (const f of files) all ? next.delete(f.key) : next.add(f.key);
    onCheckedChange(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const row = rows[leadIndex];
    if (row && isMenuKey(e)) {
      e.preventDefault();
      openMenu(menuPointOf(scrollRef.current?.querySelector(`[aria-selected="true"]`)), row.node);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        select(rows[Math.min(rows.length - 1, leadIndex + 1)]);
        break;
      case "ArrowUp":
        select(rows[Math.max(0, leadIndex - 1)]);
        break;
      case "Home":
        select(rows[0]);
        break;
      case "End":
        select(rows[rows.length - 1]);
        break;
      case "ArrowRight":
        if (!row) return;
        if (row.node.children.length && collapsed.has(row.node.id)) toggle(row.node, true);
        else if (row.node.children.length) select(rows[leadIndex + 1]);
        break;
      case "ArrowLeft":
        if (!row) return;
        if (row.node.children.length && !collapsed.has(row.node.id)) toggle(row.node, false);
        else if (row.parent) select(rows.find((r) => r.node === row.parent));
        break;
      case "Enter":
        if (row?.node.item) onOpen?.(row.node.item);
        else if (row) toggle(row.node);
        break;
      case " ":
        if (row && checkable) toggleCheck(row.node);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const statusColor = (s: ChangeStatus) => `var(--gitnut-status-${s})`;
  const visible = rows.slice(v.first, v.last);
  const total = items.length;

  return (
    <GitnutRoot component="changes-tree" theme={props.theme} className={props.className} classNames={props.classNames} style={props.style}>
      {showToolbar && (
        <div className={cx("toolbar", "gitnut-toolbar")}>
          {toolbar}
          <span className="gitnut-toolbar-spacer" />
          <span className="gitnut-muted gitnut-count">
            {total} {total === 1 ? "file" : "files"}
          </span>
          <IconButton title="Expand all" icon={<ChevronsUpDown size={14} />} onClick={() => setCollapsed(new Set())} />
          <IconButton title="Collapse all" icon={<ChevronsDownUp size={14} />} onClick={() => setCollapsed(new Set(containerIds(roots)))} />
          {!locked("changesMode") && (
            <IconButton
              title={mode === "tree" ? "Show as flat list" : "Group by folder"}
              icon={mode === "tree" ? <List size={14} /> : <ListTree size={14} />}
              onClick={() => set("changesMode", mode === "tree" ? "flat" : "tree")}
            />
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className={cx("tree", "gitnut-tree", "gitnut-scroll")}
        tabIndex={0}
        role="tree"
        aria-label="Changed files"
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        data-mode={mode}
      >
        {!rows.length ? (
          <Empty title={emptyText ?? "No changes"} />
        ) : (
          <div style={{ height: rows.length * rowHeight, position: "relative" }}>
            {visible.map((row, i) => {
              const { node, depth } = row;
              const index = v.first + i;
              const isOpen = !collapsed.has(node.id);
              const c = node.item?.change;
              const cc = checkedCount.get(node.id) ?? 0;
              return (
                <div
                  key={node.id}
                  role="treeitem"
                  aria-selected={node.id === leadId}
                  aria-expanded={node.children.length ? isOpen : undefined}
                  aria-level={depth + 1}
                  data-kind={node.kind}
                  data-path={c?.path}
                  className={cx("row", "gitnut-tree-row", node.id === leadId && "gitnut-selected", node.kind === "group" && `gitnut-group-${node.group?.kind}`)}
                  style={{ top: index * rowHeight, height: rowHeight, paddingLeft: 6 + depth * 16 }}
                  onMouseDown={(e) => {
                    if (e.button === 0) select(row, false);
                  }}
                  onDoubleClick={() => (node.item ? onOpen?.(node.item) : toggle(node))}
                  onContextMenu={(e) => {
                    if (props.contextMenu === false) return;
                    e.preventDefault();
                    select(row, false);
                    openMenu(e, node);
                  }}
                >
                  <span
                    className="gitnut-tree-chevron"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      toggle(node);
                    }}
                  >
                    {node.children.length ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
                  </span>
                  {checkable && (
                    <input
                      type="checkbox"
                      className="gitnut-check"
                      aria-label={`Include ${node.name}`}
                      checked={node.item ? cc === 1 : cc > 0 && cc === node.fileCount}
                      ref={(el) => {
                        if (el) el.indeterminate = !node.item && cc > 0 && cc < node.fileCount;
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={() => toggleCheck(node)}
                    />
                  )}
                  <NodeIcon node={node} />
                  {c ? (
                    <>
                      <span className="gitnut-tree-name" style={{ color: statusColor(c.status) }} data-status={c.status}>
                        {node.name}
                      </span>
                      {props.showStatusLetters && (
                        <span className="gitnut-status-letter" style={{ color: statusColor(c.status) }}>
                          {STATUS_LETTER[c.status]}
                        </span>
                      )}
                      {node.dir && <span className="gitnut-tree-hint">{node.dir}</span>}
                      {c.oldPath && c.oldPath !== c.path && <span className="gitnut-tree-hint">← {c.oldPath}</span>}
                    </>
                  ) : (
                    <>
                      <span className="gitnut-tree-name">{node.name}</span>
                      {node.group?.detail && <span className="gitnut-tree-hint">{node.group.detail}</span>}
                      <span className="gitnut-tree-count">
                        {node.fileCount} {node.fileCount === 1 ? "file" : "files"}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {menu.menu}
    </GitnutRoot>
  );
}

function NodeIcon({ node }: { node: TreeNode }) {
  if (node.kind === "file") return <File size={13} className="gitnut-tree-icon" style={{ color: `var(--gitnut-status-${node.item!.change.status})` }} />;
  if (node.kind === "folder") return <Folder size={13} className="gitnut-tree-icon gitnut-folder-icon" />;
  const k = node.group?.kind;
  const Icon = k === "server" ? Server : k === "repo" ? Box : GitBranch;
  return <Icon size={13} className="gitnut-tree-icon gitnut-group-icon" />;
}
