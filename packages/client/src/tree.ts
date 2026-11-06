import type { FileChange } from "@gitnut/commons";
import type { ServerProp } from "./provider";

/** A grouping level above the folders (combined local changes: server → repo → worktree). */
export interface TreeGroup {
  id: string;
  label: string;
  kind: "server" | "repo" | "worktree";
  /** Secondary text (branch, path). */
  detail?: string;
}

/** Where a change's contents come from (for the diff). */
export interface DiffSource {
  server?: ServerProp;
  repoId: string;
  worktreeId?: string;
}

/** One file in a changes tree. `key` must be unique within the tree. */
export interface ChangeItem {
  key: string;
  change: FileChange;
  groups?: TreeGroup[];
  source?: DiffSource;
}

export interface TreeNode {
  id: string;
  kind: "group" | "folder" | "file";
  /** Display name: a compacted folder chain (`src/main/kotlin`) or the file name. */
  name: string;
  /** Flat mode: the folder of the file. */
  dir?: string;
  group?: TreeGroup;
  item?: ChangeItem;
  children: TreeNode[];
  /** Files below this node. */
  fileCount: number;
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  parent: TreeNode | null;
}

export type ChangesMode = "tree" | "flat";

export const changesFromList = (changes: FileChange[], source?: DiffSource): ChangeItem[] =>
  changes.map((change) => ({ key: change.path, change, source }));

const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

function sortNodes(nodes: TreeNode[]) {
  const rank = (n: TreeNode) => (n.kind === "file" ? 1 : 0);
  nodes.sort((a, b) => rank(a) - rank(b) || (a.kind === "group" ? 0 : cmp(a.name, b.name)));
  for (const n of nodes) if (n.children.length) sortNodes(n.children);
}

function count(n: TreeNode): number {
  n.fileCount = n.kind === "file" ? 1 : n.children.reduce((s, c) => s + count(c), 0);
  return n.fileCount;
}

/** IntelliJ "compact middle packages": a folder whose only child is a folder merges with it. */
function compact(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind === "folder") {
      while (n.children.length === 1 && n.children[0].kind === "folder") {
        const c = n.children[0];
        n = { ...n, id: c.id, name: `${n.name}/${c.name}`, children: c.children };
      }
    }
    n.children = compact(n.children);
    return n;
  });
}

/** Build the tree (folders nested, compacted, counted) or flat list under the items' groups. */
export function buildChangesTree(items: ChangeItem[], mode: ChangesMode = "tree"): TreeNode[] {
  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();
  const child = (parent: TreeNode[], id: string, make: () => TreeNode) => {
    let n = index.get(id);
    if (!n) {
      n = make();
      index.set(id, n);
      parent.push(n);
    }
    return n;
  };
  for (const item of items) {
    let level = roots;
    let prefix = "";
    for (const g of item.groups ?? []) {
      prefix += `g:${g.id}/`;
      level = child(level, prefix, () => ({ id: prefix, kind: "group", name: g.label, group: g, children: [], fileCount: 0 })).children;
    }
    const parts = item.change.path.split("/");
    const file = parts.pop()!;
    if (mode === "tree") {
      let dir = "";
      for (const p of parts) {
        dir += p + "/";
        const id = `${prefix}d:${dir}`;
        level = child(level, id, () => ({ id, kind: "folder", name: p, children: [], fileCount: 0 })).children;
      }
    }
    level.push({ id: `${prefix}f:${item.key}`, kind: "file", name: file, dir: mode === "flat" && parts.length ? parts.join("/") : undefined, item, children: [], fileCount: 1 });
  }
  const out = mode === "tree" ? compact(roots) : roots;
  sortNodes(out);
  out.forEach(count);
  return out;
}

/** Visible rows: children of collapsed nodes are skipped. */
export function flattenTree(roots: TreeNode[], collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (nodes: TreeNode[], depth: number, parent: TreeNode | null) => {
    for (const node of nodes) {
      rows.push({ node, depth, parent });
      if (node.children.length && !collapsed.has(node.id)) walk(node.children, depth + 1, node);
    }
  };
  walk(roots, 0, null);
  return rows;
}

/** All files below nodes, in tree order. */
export function filesOf(nodes: TreeNode[]): ChangeItem[] {
  const out: ChangeItem[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.item) out.push(n.item);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Ids of every node with children (collapse all). */
export function containerIds(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.children.length) {
        out.push(n.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}
