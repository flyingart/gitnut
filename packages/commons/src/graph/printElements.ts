// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/
// {PrintElementGeneratorImpl.kt,EdgesInRowGenerator.java,GraphElementComparatorByLayoutIndex.java,elements/*},
// impl/facade/PrintElementPresentationManagerImpl.kt (getColorId), com.intellij.util.containers.SLRUMap, Apache-2.0.

import {
  EdgeFilter,
  EdgeType,
  getNotNullNodeIndex,
  GraphEdge,
  GraphNode,
  isEdgeDown,
  isEdgeUp,
  isNormalEdge,
  type GraphElement,
  type LinearGraph,
} from "./linearGraph";

/** SLRUMap: entries hit twice move from the probational to the protected segment. */
export class SLRUMap<K, V> {
  private readonly protectedMap = new Map<K, V>();
  private readonly probational = new Map<K, V>();
  constructor(
    private readonly protectedSize: number,
    private readonly probationalSize: number,
  ) {}
  get(key: K): V | undefined {
    let v = this.protectedMap.get(key);
    if (v !== undefined) {
      this.protectedMap.delete(key);
      this.protectedMap.set(key, v);
      return v;
    }
    v = this.probational.get(key);
    if (v === undefined) return undefined;
    this.probational.delete(key);
    this.protectedMap.set(key, v);
    if (this.protectedMap.size > this.protectedSize) {
      const [k, old] = this.protectedMap.entries().next().value!;
      this.protectedMap.delete(k);
      this.putProbational(k, old);
    }
    return v;
  }
  put(key: K, value: V) {
    this.protectedMap.delete(key);
    this.probational.delete(key);
    this.putProbational(key, value);
  }
  private putProbational(key: K, value: V) {
    this.probational.set(key, value);
    if (this.probational.size > this.probationalSize) this.probational.delete(this.probational.keys().next().value!);
  }
  clear() {
    this.protectedMap.clear();
    this.probational.clear();
  }
}

// EdgesInRowGenerator

const CACHE_SIZE = 10;
const BLOCK_SIZE = 40;

interface GraphEdges {
  edges: Map<string, GraphEdge>;
  row: number;
}

/** Edges passing through a row (not touching its node), computed by walking from cached block borders. */
export class EdgesInRowGenerator {
  private readonly cacheNU = new SLRUMap<number, GraphEdges>(CACHE_SIZE, CACHE_SIZE * 2);
  private readonly cacheND = new SLRUMap<number, GraphEdges>(CACHE_SIZE, CACHE_SIZE * 2);

  constructor(
    private readonly graph: LinearGraph,
    private readonly walkSize = 1000,
  ) {}

  getEdgesInRow(rowIndex: number): GraphEdge[] {
    let u = this.getNeighborU(rowIndex);
    while (u.row < rowIndex) u = this.oneDownStep(u);
    let d = this.getNeighborD(rowIndex);
    while (d.row > rowIndex) d = this.oneUpStep(d);
    for (const [k, e] of d.edges) u.edges.set(k, e);
    return [...u.edges.values()];
  }

  private static copy(g: GraphEdges): GraphEdges {
    return { edges: new Map(g.edges), row: g.row };
  }

  private static upNeighborIndex(rowIndex: number) {
    return Math.floor(rowIndex / BLOCK_SIZE) * BLOCK_SIZE;
  }

  private getNeighborU(rowIndex: number): GraphEdges {
    const up = EdgesInRowGenerator.upNeighborIndex(rowIndex);
    let g = this.cacheNU.get(up);
    if (!g) {
      g = this.getUCorrectEdges(up);
      this.cacheNU.put(up, g);
    }
    return EdgesInRowGenerator.copy(g);
  }

  private getNeighborD(rowIndex: number): GraphEdges {
    const down = EdgesInRowGenerator.upNeighborIndex(rowIndex) + BLOCK_SIZE;
    if (down >= this.graph.nodesCount()) return { edges: new Map(), row: this.graph.nodesCount() - 1 };
    let g = this.cacheND.get(down);
    if (!g) {
      g = this.getDCorrectEdges(down);
      this.cacheND.put(down, g);
    }
    return EdgesInRowGenerator.copy(g);
  }

  private getUCorrectEdges(rowIndex: number): GraphEdges {
    const start = Math.max(rowIndex - this.walkSize, 0);
    let g: GraphEdges = { edges: new Map(), row: start };
    for (let i = start; i < rowIndex; i++) g = this.oneDownStep(g);
    return g;
  }

  private getDCorrectEdges(rowIndex: number): GraphEdges {
    const end = Math.min(rowIndex + this.walkSize, this.graph.nodesCount() - 1);
    let g: GraphEdges = { edges: new Map(), row: end };
    for (let i = end; i > rowIndex; i--) g = this.oneUpStep(g);
    return g;
  }

  private oneDownStep(g: GraphEdges): GraphEdges {
    for (const e of this.graph.getAdjacentEdges(g.row, EdgeFilter.NORMAL_DOWN)) g.edges.set(e.key, e);
    for (const e of this.graph.getAdjacentEdges(g.row + 1, EdgeFilter.NORMAL_UP)) g.edges.delete(e.key);
    return { edges: g.edges, row: g.row + 1 };
  }

  private oneUpStep(g: GraphEdges): GraphEdges {
    for (const e of this.graph.getAdjacentEdges(g.row, EdgeFilter.NORMAL_UP)) g.edges.set(e.key, e);
    for (const e of this.graph.getAdjacentEdges(g.row - 1, EdgeFilter.NORMAL_DOWN)) g.edges.delete(e.key);
    return { edges: g.edges, row: g.row - 1 };
  }
}

// GraphElementComparatorByLayoutIndex

export function graphElementComparatorByLayoutIndex(layoutIndex: (nodeIndex: number) => number) {
  const compare2 = (edge: GraphEdge, node: GraphNode): number => {
    if (!isNormalEdge(edge)) return layoutIndex(getNotNullNodeIndex(edge)) - layoutIndex(node.nodeIndex);
    const maxLI = Math.max(layoutIndex(edge.up), layoutIndex(edge.down));
    const nodeLI = layoutIndex(node.nodeIndex);
    if (maxLI !== nodeLI) return maxLI - nodeLI;
    return edge.up - node.nodeIndex;
  };
  return (o1: GraphElement, o2: GraphElement): number => {
    if (o1 instanceof GraphEdge && o2 instanceof GraphEdge) {
      if (!isNormalEdge(o1)) return -compare2(o2, new GraphNode(getNotNullNodeIndex(o1)));
      if (!isNormalEdge(o2)) return compare2(o1, new GraphNode(getNotNullNodeIndex(o2)));
      if (o1.up === o2.up) {
        if (o1.down < o2.down) return -compare2(o2, new GraphNode(o1.down));
        return compare2(o1, new GraphNode(o2.down));
      }
      if (o1.up < o2.up) return compare2(o1, new GraphNode(o2.up));
      return -compare2(o2, new GraphNode(o1.up));
    }
    if (o1 instanceof GraphEdge) return compare2(o1, o2 as GraphNode);
    if (o2 instanceof GraphEdge) return -compare2(o2, o1);
    return 0; // both nodes: cannot happen
  };
}

// Print elements

export interface PrintElementPresentationManager {
  getColorId(element: GraphElement): number;
  isSelected?(element: GraphPrintElement): boolean;
}

export type EdgeDirection = "up" | "down";

export interface GraphPrintElement {
  readonly kind: "node" | "edge";
  readonly row: number;
  readonly position: number;
  readonly graphElement: GraphElement;
  readonly colorId: number;
  // edges only
  readonly otherPosition: number;
  readonly direction: EdgeDirection;
  readonly arrow: boolean;
  /** TerminalEdgePrintElement: a cut edge drawn as an arrow inside its row. */
  readonly terminal: boolean;
}

/** EdgePrintElementImpl.convertToLineStyle */
export const isDashed = (t: EdgeType) => t === EdgeType.DOTTED || t === EdgeType.DOTTED_ARROW_UP || t === EdgeType.DOTTED_ARROW_DOWN;

const VERY_LONG_EDGE_SIZE = 1000;
export const LONG_EDGE_SIZE = 30;
const VERY_LONG_EDGE_PART_SIZE = 250;
const LONG_EDGE_PART_SIZE = 1;
const ROWS_CACHE_SIZE = 100;
const SAMPLE_SIZE = 20000;
const K = 0.1;

type Elem = GraphElement;

export class PrintElementGeneratorImpl {
  private readonly cache = new SLRUMap<number, Elem[]>(ROWS_CACHE_SIZE, ROWS_CACHE_SIZE * 2);
  private readonly edgesInRow: EdgesInRowGenerator;
  private width?: number;

  constructor(
    private readonly graph: LinearGraph,
    private readonly presentation: PrintElementPresentationManager,
    private readonly comparator: (a: Elem, b: Elem) => number,
    private readonly longEdgeSize: number,
    private readonly visiblePartSize: number,
    private readonly edgeWithArrowSize: number,
  ) {
    this.edgesInRow = new EdgesInRowGenerator(graph);
  }

  static create(
    graph: LinearGraph,
    presentation: PrintElementPresentationManager,
    showLongEdges: boolean,
    comparator: (a: Elem, b: Elem) => number,
  ) {
    return new PrintElementGeneratorImpl(
      graph,
      presentation,
      comparator,
      showLongEdges ? VERY_LONG_EDGE_SIZE : LONG_EDGE_SIZE,
      showLongEdges ? VERY_LONG_EDGE_PART_SIZE : LONG_EDGE_PART_SIZE,
      showLongEdges ? LONG_EDGE_SIZE : Number.MAX_SAFE_INTEGER,
    );
  }

  get recommendedWidth(): number {
    return (this.width ??= this.calculateRecommendedWidth());
  }

  private calculateRecommendedWidth(): number {
    const nodesCount = this.graph.nodesCount();
    if (nodesCount === 0) return 0;
    if (nodesCount === 1) return 1;
    const n = Math.min(SAMPLE_SIZE, nodesCount);
    let sum = 0;
    let sumSquares = 0;
    let edgesCount = 0;
    const current = new Map<string, { up: number; down: number }>();
    for (let i = 0; i < n; i++) {
      let upArrows = 0;
      let downArrows = 0;
      for (const e of this.graph.getAdjacentEdges(i, EdgeFilter.ALL)) {
        if (isNormalEdge(e)) {
          const k = `${e.up},${e.down}`;
          if (isEdgeUp(e, i)) current.delete(k);
          else current.set(k, { up: e.up, down: e.down });
        } else if (e.type === EdgeType.DOTTED_ARROW_UP) upArrows++;
        else downArrows++;
      }
      let newEdgesCount = 0;
      for (const e of current.values()) {
        if (this.isNormalEdgeVisibleInRow(e, i)) newEdgesCount++;
        else {
          const arrow = this.getNormalArrowType(e, i);
          if (arrow === "down") downArrows++;
          else if (arrow === "up") upArrows++;
        }
      }
      const width = Math.max(edgesCount + upArrows, newEdgesCount + downArrows);
      const weight = (2 / (n * (K + 1))) * (1 + ((K - 1) * i) / (n - 1));
      sum += width * weight;
      sumSquares += width * width * weight;
      edgesCount = newEdgesCount;
    }
    const average = sum;
    const deviation = Math.sqrt(sumSquares - average * average);
    return Math.round(average + deviation);
  }

  getPrintElements(rowIndex: number): GraphPrintElement[] {
    const result: GraphPrintElement[] = [];
    const nodes: GraphPrintElement[] = []; // nodes at the end, to be drawn over the edges
    const visibleElements = this.getSortedVisibleElementsInRow(rowIndex);
    const upPosition = this.createEndPositionFunction(rowIndex - 1, true);
    const downPosition = this.createEndPositionFunction(rowIndex + 1, false);
    const edge = (position: number, other: number, direction: EdgeDirection, e: GraphEdge, arrow: boolean, terminal = false) =>
      result.push(this.element("edge", rowIndex, position, e, other, direction, arrow, terminal));

    visibleElements.forEach((element, position) => {
      if (element instanceof GraphNode) {
        nodes.push(this.element("node", rowIndex, position, element, position, "down", false, false));
        for (const e of this.graph.getAdjacentEdges(element.nodeIndex, EdgeFilter.ALL)) {
          const arrowType = this.getArrowType(e, rowIndex);
          const down = downPosition(e);
          const up = upPosition(e);
          if (down != null) edge(position, down, "down", e, arrowType === "down");
          if (up != null) edge(position, up, "up", e, arrowType === "up");
        }
      } else {
        const down = downPosition(element);
        const up = upPosition(element);
        const arrowType = this.getArrowType(element, rowIndex);
        if (down != null) edge(position, down, "down", element, arrowType === "down");
        else if (arrowType === "down") edge(position, position, "down", element, true, true);
        if (up != null) edge(position, up, "up", element, arrowType === "up");
        else if (arrowType === "up") edge(position, position, "up", element, true, true);
      }
    });
    result.push(...nodes);
    return result;
  }

  private element(
    kind: "node" | "edge",
    row: number,
    position: number,
    graphElement: GraphElement,
    otherPosition: number,
    direction: EdgeDirection,
    arrow: boolean,
    terminal: boolean,
  ): GraphPrintElement {
    const colorId = this.presentation.getColorId(graphElement);
    return { kind, row, position, graphElement, colorId, otherPosition, direction, arrow, terminal };
  }

  private createEndPositionFunction(visibleRowIndex: number, up: boolean): (edge: GraphEdge) => number | null {
    if (visibleRowIndex < 0 || visibleRowIndex >= this.graph.nodesCount()) return () => null;
    const toPosition = new Map<string, number>();
    this.getSortedVisibleElementsInRow(visibleRowIndex).forEach((e, position) => toPosition.set(e.key, position));
    return (edge) => {
      const p = toPosition.get(edge.key);
      if (p !== undefined) return p;
      const nodeIndex = up ? edge.up : edge.down;
      if (nodeIndex == null) return null;
      return toPosition.get(this.graph.getGraphNode(nodeIndex).key) ?? null;
    };
  }

  private getArrowType(edge: GraphEdge, rowIndex: number): EdgeDirection | null {
    if (isNormalEdge(edge)) return this.getNormalArrowType(edge, rowIndex);
    switch (edge.type) {
      case EdgeType.DOTTED_ARROW_DOWN:
      case EdgeType.NOT_LOAD_COMMIT:
        if (edge.up === rowIndex - 1) return "down";
        break;
      case EdgeType.DOTTED_ARROW_UP:
        if (edge.down === rowIndex + 1) return "up";
        break;
    }
    return null;
  }

  private getNormalArrowType(e: { up: number; down: number }, rowIndex: number): EdgeDirection | null {
    const edgeSize = e.down - e.up;
    const upOffset = rowIndex - e.up;
    const downOffset = e.down - rowIndex;
    if (edgeSize >= this.longEdgeSize) {
      if (upOffset === this.visiblePartSize) return "down";
      if (downOffset === this.visiblePartSize) return "up";
    }
    if (edgeSize >= this.edgeWithArrowSize) {
      if (upOffset === 1) return "down";
      if (downOffset === 1) return "up";
    }
    return null;
  }

  private isNormalEdgeVisibleInRow(e: { up: number; down: number }, rowIndex: number): boolean {
    return e.down - e.up < this.longEdgeSize || Math.min(rowIndex - e.up, e.down - rowIndex) <= this.visiblePartSize;
  }

  getSortedVisibleElementsInRow(rowIndex: number): Elem[] {
    const cached = this.cache.get(rowIndex);
    if (cached) return cached;
    const result: Elem[] = [this.graph.getGraphNode(rowIndex)];
    for (const e of this.edgesInRow.getEdgesInRow(rowIndex)) {
      if (isNormalEdge(e) && this.isNormalEdgeVisibleInRow(e, rowIndex)) result.push(e);
    }
    if (rowIndex > 0) {
      for (const e of this.graph.getAdjacentEdges(rowIndex - 1, EdgeFilter.SPECIAL)) if (isEdgeDown(e, rowIndex - 1)) result.push(e);
    }
    if (rowIndex < this.graph.nodesCount() - 1) {
      for (const e of this.graph.getAdjacentEdges(rowIndex + 1, EdgeFilter.SPECIAL)) if (isEdgeUp(e, rowIndex + 1)) result.push(e);
    }
    result.sort(this.comparator);
    this.cache.put(rowIndex, result);
    return result;
  }
}

/** PrintElementPresentationManagerImpl.getColorId */
export function presentationColorId(
  graph: LinearGraph,
  layoutIndex: (nodeId: number) => number,
  nodeColor: (nodeId: number, layoutIndex: number) => number,
  element: GraphElement,
): number {
  if (element instanceof GraphNode) {
    const nodeId = graph.getNodeId(element.nodeIndex);
    return nodeColor(nodeId, layoutIndex(nodeId));
  }
  if (!isNormalEdge(element)) {
    const nodeId = graph.getNodeId(getNotNullNodeIndex(element));
    return nodeColor(nodeId, layoutIndex(nodeId));
  }
  const upNodeId = graph.getNodeId(element.up);
  const downNodeId = graph.getNodeId(element.down);
  const upLI = layoutIndex(upNodeId);
  const downLI = layoutIndex(downNodeId);
  return upLI >= downLI ? nodeColor(upNodeId, upLI) : nodeColor(downNodeId, downLI);
}
