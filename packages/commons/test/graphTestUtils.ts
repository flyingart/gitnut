// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/test/com/intellij/vcs/log/graph/{TestGraphBuilder.kt,
// StrUtils.kt,GraphStrUtils.java,parser/{CommitParser.java,LinearGraphParser.java,EdgeNodeCharConverter.java}}, Apache-2.0.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EdgeFilter,
  EdgeType,
  GraphEdge,
  GraphNode,
  isEdgeDown,
  isEdgeUp,
  isNormalEdgeType,
  NodeType,
  type GraphElement,
  type GraphLayout,
  type LinearGraph,
} from "../src/graph/linearGraph";
import { graphElementComparatorByLayoutIndex, type EdgesInRowGenerator, type GraphPrintElement, type PrintElementGeneratorImpl } from "../src/graph/printElements";
import { PermanentLinearGraphBuilder } from "../src/graph/permanentLinearGraph";

const FIXTURES = join(import.meta.dir, "fixtures", "intellij");
export const loadText = (dir: string, name: string) => readFileSync(join(FIXTURES, dir, name), "utf8").replace(/\r\n/g, "\n");
export const fixturePair = (dir: string, test: string) => [loadText(dir, `${test}_in.txt`), loadText(dir, `${test}_out.txt`).trimEnd()] as const;

// EdgeNodeCharConverter
const NODE_CHARS: Record<string, NodeType> = { U: NodeType.USUAL, G: NodeType.UNMATCHED, N: NodeType.NOT_LOAD_COMMIT };
const EDGE_CHARS: Record<string, EdgeType> = {
  U: EdgeType.USUAL,
  D: EdgeType.DOTTED,
  N: EdgeType.NOT_LOAD_COMMIT,
  P: EdgeType.DOTTED_ARROW_UP,
  O: EdgeType.DOTTED_ARROW_DOWN,
};
const reverse = <T>(m: Record<string, T>) => new Map(Object.entries(m).map(([k, v]) => [v, k]));
const NODE_CHAR = reverse(NODE_CHARS);
const EDGE_CHAR = reverse(EDGE_CHARS);
export const edgeChar = (t: EdgeType) => EDGE_CHAR.get(t)!;

const SEPARATOR = "|-";
export const toLines = (s: string) => s.split("\n").filter((l) => l.length > 0);

/** CommitParser.parseStringCommitList, mapped to builder input: parents as node ids, missing commits as ids >= n. */
export function parseCommits(input: string) {
  const lines = toLines(input).map((line) => {
    const i = line.indexOf(SEPARATOR);
    return { id: line.slice(0, i), parents: line.slice(i + 2).split(/\s/).filter((p) => p.length > 0) };
  });
  const indexOf = new Map(lines.map((c, i) => [c.id, i]));
  const missing: string[] = [];
  const idOf = (hash: string) => {
    const i = indexOf.get(hash);
    if (i !== undefined) return i;
    let m = missing.indexOf(hash);
    if (m === -1) m = missing.push(hash) - 1;
    return lines.length + m;
  };
  const parents = lines.map((c) => c.parents.map(idOf));
  const hashOf = (id: number) => (id < lines.length ? lines[id].id : missing[id - lines.length]);
  return { ids: lines.map((c) => c.id), parents, hashOf };
}

/** PermanentLinearGraphBuilder over parsed commits; not loaded commits get -hex(hash) like GraphBuilderTest. */
export function buildFromText(input: string, notLoaded: "hash" | "min" = "min") {
  const c = parseCommits(input);
  const builder = PermanentLinearGraphBuilder.newInstance(c.parents);
  const graph = notLoaded === "hash" ? builder.build((id) => -parseInt(c.hashOf(id), 16)) : builder.build();
  return { ...c, graph };
}

const decode = (s: string) => (s.startsWith("0x") ? parseInt(s.slice(2), 16) : parseInt(s, 10));

/** LinearGraphParser.parse: "0_U|-1_U 2_D" lines. */
export function parseLinearGraph(input: string): LinearGraph {
  const nodes: GraphNode[] = [];
  const rawEdges: string[][] = [];
  const idToIndex = new Map<number, number>();
  for (const line of toLines(input)) {
    const sep = line.indexOf(SEPARATOR);
    const head = line.slice(0, sep);
    idToIndex.set(decode(head.slice(0, -2)), nodes.length);
    nodes.push(new GraphNode(nodes.length, NODE_CHARS[head[head.length - 1]]));
    rawEdges.push(line.slice(sep + 2).split(/\s/).filter((s) => s.length > 0));
  }
  const upEdges = new Map<number, GraphEdge[]>();
  const downEdges = new Map<number, GraphEdge[]>();
  const put = (m: Map<number, GraphEdge[]>, k: number, e: GraphEdge) => (m.get(k) ?? m.set(k, []).get(k)!).push(e);
  nodes.forEach((node, i) => {
    for (const s of rawEdges[i]) {
      const nodeId = decode(s.slice(0, -2));
      const type = EDGE_CHARS[s[s.length - 1]];
      const edge = isNormalEdgeType(type)
        ? GraphEdge.normal(node.nodeIndex, idToIndex.get(nodeId)!, type)
        : GraphEdge.withTargetId(node.nodeIndex, nodeId, type);
      if (edge.up != null) put(downEdges, edge.up, edge);
      if (edge.down != null) put(upEdges, edge.down, edge);
    }
  });
  return {
    nodesCount: () => nodes.length,
    getAdjacentEdges(nodeIndex: number, filter: EdgeFilter) {
      const result: GraphEdge[] = [];
      for (const e of upEdges.get(nodeIndex) ?? []) if (isNormalEdgeType(e.type) ? filter.upNormal : filter.special) result.push(e);
      for (const e of downEdges.get(nodeIndex) ?? []) if (isNormalEdgeType(e.type) ? filter.downNormal : filter.special) result.push(e);
      return result;
    },
    getGraphNode: (i: number) => nodes[i],
    getNodeId: (i: number) => i,
    getNodeIndex: (id: number) => (id >= 0 && id < nodes.length ? id : null),
  };
}

// TestGraphBuilder DSL: graph([[1, [2, 3]], [2, [dot(3)]], [unm(3)]])

export interface SimpleEdge {
  to: number | null;
  type: EdgeType;
}
export interface SimpleNode {
  id: number;
  type: NodeType;
}
export const dot = (to: number): SimpleEdge => ({ to, type: EdgeType.DOTTED });
export const upDot = (to: number | null): SimpleEdge => ({ to, type: EdgeType.DOTTED_ARROW_UP });
export const downDot = (to: number | null): SimpleEdge => ({ to, type: EdgeType.DOTTED_ARROW_DOWN });
export const notLoad = (to: number | null): SimpleEdge => ({ to, type: EdgeType.NOT_LOAD_COMMIT });
export const unm = (id: number): SimpleNode => ({ id, type: NodeType.UNMATCHED });

export type NodeSpec = [number | SimpleNode, (number | SimpleEdge)[]?];

export function graph(spec: NodeSpec[]): LinearGraph {
  const nodes = spec.map(([n, edges = []]) => ({
    ...(typeof n === "number" ? { id: n, type: NodeType.USUAL as NodeType } : n),
    edges: edges.map((e) => (typeof e === "number" ? { to: e, type: EdgeType.USUAL as EdgeType } : e)),
  }));
  const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = new Map<number, GraphEdge[]>();
  const put = (k: number, e: GraphEdge) => (edges.get(k) ?? edges.set(k, []).get(k)!).push(e);
  for (const node of nodes) {
    const nodeIndex = idToIndex.get(node.id)!;
    for (const e of node.edges) {
      if (isNormalEdgeType(e.type)) {
        const other = idToIndex.get(e.to!);
        if (other === undefined) throw new Error(`Node ${node.id} has an edge to a missing node ${e.to}`);
        const edge = GraphEdge.normal(other, nodeIndex, e.type);
        put(nodeIndex, edge);
        put(other, edge);
      } else put(nodeIndex, GraphEdge.withTargetId(nodeIndex, e.to, e.type));
    }
  }
  return {
    nodesCount: () => nodes.length,
    getNodeId: (i: number) => nodes[i].id,
    getNodeIndex: (id: number) => idToIndex.get(id) ?? null,
    getGraphNode: (i: number) => new GraphNode(i, nodes[i].type),
    getAdjacentEdges: (nodeIndex: number, filter: EdgeFilter) =>
      (edges.get(nodeIndex) ?? []).filter((e) =>
        isNormalEdgeType(e.type) ? (isEdgeUp(e, nodeIndex) && filter.upNormal) || (isEdgeDown(e, nodeIndex) && filter.downNormal) : filter.special,
      ),
  };
}

/** GraphStrUtils.GRAPH_ELEMENT_COMPARATOR */
export const GRAPH_ELEMENT_COMPARATOR = graphElementComparatorByLayoutIndex(() => 0);

export function asTestGraphString(g: LinearGraph, sorted = false): string {
  let s = "";
  for (let i = 0; i < g.nodesCount(); i++) {
    const node = g.getGraphNode(i);
    s += g.getNodeId(i);
    if (node.type === NodeType.UNMATCHED) s += ".UNM";
    else if (node.type === NodeType.NOT_LOAD_COMMIT) s += ".NOT_LOAD";
    let edges = g.getAdjacentEdges(i, EdgeFilter.ALL);
    if (sorted) edges = [...edges].sort(GRAPH_ELEMENT_COMPARATOR);
    const parts: string[] = [];
    for (const e of edges) {
      if (e.up !== i) continue;
      const start = isNormalEdgeType(e.type) ? String(g.getNodeId(e.down!)) : e.targetId != null ? String(e.targetId) : "null";
      const suffix = { [EdgeType.USUAL]: "", [EdgeType.DOTTED]: ".dot", [EdgeType.DOTTED_ARROW_UP]: ".up_dot", [EdgeType.DOTTED_ARROW_DOWN]: ".down_dot", [EdgeType.NOT_LOAD_COMMIT]: ".not_load" }[e.type];
      parts.push(start + suffix);
    }
    s += `(${parts.join(", ")})\n`;
  }
  return s;
}

// StrUtils.kt

const n = (v: number | null) => (v == null ? "n" : String(v));
export const edgeAsString = (e: GraphEdge) => `${n(e.up)}:${n(e.down)}:${n(e.targetId)}_${edgeChar(e.type)}`;
export const nodeAsString = (node: GraphNode) => `${node.nodeIndex}_${NODE_CHAR.get(node.type)}`;
export const elementAsString = (e: GraphElement) => (e instanceof GraphNode ? nodeAsString(e) : edgeAsString(e));

export function linearGraphAsString(g: LinearGraph): string {
  const lines: string[] = [];
  for (let i = 0; i < g.nodesCount(); i++) {
    lines.push(nodeAsString(g.getGraphNode(i)) + SEPARATOR + g.getAdjacentEdges(i, EdgeFilter.ALL).map(edgeAsString).join(" "));
  }
  return lines.join("\n");
}

export function printElementAsString(pe: GraphPrintElement): string {
  const element = elementAsString(pe.graphElement);
  if (pe.kind === "node") return `Node|-${pe.row}:${pe.position}|-${pe.colorId}:Unselect(${element})`;
  const t = pe.direction === "up" ? "UP" : "DOWN";
  const ls = pe.graphElement instanceof GraphEdge && [EdgeType.USUAL, EdgeType.NOT_LOAD_COMMIT].includes(pe.graphElement.type as 0 | 2) ? "SOLID" : "DASHED";
  return `Edge:${t}${pe.arrow ? "_ARROW" : ""}:${ls}|-${pe.row}:${pe.position}:${pe.otherPosition}|-${pe.colorId}:Unselect(${element})`;
}

export function printElementGeneratorAsString(gen: PrintElementGeneratorImpl, size: number): string {
  const rows: string[] = [];
  for (let row = 0; row < size; row++) {
    const key = (pe: GraphPrintElement) =>
      pe.kind === "node" ? 1024 * pe.position : 1024 * pe.position + ((pe.direction === "up" ? 0 : 1) + 1) * 64 + pe.otherPosition;
    rows.push([...gen.getPrintElements(row)].sort((a, b) => key(a) - key(b)).map(printElementAsString).join("\n  "));
  }
  return rows.join("\n");
}

export function edgesInRowToStr(gen: EdgesInRowGenerator, nodesCount: number): string {
  const rows: string[] = [];
  for (let i = 0; i < nodesCount; i++) {
    const edges = gen.getEdgesInRow(i);
    rows.push(
      edges.length === 0
        ? "none"
        : [...edges].sort(GRAPH_ELEMENT_COMPARATOR).map((e) => `${e.up}_${e.down}_${edgeChar(e.type)}`).join(" "),
    );
  }
  return rows.join("\n");
}

export function permanentGraphLayoutModelToStr(layout: GraphLayout, nodesCount: number): string {
  const rows: string[] = [];
  for (let i = 0; i < nodesCount; i++) rows.push(`${layout.getLayoutIndex(i)}${SEPARATOR}${layout.getOneOfHeadNodeIndex(i)}`);
  return rows.join("\n");
}
