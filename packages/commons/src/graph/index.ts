// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/
// {PermanentGraphImpl.kt,VisibleGraphImpl.kt,BaseController.java,SortedBaseController.java,FilteredController.kt},
// platform/vcs-log/impl/src/com/intellij/vcs/log/ui/table/{GraphTableModel.kt,HeadPrintElements.kt} (HEAD node), Apache-2.0.

export * from "./types";
export { sortHeadsForLayout, branchCommits, bestRefPerCommit, compareRefsForLayout, naturalCompare } from "./refs";
export { graphColor, graphColorRgb, javaStringHashCode, GRAPH_COLORS_DARK, GRAPH_COLORS_LIGHT, GRAPH_COLORS_CLASSIC, DEFAULT_COLOR } from "./colors";
export type { GraphColorScheme } from "./colors";
export * from "./paint";

import type { EdgeElement, GraphInput, GraphOptions, LaidOutGraph, PrintElement } from "./types";
import { getDownNodes, getUpNodes, isNormalEdge, type GraphEdge, type LinearGraph } from "./linearGraph";
import { PermanentLinearGraphBuilder } from "./permanentLinearGraph";
import { buildGraphLayout } from "./graphLayout";
import { createBekMap, createTopologicalMap, SortedLinearGraph } from "./sort";
import { createFilteredGraph } from "./filter";
import { graphElementComparatorByLayoutIndex, isDashed, presentationColorId, PrintElementGeneratorImpl, SLRUMap } from "./printElements";
import { graphColorGetterByHead } from "./colors";
import { bestRefPerCommit, branchCommits, sortHeadsForLayout } from "./refs";

/**
 * Builds the permanent graph (PermanentGraphImpl.newInstance) and one visible graph over it
 * (createVisibleGraph: sort controller, optional filter, print element generator).
 */
export function buildGraph(input: GraphInput, options: GraphOptions = {}): LaidOutGraph {
  const n = input.parents.length;

  // PermanentGraphImpl.NotLoadedCommitsIdsGenerator: parents missing from the snapshot get ids -2, -3, ...
  let notLoaded = 0;
  const permanent = PermanentLinearGraphBuilder.newInstance(input.parents).build(() => -(notLoaded++ + 2));
  const timestamp = (node: number) => input.times[node] * 1000;

  const best = input.refs ? bestRefPerCommit(input.refs) : null;
  const heads = input.heads ?? (input.refs ? sortHeadsForLayout(input.refs) : []);
  const branches = input.branches ?? (input.refs ? branchCommits(input.refs) : heads);

  // HeadCommitsComparator: heads with refs by priority, then the others by index
  const rank = new Map<number, number>();
  heads.forEach((c, i) => rank.has(c) || rank.set(c, i));
  const headsComparator = (h1: number, h2: number) => {
    const r1 = rank.get(h1);
    const r2 = rank.get(h2);
    if (r1 === undefined) return r2 === undefined ? h1 - h2 : 1;
    if (r2 === undefined) return -1;
    return r1 - r2;
  };
  const layout = buildGraphLayout(permanent, headsComparator, branches.filter((c) => c >= 0 && c < n));

  // BaseController / SortedBaseController
  let base: LinearGraph = permanent;
  const sort = options.sort ?? "intellij";
  if (sort === "intellij") base = new SortedLinearGraph(createBekMap(permanent, layout, timestamp), permanent);
  else if (sort === "topological") base = new SortedLinearGraph(createTopologicalMap(permanent), permanent);

  // FilteredController (filter) or CollapsedController with the branch filter; without both the compiled graph is the base
  const graph =
    input.visible || input.visibleHeads
      ? createFilteredGraph(base, permanent, input.visible ?? null, input.visibleHeads ?? null)
      : base;

  // Colours: by best ref name for head fragments (GraphColorManagerImpl). Without refs, head fragments use their layout index.
  const nodeColor = best
    ? graphColorGetterByHead(layout, (head) => best.get(head)?.name ?? null)
    : (_nodeId: number, layoutIndex: number) => layoutIndex;
  const layoutIndexOfId = (nodeId: number) => (nodeId < 0 ? nodeId : layout.getLayoutIndex(nodeId));
  const generator = PrintElementGeneratorImpl.create(
    graph,
    { getColorId: (e) => presentationColorId(graph, layoutIndexOfId, nodeColor, e) },
    options.showLongEdges ?? false,
    graphElementComparatorByLayoutIndex((nodeIndex) => layoutIndexOfId(graph.getNodeId(nodeIndex))),
  );
  const headCommits = new Set(input.refs?.filter((r) => r.kind === "head" || r.name === "HEAD").map((r) => r.commit));

  const cache = new SLRUMap<number, PrintElement[]>(100, 200);
  const printElements = (row: number): PrintElement[] => {
    if (!(row >= 0 && row < graph.nodesCount())) return [];
    let out = cache.get(row);
    if (out) return out;
    out = generator.getPrintElements(row).map((pe): PrintElement => {
      if (pe.kind === "node") {
        const head = headCommits.has(graph.getNodeId(row));
        return { type: "node", position: pe.position, colorId: pe.colorId, ...(head && { nodeType: "outlineAndFill" as const }) };
      }
      const edge = pe.graphElement as GraphEdge;
      const el: EdgeElement = {
        type: "edge",
        position: pe.position,
        otherPosition: pe.otherPosition,
        direction: pe.direction,
        style: isDashed(edge.type) ? "dashed" : "solid",
        colorId: pe.colorId,
        arrow: pe.arrow,
      };
      if (pe.terminal) el.terminal = true;
      // VisibleGraphImpl.performArrowAction: the target of a normal edge with an arrow
      if (pe.arrow && isNormalEdge(edge)) el.jumpTo = graph.getNodeId(pe.direction === "down" ? edge.down : edge.up);
      return el;
    });
    cache.put(row, out);
    return out;
  };

  return {
    rowCount: graph.nodesCount(),
    commitAt: (row) => graph.getNodeId(row),
    rowOf: (commit) => graph.getNodeIndex(commit) ?? -1,
    printElements,
    maxPosition: (row) => {
      let max = 0;
      for (const e of printElements(row)) max = Math.max(max, e.position, e.type === "edge" ? e.otherPosition : 0);
      return max;
    },
    get recommendedWidth() {
      return generator.recommendedWidth;
    },
    adjacentRows: (row, parents) => (parents ? getDownNodes(graph, row) : getUpNodes(graph, row)),
  };
}

