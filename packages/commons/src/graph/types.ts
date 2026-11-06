// Public API of the commit graph module (port of IntelliJ vcs-log graph).
// Clients feed a GraphSnapshot in and get rows with print elements out.

import type { RefInfo } from "../protocol";

/**
 * "intellij": IntelliSort ("Standard" in IntelliJ, BekSorter), merged-in commits right below their merge.
 * "date": IntelliJ "Off", the `git log --date-order` input order.
 * "topological": `git log --topo-order` (not an IntelliJ option).
 */
export type SortType = "intellij" | "topological" | "date";

export interface GraphInput {
  /** parents[i] = parent commit indices of commit i (snapshot order, children first). */
  parents: number[][];
  /** Committer times, unix seconds, same indices. */
  times: number[];
  /**
   * Refs of the snapshot (recommended). Gives the IntelliJ head order (when `heads` is missing), colours by ref name,
   * the HEAD node style, and the branch heads (tags do not start layout columns).
   */
  refs?: RefInfo[];
  /** Commit indices of refs, in layout priority order (see sortHeadsForLayout). Default: from `refs`. */
  heads?: number[];
  /** Commits of branch refs (start layout DFS). Default: branch refs of `refs`, else `heads`. */
  branches?: number[];
  /**
   * Optional filter: only these commits are shown. Hidden commits are skipped and
   * visible commits stay connected (IntelliJ draws such edges dashed).
   */
  visible?: ReadonlySet<number>;
  /** Optional branch filter: only commits reachable from these commits are shown (combines with `visible`). */
  visibleHeads?: number[];
}

export interface GraphOptions {
  sort?: SortType;
  /** IntelliJ "Show long edges". Default false: long edges are cut into arrow stubs. */
  showLongEdges?: boolean;
}

export type LineStyle = "solid" | "dashed";

/** A commit dot. */
export interface NodeElement {
  type: "node";
  /** Lane (column) in this row, 0-based. */
  position: number;
  colorId: number;
  /** NodePrintElement.Type. "outlineAndFill" marks the HEAD commit. Default "fill". */
  nodeType?: "fill" | "outline" | "outlineAndFill";
}

/**
 * Half of an edge, drawn inside one row: from the middle of this row at `position`
 * to the row border (up or down) towards `otherPosition` in the neighbour row.
 */
export interface EdgeElement {
  type: "edge";
  position: number;
  otherPosition: number;
  direction: "up" | "down";
  style: LineStyle;
  colorId: number;
  /** True when the edge is cut here (long edge): draw an arrow tip instead of continuing. */
  arrow: boolean;
  /** TerminalEdgePrintElement: arrow stub that ends inside this row (position === otherPosition). */
  terminal?: boolean;
  /** For arrows: commit index at the other end of the edge (IntelliJ jumps there on click). */
  jumpTo?: number;
}

export type PrintElement = NodeElement | EdgeElement;

export interface LaidOutGraph {
  readonly rowCount: number;
  /** Commit index shown in a row. */
  commitAt(row: number): number;
  /** Row of a commit, -1 when hidden. */
  rowOf(commit: number): number;
  /** Elements to paint in a row. Cached; cheap to call for visible rows only. */
  printElements(row: number): PrintElement[];
  /** Largest lane index used in a row (for column width). */
  maxPosition(row: number): number;
  /** IntelliJ VisibleGraph.recommendedWidth: lanes for the graph column (weighted over the first 20 000 rows). */
  readonly recommendedWidth: number;
  /** RowInfo.getAdjacentRows: rows of the parents (true) or children (false) of a row's commit. */
  adjacentRows(row: number, parents: boolean): number[];
}
