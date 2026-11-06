// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/sort/
// {SortIndexMap.java,SortedBaseController.java,SortChecker.java,bek/BekSorter.java,bek/BekBranch.java,bek/BekBranchCreator.java,
// bek/BekBranchMerger.java,bek/BekEdgeRestrictions.java}, utils/IntIntMultiMap.java, Apache-2.0.
// `topologicalOrder` is not IntelliJ code: it reproduces `git log --topo-order` (IntelliJ only offers "Off" and IntelliSort).

import {
  collectDownNodes,
  collectUpNodes,
  getDownNodes,
  getUpNodes,
  GraphEdge,
  GraphNode,
  NODE_NOT_FOUND,
  walk,
  type EdgeFilter,
  type GraphLayout,
  type LinearGraph,
} from "./linearGraph";

export class SortIndexMap {
  private readonly reverseMap: Int32Array;
  /** @param sortedToUsual the usual index of each sorted index */
  constructor(private readonly map: Int32Array) {
    this.reverseMap = new Int32Array(map.length);
    for (let i = 0; i < map.length; i++) this.reverseMap[map[i]] = i;
  }
  size(): number {
    return this.map.length;
  }
  getSortedIndex(usualIndex: number): number {
    return this.reverseMap[usualIndex];
  }
  getUsualIndex(sortedIndex: number): number {
    return this.map[sortedIndex];
  }
}

/** SortedBaseController.SortedLinearGraph */
export class SortedLinearGraph implements LinearGraph {
  constructor(
    readonly sortIndexMap: SortIndexMap,
    private readonly linearGraph: LinearGraph,
  ) {}
  nodesCount(): number {
    return this.linearGraph.nodesCount();
  }
  private idx(nodeId: number | null): number | null {
    return nodeId == null ? null : this.sortIndexMap.getSortedIndex(nodeId);
  }
  getAdjacentEdges(nodeIndex: number, filter: EdgeFilter): GraphEdge[] {
    return this.linearGraph
      .getAdjacentEdges(this.sortIndexMap.getUsualIndex(nodeIndex), filter)
      .map((e) => new GraphEdge(this.idx(e.up), this.idx(e.down), e.targetId, e.type));
  }
  getGraphNode(nodeIndex: number): GraphNode {
    return new GraphNode(nodeIndex);
  }
  getNodeId(nodeIndex: number): number {
    return this.sortIndexMap.getUsualIndex(nodeIndex);
  }
  getNodeIndex(nodeId: number): number | null {
    if (nodeId < 0 || nodeId >= this.nodesCount()) return null;
    return this.sortIndexMap.getSortedIndex(nodeId);
  }
}

/** SortChecker.findReversedEdge(LinearGraph) */
export function findReversedEdge(graph: LinearGraph): [number, number] | null {
  for (let i = 0; i < graph.nodesCount(); i++) {
    for (const down of getDownNodes(graph, i)) if (down <= i) return [i, down];
    for (const up of getUpNodes(graph, i)) if (up >= i) return [up, i];
  }
  return null;
}

export class IntIntMultiMap {
  private readonly m = new Map<number, number[]>();
  putValue(key: number, value: number) {
    const values = this.m.get(key);
    if (!values) this.m.set(key, [value]);
    else if (!values.includes(value)) values.push(value);
  }
  remove(key: number, value: number) {
    const values = this.m.get(key);
    if (!values) return;
    const i = values.indexOf(value);
    if (i === -1) return;
    if (values.length === 1) this.m.delete(key);
    else values.splice(i, 1);
  }
  get(key: number): readonly number[] {
    return this.m.get(key) ?? [];
  }
  containsKey(key: number): boolean {
    return this.m.has(key);
  }
  keys(): number[] {
    return [...this.m.keys()];
  }
  clear() {
    this.m.clear();
  }
}

class BekEdgeRestrictions {
  private readonly upToEdge = new IntIntMultiMap();
  private readonly downToEdge = new IntIntMultiMap();
  addRestriction(upNode: number, downNode: number) {
    this.upToEdge.putValue(upNode, downNode);
    this.downToEdge.putValue(downNode, upNode);
  }
  /** Removes the restrictions that point to downNode; reports each up node that has no restriction left. */
  removeRestriction(downNode: number, released: (upNode: number) => void) {
    for (const upNode of [...this.downToEdge.get(downNode)]) {
      const had = this.upToEdge.containsKey(upNode);
      this.upToEdge.remove(upNode, downNode);
      if (had && !this.upToEdge.containsKey(upNode)) released(upNode);
    }
  }
  hasRestriction(upNode: number): boolean {
    return this.upToEdge.containsKey(upNode);
  }
}

// timestamps are in milliseconds, as in IntelliJ
const MAX_BLOCK_SIZE = 20;
const MAX_DELTA_TIME = 60 * 60 * 24 * 3 * 1000;
const SMALL_DELTA_TIME = 60 * 60 * 4 * 1000;

class BekBranch {
  private noInsertSize: number;
  private prepared: number[] | null = null;
  private readonly downBuf: number[] = [];

  constructor(
    private readonly graph: LinearGraph,
    readonly nodeIndexes: number[],
  ) {
    this.noInsertSize = nodeIndexes.length;
  }

  /** The lowest node of the branch that is not placed yet. */
  getCurrentNode(): number {
    return this.nodeIndexes[this.noInsertSize - 1];
  }

  updatePrepareForInsertPart(timestamp: (node: number) => number, restrictions: BekEdgeRestrictions) {
    const currentNode = this.nodeIndexes[this.noInsertSize - 1];
    if (restrictions.hasRestriction(currentNode)) return;
    let prevIndex: number;
    for (prevIndex = this.noInsertSize - 1; prevIndex > 0; prevIndex--) {
      const upNode = this.nodeIndexes[prevIndex - 1];
      const downNode = this.nodeIndexes[prevIndex];
      // for correct topological order
      if (restrictions.hasRestriction(upNode)) break;
      collectDownNodes(this.graph, upNode, this.downBuf);
      const containsDownNode = this.downBuf.includes(downNode);
      // upNode is a merge commit
      if (this.downBuf.length > 1 && containsDownNode) continue;
      // division
      if (!containsDownNode) break;
      const delta = Math.abs(timestamp(upNode) - timestamp(downNode));
      // long time between commits
      if (delta > MAX_DELTA_TIME) break;
      // block is too long
      if (prevIndex < this.noInsertSize - MAX_BLOCK_SIZE && delta > SMALL_DELTA_TIME) break;
    }
    this.prepared = this.nodeIndexes.slice(prevIndex, this.noInsertSize);
  }

  getPrepareForInsertPart(): number[] | null {
    return this.prepared;
  }

  doneInsertPreparedPart() {
    this.noInsertSize -= this.prepared!.length;
    this.prepared = null;
  }

  isDone(): boolean {
    return this.noInsertSize === 0;
  }
}

function createBekBranches(graph: LinearGraph, layout: GraphLayout): { branches: BekBranch[]; restrictions: BekEdgeRestrictions } {
  const done = new Uint8Array(graph.nodesCount());
  const restrictions = new BekEdgeRestrictions();
  const downBuf: number[] = [];
  const upBuf: number[] = [];
  const stack: number[] = [];
  const branches: BekBranch[] = [];

  const createNextBranch = (headNode: number): number[] => {
    done[headNode] = 1;
    const nodeIndexes = [headNode];
    const startLayout = layout.getLayoutIndex(headNode);
    walk(
      headNode,
      (currentNode) => {
        const currentLayout = layout.getLayoutIndex(currentNode);
        collectDownNodes(graph, currentNode, downBuf);
        for (let i = downBuf.length - 1; i >= 0; i--) {
          const downNode = downBuf[i];
          if (done[downNode]) {
            if (layout.getLayoutIndex(downNode) < startLayout) restrictions.addRestriction(currentNode, downNode);
          } else if (currentLayout <= layout.getLayoutIndex(downNode)) {
            // almost ok node, except (may be) up nodes
            let hasUndoneUpNodes = false;
            collectUpNodes(graph, downNode, upBuf);
            for (const upNode of upBuf) {
              if (!done[upNode] && layout.getLayoutIndex(upNode) <= layout.getLayoutIndex(downNode)) {
                hasUndoneUpNodes = true;
                break;
              }
            }
            if (!hasUndoneUpNodes) {
              done[downNode] = 1;
              nodeIndexes.push(downNode);
              return downNode;
            }
          }
        }
        return NODE_NOT_FOUND;
      },
      stack,
    );
    return nodeIndexes;
  };

  for (const headNode of layout.getHeadNodeIndex()) {
    if (done[headNode]) continue;
    branches.push(new BekBranch(graph, createNextBranch(headNode)));
  }
  return { branches, restrictions };
}

/** Binary heap of branch indexes ordered by (timestamp of the prepared part, branch index). */
class BranchQueue {
  private readonly heap: number[] = [];
  constructor(private readonly ts: Float64Array) {}
  private less(a: number, b: number) {
    return this.ts[a] < this.ts[b] || (this.ts[a] === this.ts[b] && a < b);
  }
  get size() {
    return this.heap.length;
  }
  add(x: number) {
    const h = this.heap;
    let i = h.push(x) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  remove(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * BekBranchMerger: works from the bottom of the graph to the top; each step takes the branch whose prepared part has
 * the smallest timestamp of its top node and places the part below the nodes placed so far.
 */
function mergeBekBranches(
  branches: BekBranch[],
  restrictions: BekEdgeRestrictions,
  timestamp: (node: number) => number,
  nodesCount: number,
): Int32Array {
  const nodeToBranch = new Int32Array(nodesCount);
  branches.forEach((b, bi) => b.nodeIndexes.forEach((n) => (nodeToBranch[n] = bi)));
  const queuedTimestamps = new Float64Array(branches.length);
  const queue = new BranchQueue(queuedTimestamps);
  const result = new Int32Array(nodesCount);
  let resultStart = nodesCount;
  const released: number[] = [];

  const prepareAndEnqueue = (bi: number) => {
    const b = branches[bi];
    if (b.isDone() || b.getPrepareForInsertPart() != null) return;
    b.updatePrepareForInsertPart(timestamp, restrictions);
    const part = b.getPrepareForInsertPart();
    if (part == null) return;
    queuedTimestamps[bi] = timestamp(part[0]);
    queue.add(bi);
  };

  for (let bi = 0; bi < branches.length; bi++) prepareAndEnqueue(bi);
  while (queue.size > 0) {
    const bi = queue.remove();
    const b = branches[bi];
    const part = b.getPrepareForInsertPart()!;
    released.length = 0;
    resultStart -= part.length;
    for (let i = 0; i < part.length; i++) {
      result[resultStart + i] = part[i];
      restrictions.removeRestriction(part[i], (n) => released.push(n));
    }
    b.doneInsertPreparedPart();
    for (const node of released) {
      const rbi = nodeToBranch[node];
      const rb = branches[rbi];
      if (!rb.isDone() && rb.getCurrentNode() === node) prepareAndEnqueue(rbi);
    }
    prepareAndEnqueue(bi);
  }
  if (resultStart !== 0) {
    // IntelliJ only logs this; a partial order would duplicate rows, so keep the usual order instead
    console.error(`Bek sort: unplaced nodes: ${resultStart}`);
    return Int32Array.from({ length: nodesCount }, (_, i) => i);
  }
  return result;
}

/** BekSorter.createBekMap: IntelliSort ("Standard" sort in IntelliJ). */
export function createBekMap(graph: LinearGraph, layout: GraphLayout, timestamp: (node: number) => number): SortIndexMap {
  const { branches, restrictions } = createBekBranches(graph, layout);
  return new SortIndexMap(mergeBekBranches(branches, restrictions, timestamp, graph.nodesCount()));
}

/**
 * `git log --topo-order` (commit.c sort_in_topological_order, REV_SORT_IN_GRAPH_ORDER): a LIFO walk that emits a commit
 * when all its children are emitted, so a merged-in branch is shown in one block below its merge commit.
 */
export function createTopologicalMap(graph: LinearGraph): SortIndexMap {
  const n = graph.nodesCount();
  const indegree = new Int32Array(n);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    collectDownNodes(graph, i, buf);
    for (const p of buf) indegree[p]++;
  }
  // tips in input (date) order; the stack pops the first tip first
  const stack: number[] = [];
  for (let i = n - 1; i >= 0; i--) if (indegree[i] === 0) stack.push(i);
  const result = new Int32Array(n);
  let k = 0;
  while (stack.length > 0) {
    const c = stack.pop()!;
    result[k++] = c;
    collectDownNodes(graph, c, buf);
    for (const p of buf) if (--indegree[p] === 0) stack.push(p);
  }
  return new SortIndexMap(result);
}
