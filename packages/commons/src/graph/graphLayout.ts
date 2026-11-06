// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/permanent/
// {GraphLayoutBuilder.kt,GraphLayoutImpl.kt}, Apache-2.0.

import { collectDownNodes, getUpNodes, walk, NODE_NOT_FOUND, type GraphLayout, type LinearGraph } from "./linearGraph";

export class GraphLayoutImpl implements GraphLayout {
  private readonly layoutIndexForHeadNodes: Int32Array;

  constructor(
    private readonly layoutIndex: Int32Array,
    private readonly headNodes: Int32Array,
  ) {
    this.layoutIndexForHeadNodes = headNodes.map((h) => layoutIndex[h]);
  }

  getLayoutIndex(nodeIndex: number): number {
    return this.layoutIndex[nodeIndex];
  }

  getOneOfHeadNodeIndex(nodeIndex: number): number {
    return this.headNodes[this.getHeadOrder(this.getLayoutIndex(nodeIndex))];
  }

  getHeadNodeIndex(): Int32Array {
    return this.headNodes;
  }

  /** Arrays.binarySearch semantics: index of the last head with layout index <= the given one. */
  private getHeadOrder(layoutIndex: number): number {
    const a = this.layoutIndexForHeadNodes;
    let lo = 0;
    let hi = a.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (a[mid] < layoutIndex) lo = mid + 1;
      else if (a[mid] > layoutIndex) hi = mid - 1;
      else return mid;
    }
    return Math.max(0, lo - 1);
  }
}

export function getHeads(graph: LinearGraph): number[] {
  const heads: number[] = [];
  for (let i = 0; i < graph.nodesCount(); i++) if (getUpNodes(graph, i).length === 0) heads.push(i);
  return heads;
}

/**
 * Layout index = number of the DFS "column" a node is placed in: DFS from the heads in priority order,
 * following the first child (parent commit) without a layout index; each finished leg gets the next index.
 */
export function buildGraphLayout(
  graph: LinearGraph,
  comparator: (nodeIndex1: number, nodeIndex2: number) => number,
  branches: Iterable<number> = [],
): GraphLayoutImpl {
  // Kotlin `branches + graph.getHeads()` keeps the branch order first, then adds new heads
  const allHeads = [...new Set([...branches, ...getHeads(graph)])];
  try {
    allHeads.sort(comparator); // stable, like IntArrayList.sort
  } catch (e) {
    console.error(e);
  }
  return buildFromSortedHeads(graph, allHeads);
}

function buildFromSortedHeads(graph: LinearGraph, sortedHeads: number[]): GraphLayoutImpl {
  const layoutIndex = new Int32Array(graph.nodesCount());
  const importantHeads: number[] = [];
  const stack: number[] = [];
  const buf: number[] = [];
  let currentLayoutIndex = 1;
  for (const head of sortedHeads) {
    if (layoutIndex[head] !== 0) continue;
    importantHeads.push(head);
    walk(
      head,
      (current) => {
        const firstVisit = layoutIndex[current] === 0;
        if (firstVisit) layoutIndex[current] = currentLayoutIndex;
        collectDownNodes(graph, current, buf);
        for (const down of buf) if (layoutIndex[down] === 0) return down;
        if (firstVisit) currentLayoutIndex++;
        return NODE_NOT_FOUND;
      },
      stack,
    );
  }
  return new GraphLayoutImpl(layoutIndex, Int32Array.from(importantHeads));
}
