// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/api/{LinearGraph.kt,
// LiteLinearGraph.java,EdgeFilter.java,GraphLayout.java,elements/*}, utils/{LinearGraphUtils.java,DfsUtil.kt,NormalEdge.java}, Apache-2.0.

/** GraphEdgeType, values are the Java ordinals. */
export const EdgeType = { USUAL: 0, DOTTED: 1, NOT_LOAD_COMMIT: 2, DOTTED_ARROW_UP: 3, DOTTED_ARROW_DOWN: 4 } as const;
export type EdgeType = (typeof EdgeType)[keyof typeof EdgeType];
export const isNormalEdgeType = (t: EdgeType) => t === EdgeType.USUAL || t === EdgeType.DOTTED;

export const NodeType = { USUAL: 0, NOT_LOAD_COMMIT: 1, UNMATCHED: 2 } as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

export interface EdgeFilter {
  readonly upNormal: boolean;
  readonly downNormal: boolean;
  readonly special: boolean;
}
export const EdgeFilter = {
  ALL: { upNormal: true, downNormal: true, special: true },
  NORMAL_DOWN: { upNormal: false, downNormal: true, special: false },
  NORMAL_UP: { upNormal: true, downNormal: false, special: false },
  NORMAL_ALL: { upNormal: true, downNormal: true, special: false },
  SPECIAL: { upNormal: false, downNormal: false, special: true },
} as const satisfies Record<string, EdgeFilter>;

export class GraphNode {
  constructor(
    readonly nodeIndex: number,
    readonly type: NodeType = NodeType.USUAL,
  ) {}
  get key(): string {
    return `n${this.nodeIndex}:${this.type}`;
  }
}

export class GraphEdge {
  private k?: string;
  constructor(
    readonly up: number | null,
    readonly down: number | null,
    readonly targetId: number | null,
    readonly type: EdgeType,
  ) {}

  static normal(nodeIndex1: number, nodeIndex2: number, type: EdgeType): GraphEdge {
    return new GraphEdge(Math.min(nodeIndex1, nodeIndex2), Math.max(nodeIndex1, nodeIndex2), null, type);
  }

  static withTargetId(nodeIndex: number, targetId: number | null, type: EdgeType): GraphEdge {
    if (type === EdgeType.DOTTED_ARROW_UP) return new GraphEdge(null, nodeIndex, targetId, type);
    if (type === EdgeType.NOT_LOAD_COMMIT || type === EdgeType.DOTTED_ARROW_DOWN) return new GraphEdge(nodeIndex, null, targetId, type);
    throw new Error(`Unexpected edge type: ${type}`);
  }

  /** Value identity (Java equals/hashCode). */
  get key(): string {
    return (this.k ??= `${this.up}:${this.down}:${this.targetId}:${this.type}`);
  }
}

export type GraphElement = GraphNode | GraphEdge;
export const elementKey = (e: GraphElement) => e.key;

export interface LinearGraph {
  nodesCount(): number;
  getAdjacentEdges(nodeIndex: number, filter: EdgeFilter): GraphEdge[];
  getGraphNode(nodeIndex: number): GraphNode;
  /** Node id: index in the permanent graph. */
  getNodeId(nodeIndex: number): number;
  getNodeIndex(nodeId: number): number | null;
}

export interface GraphLayout {
  getLayoutIndex(nodeIndex: number): number;
  getOneOfHeadNodeIndex(nodeIndex: number): number;
  getHeadNodeIndex(): Int32Array | number[];
}

/** Fast paths of PermanentLinearGraphImpl (forEachDownNode/forEachUpNode), see LinearGraphUtils.collectDownNodes. */
export interface FastLinearGraph extends LinearGraph {
  forEachDownNode(nodeIndex: number, handler: (node: number) => void): void;
  forEachUpNode(nodeIndex: number, handler: (node: number) => void): void;
}
const isFast = (g: LinearGraph): g is FastLinearGraph => typeof (g as FastLinearGraph).forEachDownNode === "function";

// LinearGraphUtils

export const isEdgeUp = (edge: GraphEdge, nodeIndex: number) => edge.down === nodeIndex;
export const isEdgeDown = (edge: GraphEdge, nodeIndex: number) => edge.up === nodeIndex;
export const isNormalEdge = (edge: GraphEdge | null | undefined): edge is GraphEdge & { up: number; down: number } =>
  edge != null && isNormalEdgeType(edge.type);

export function getNotNullNodeIndex(edge: GraphEdge): number {
  if (edge.up != null) return edge.up;
  return edge.down!;
}

export function getUpNodes(graph: LinearGraph, nodeIndex: number): number[] {
  const result: number[] = [];
  collectUpNodes(graph, nodeIndex, result);
  return result;
}

export function getDownNodes(graph: LinearGraph, nodeIndex: number): number[] {
  const result: number[] = [];
  collectDownNodes(graph, nodeIndex, result);
  return result;
}

export function collectUpNodes(graph: LinearGraph, nodeIndex: number, result: number[]): void {
  result.length = 0;
  if (isFast(graph)) graph.forEachUpNode(nodeIndex, (n) => result.push(n));
  else for (const e of graph.getAdjacentEdges(nodeIndex, EdgeFilter.NORMAL_UP)) if (e.up != null) result.push(e.up);
}

export function collectDownNodes(graph: LinearGraph, nodeIndex: number, result: number[]): void {
  result.length = 0;
  if (isFast(graph)) graph.forEachDownNode(nodeIndex, (n) => result.push(n));
  else for (const e of graph.getAdjacentEdges(nodeIndex, EdgeFilter.NORMAL_DOWN)) if (e.down != null) result.push(e.down);
}

/** LiteLinearGraph.getNodes: adjacent node indexes in one direction. */
export function getNodes(graph: LinearGraph, nodeIndex: number, up: boolean): number[] {
  return up ? getUpNodes(graph, nodeIndex) : getDownNodes(graph, nodeIndex);
}

// DfsUtil

export const NODE_NOT_FOUND = -1;
export const EXIT = -10;

export function walk(start: number, nextNode: (current: number) => number, stack: number[] = []): void {
  stack.push(start);
  while (stack.length > 0) {
    const next = nextNode(stack[stack.length - 1]);
    if (next === EXIT) return;
    if (next !== NODE_NOT_FOUND) stack.push(next);
    else stack.pop();
  }
}

/** DfsWalk.walk(goDown = true). */
export function dfsWalkDown(startNodes: Iterable<number>, graph: LinearGraph, consumer: (node: number) => void): void {
  const visited = new Uint8Array(graph.nodesCount());
  const stack: number[] = [];
  const buf: number[] = [];
  for (const start of startNodes) {
    if (start < 0 || visited[start]) continue;
    visited[start] = 1;
    consumer(start);
    walk(
      start,
      (current) => {
        collectDownNodes(graph, current, buf);
        for (const down of buf) {
          if (!visited[down]) {
            visited[down] = 1;
            consumer(down);
            return down;
          }
        }
        return NODE_NOT_FOUND;
      },
      stack,
    );
  }
}
