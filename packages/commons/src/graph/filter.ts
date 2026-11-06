// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/
// {CollapsedGraph.java,DottedFilterEdgesGenerator.kt,EdgeStorage.java,EdgeStorageWrapper.java,GraphNodesVisibility.java},
// impl/facade/FilteredController.kt, utils/GraphUtil.kt (getReachableMatchingNodes), Apache-2.0.
//
// The CollapsedGraph here is the static form FilteredController needs: visibility and extra (dotted) edges are fixed
// at creation. The Modification machinery that CollapsedController uses for expand/collapse is not ported.

import {
  dfsWalkDown,
  EdgeType,
  getNodes,
  GraphEdge,
  GraphNode,
  isEdgeDown,
  isEdgeUp,
  isNormalEdgeType,
  type EdgeFilter,
  type LinearGraph,
} from "./linearGraph";

/** GraphUtil.getReachableMatchingNodes; visibility is indexed by node id. */
export function getReachableMatchingNodes(
  graph: LinearGraph,
  startNodes: Iterable<number> | null,
  matchedNodes: ReadonlySet<number> | null,
): Uint8Array {
  const visibility = new Uint8Array(graph.nodesCount());
  if (startNodes == null) {
    if (matchedNodes == null) visibility.fill(1);
    else for (const id of matchedNodes) if (id >= 0 && id < visibility.length) visibility[id] = 1;
    return visibility;
  }
  dfsWalkDown(startNodes, graph, (node) => {
    if (matchedNodes == null || matchedNodes.has(node)) visibility[node] = 1;
  });
  return visibility;
}

const NULL_ID = Number.MIN_SAFE_INTEGER;

/** EdgeStorage: node id -> (other id or NULL_ID, type), set semantics, insertion order. */
export class EdgeStorage {
  private readonly edges = new Map<number, [number, EdgeType][]>();
  private put(key: number, other: number, type: EdgeType) {
    let list = this.edges.get(key);
    if (!list) this.edges.set(key, (list = []));
    if (!list.some(([o, t]) => o === other && t === type)) list.push([other, type]);
  }
  createEdge(mainNodeId: number, additionId: number, type: EdgeType) {
    this.put(mainNodeId, additionId, type);
    if (isNormalEdgeType(type)) this.put(additionId, mainNodeId, type);
  }
  getEdges(nodeId: number): readonly [number | null, EdgeType][] {
    return (this.edges.get(nodeId) ?? []).map(([o, t]) => [o === NULL_ID ? null : o, t] as [number | null, EdgeType]);
  }
}

/** EdgeStorageWrapper over a graph: stores edges by node ids, answers in node indexes of that graph. */
class EdgeStorageWrapper {
  constructor(
    private readonly storage: EdgeStorage,
    private readonly graph: Pick<LinearGraph, "getNodeId" | "getNodeIndex">,
  ) {}

  createEdge(edge: GraphEdge) {
    const id = (i: number) => this.graph.getNodeId(i);
    const target = edge.targetId ?? NULL_ID;
    if (edge.up != null) this.storage.createEdge(id(edge.up), edge.down != null ? id(edge.down) : target, edge.type);
    else this.storage.createEdge(id(edge.down!), target, edge.type);
  }

  getAdjacentEdges(nodeIndex: number, filter: EdgeFilter): GraphEdge[] {
    const result: GraphEdge[] = [];
    for (const [targetId, type] of this.storage.getEdges(this.graph.getNodeId(nodeIndex))) {
      let edge: GraphEdge | null;
      if (isNormalEdgeType(type)) {
        const other = this.graph.getNodeIndex(targetId!);
        edge = other == null ? null : GraphEdge.normal(nodeIndex, other, type);
      } else edge = GraphEdge.withTargetId(nodeIndex, targetId, type);
      if (edge == null) continue;
      const matched = isNormalEdgeType(edge.type)
        ? (nodeIndex === edge.down && filter.upNormal) || (nodeIndex === edge.up && filter.downNormal)
        : filter.special;
      if (matched) result.push(edge);
    }
    return result;
  }
}

export class CollapsedGraph {
  /** compiled (visible) index -> delegate index */
  private readonly shortToLong: Int32Array;
  /** delegate index -> compiled index, -1 when hidden */
  private readonly longToShort: Int32Array;
  readonly compiledGraph: LinearGraph;

  /** @param visibleById node visibility by node id of the delegated graph */
  constructor(
    readonly delegatedGraph: LinearGraph,
    private readonly visibleById: Uint8Array,
    private readonly edgeStorage = new EdgeStorage(),
  ) {
    const n = delegatedGraph.nodesCount();
    this.longToShort = new Int32Array(n).fill(-1);
    const shortToLong: number[] = [];
    for (let i = 0; i < n; i++) if (this.isNodeVisible(i)) this.longToShort[i] = shortToLong.push(i) - 1;
    this.shortToLong = Int32Array.from(shortToLong);
    this.compiledGraph = new CompiledGraph(this);
  }

  isNodeVisible(delegateNodeIndex: number): boolean {
    return this.visibleById[this.delegatedGraph.getNodeId(delegateNodeIndex)] === 1;
  }

  get visibleCount(): number {
    return this.shortToLong.length;
  }

  convertToDelegateNodeIndex(compiledNodeIndex: number): number {
    return this.shortToLong[compiledNodeIndex];
  }

  /** Short index of a visible delegate node, -1 when hidden. */
  compiledIndex(delegateNodeIndex: number): number {
    return this.longToShort[delegateNodeIndex];
  }

  /** Adds an edge between delegate node indexes (Modification.createEdge + apply). */
  createEdge(edge: GraphEdge) {
    new EdgeStorageWrapper(this.edgeStorage, this.delegatedGraph).createEdge(edge);
  }

  storageWrapperFor(graph: LinearGraph) {
    return new EdgeStorageWrapper(this.edgeStorage, graph);
  }
}

class CompiledGraph implements LinearGraph {
  private readonly storage: EdgeStorageWrapper;
  constructor(private readonly c: CollapsedGraph) {
    this.storage = c.storageWrapperFor(this);
  }
  nodesCount(): number {
    return this.c.visibleCount;
  }
  private compiledNodeIndex(delegateNodeIndex: number | null): number | null {
    if (delegateNodeIndex == null) return null;
    return this.c.compiledIndex(delegateNodeIndex);
  }
  getAdjacentEdges(nodeIndex: number, filter: EdgeFilter): GraphEdge[] {
    const result: GraphEdge[] = [];
    const delegateIndex = this.c.convertToDelegateNodeIndex(nodeIndex);
    for (const e of this.c.delegatedGraph.getAdjacentEdges(delegateIndex, filter)) {
      const up = this.compiledNodeIndex(e.up);
      const down = this.compiledNodeIndex(e.down);
      if (up !== -1 && down !== -1) result.push(new GraphEdge(up, down, e.targetId, e.type));
    }
    result.push(...this.storage.getAdjacentEdges(nodeIndex, filter));
    return result;
  }
  getGraphNode(nodeIndex: number): GraphNode {
    return new GraphNode(nodeIndex, this.c.delegatedGraph.getGraphNode(this.c.convertToDelegateNodeIndex(nodeIndex)).type);
  }
  getNodeId(nodeIndex: number): number {
    return this.c.delegatedGraph.getNodeId(this.c.convertToDelegateNodeIndex(nodeIndex));
  }
  getNodeIndex(nodeId: number): number | null {
    const delegateIndex = this.c.delegatedGraph.getNodeIndex(nodeId);
    if (delegateIndex == null) return null;
    const i = this.c.compiledIndex(delegateIndex);
    return i === -1 ? null : i;
  }
}

/**
 * DottedFilterEdgesGenerator: connects visible nodes through hidden ones with dotted edges.
 * `numbers` holds, per node, the nearest visible node found by the walk (up walk, then down walk).
 */
export function generateDottedFilterEdges(collapsedGraph: CollapsedGraph, upIndex: number, downIndex: number): void {
  const graph = collapsedGraph.delegatedGraph;
  const visible = (i: number) => collapsedGraph.isNodeVisible(i);
  const MIN = -0x80000000;
  const MAX = 0x7fffffff;
  const numbers = new Int32Array(downIndex - upIndex + 1);
  const inRange = (i: number) => i >= upIndex && i <= downIndex;
  const getNumber = (i: number) => (inRange(i) ? numbers[i - upIndex] : -1);
  const setNumber = (i: number, v: number) => {
    if (inRange(i)) numbers[i - upIndex] = v;
  };
  // edges of this run (Modification.edgesToAdd), indexed by delegate node index, for hasDottedEdges
  const added = new Map<number, GraphEdge[]>();
  const addEdge = (e: GraphEdge) => {
    for (const i of [e.up, e.down]) if (i != null) (added.get(i) ?? added.set(i, []).get(i)!).push(e);
    collapsedGraph.createEdge(e);
  };
  const addDottedEdge = (a: number, b: number) => addEdge(GraphEdge.normal(a, b, EdgeType.DOTTED));
  const addDottedArrow = (i: number, isUp: boolean) =>
    addEdge(GraphEdge.withTargetId(i, null, isUp ? EdgeType.DOTTED_ARROW_UP : EdgeType.DOTTED_ARROW_DOWN));
  const hasDottedEdges = (i: number, isUp: boolean) => {
    for (const e of added.get(i) ?? []) {
      if (e.type !== EdgeType.DOTTED) continue;
      if (isUp && isEdgeUp(e, i)) return true;
      if (!isUp && isEdgeDown(e, i)) return false; // sic, IntelliJ returns false here
    }
    return false;
  };
  const addEdgeOrArrow = (current: number, another: number, isUp: boolean) => {
    if (hasDottedEdges(current, isUp)) {
      if (visible(another)) addDottedEdge(current, another);
      else addDottedArrow(current, isUp);
    }
  };

  // downWalk
  for (let cur = upIndex; cur <= downIndex; cur++) {
    if (visible(cur)) {
      let nearlyUp = MIN;
      let maxAdjNumber = MIN;
      for (const upNode of getNodes(graph, cur, true)) {
        if (upNode < upIndex) {
          addEdgeOrArrow(cur, upNode, true);
          continue;
        }
        if (visible(upNode)) maxAdjNumber = Math.max(maxAdjNumber, getNumber(upNode));
        else nearlyUp = Math.max(nearlyUp, getNumber(upNode));
      }
      if (nearlyUp === maxAdjNumber || nearlyUp === MIN) setNumber(cur, maxAdjNumber);
      else {
        addDottedEdge(cur, nearlyUp);
        setNumber(cur, nearlyUp);
      }
    } else {
      let nearlyUp = MIN;
      for (const upNode of getNodes(graph, cur, true)) {
        if (visible(upNode)) nearlyUp = Math.max(nearlyUp, upNode);
        else if (upNode >= upIndex) nearlyUp = Math.max(nearlyUp, getNumber(upNode));
      }
      setNumber(cur, nearlyUp);
    }
  }
  // cleanup
  numbers.fill(MAX);
  // upWalk
  for (let cur = downIndex; cur >= upIndex; cur--) {
    if (visible(cur)) {
      let nearlyDown = MAX;
      let minAdjNumber = MAX;
      for (const downNode of getNodes(graph, cur, false)) {
        if (downNode > downIndex) {
          addEdgeOrArrow(cur, downNode, false);
          continue;
        }
        if (visible(downNode)) minAdjNumber = Math.min(minAdjNumber, getNumber(downNode));
        else nearlyDown = Math.min(nearlyDown, getNumber(downNode));
      }
      if (nearlyDown === minAdjNumber || nearlyDown === MAX) setNumber(cur, minAdjNumber);
      else {
        addDottedEdge(cur, nearlyDown);
        setNumber(cur, nearlyDown);
      }
    } else {
      let nearlyDown = MAX;
      for (const downNode of getNodes(graph, cur, false)) {
        if (visible(downNode)) nearlyDown = Math.min(nearlyDown, downNode);
        else if (downNode <= downIndex) nearlyDown = Math.min(nearlyDown, getNumber(downNode));
      }
      setNumber(cur, nearlyDown);
    }
  }
}

/** FilteredController.create: the compiled graph of the filtered view. */
export function createFilteredGraph(
  delegateGraph: LinearGraph,
  permanentGraph: LinearGraph,
  matchedIds: ReadonlySet<number> | null,
  visibleHeadsIds: Iterable<number> | null,
): LinearGraph {
  const visibility = getReachableMatchingNodes(permanentGraph, visibleHeadsIds, matchedIds);
  const collapsed = new CollapsedGraph(delegateGraph, visibility);
  // CollapsedController (branch filter only) does not generate dotted edges
  if (matchedIds != null) generateDottedFilterEdges(collapsed, 0, delegateGraph.nodesCount() - 1);
  return collapsed.compiledGraph;
}
