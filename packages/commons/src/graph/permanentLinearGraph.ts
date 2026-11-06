// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/permanent/
// {PermanentLinearGraphBuilder.java,PermanentLinearGraphImpl.java,DuplicateParentFixer.java}, Apache-2.0.
//
// Commit ids are numbers: id i is node i when 0 <= i < n (gitnut snapshot index). PermanentCommitsInfoImpl is the identity
// mapping then, so it is not ported as a class; the timestamps live next to the graph (see facade.ts).

import { type EdgeFilter, EdgeType, type FastLinearGraph, GraphEdge, GraphNode } from "./linearGraph";

/** DuplicateParentFixer.fixParentsDuplicate: keeps the first occurrence of each parent. */
function fixParentsDuplicate(parents: ArrayLike<number>): ArrayLike<number> {
  if (parents.length <= 1) return parents;
  if (parents.length === 2) return parents[0] !== parents[1] ? parents : [parents[0]];
  const all = new Set(Array.from(parents));
  if (all.size === parents.length) return parents;
  const correct: number[] = [];
  for (let i = 0; i < parents.length; i++) if (all.delete(parents[i])) correct.push(parents[i]);
  return correct;
}

export class PermanentLinearGraphBuilder {
  private readonly nodeToEdgeIndex: Int32Array;
  private readonly longEdges: Int32Array;
  /** downCommitId -> up node indexes */
  private readonly upAdjacentNodes = new Map<number, number[]>();

  private constructor(
    private readonly parents: ArrayLike<number>[],
    private readonly simpleNodes: Uint8Array,
    longEdgesCount: number,
  ) {
    this.nodeToEdgeIndex = new Int32Array(simpleNodes.length + 1);
    this.longEdges = new Int32Array(2 * longEdgesCount);
  }

  /** @param parents parent commit ids per node, nodes in topological order (children first). */
  static newInstance(parents: ArrayLike<ArrayLike<number>>): PermanentLinearGraphBuilder {
    const n = parents.length;
    const fixed: ArrayLike<number>[] = new Array(n);
    const simpleNodes = new Uint8Array(n);
    let longEdgesCount = 0;
    for (let i = 0; i < n; i++) {
      const p = (fixed[i] = fixParentsDuplicate(parents[i]));
      if (p.length === 1 && p[0] === i + 1 && i < n - 1) simpleNodes[i] = 1;
      else longEdgesCount += p.length;
    }
    return new PermanentLinearGraphBuilder(fixed, simpleNodes, longEdgesCount);
  }

  private addUnderdoneEdge(upNodeIndex: number, downCommitId: number) {
    const ups = this.upAdjacentNodes.get(downCommitId);
    if (ups) ups.push(upNodeIndex);
    else this.upAdjacentNodes.set(downCommitId, [upNodeIndex]);
  }

  private fixUnderdoneEdge(upNodeIndex: number, downNodeIndex: number, downCommitId: number) {
    const end = this.nodeToEdgeIndex[upNodeIndex + 1];
    const p = this.parents[upNodeIndex];
    for (let i = 0; i < p.length; i++) {
      if (p[i] === downCommitId) {
        const edgeIndex = end - (p.length - i);
        if (this.longEdges[edgeIndex] !== -1) throw new Error(`Edge was set early! Up node: ${upNodeIndex}, down node: ${downNodeIndex}`);
        this.longEdges[edgeIndex] = downNodeIndex;
        return;
      }
    }
    throw new Error(`Not found underdone edges for node: ${upNodeIndex}. Adjacent down node: ${downNodeIndex}`);
  }

  private doStep(nodeIndex: number) {
    const ups = this.upAdjacentNodes.get(nodeIndex);
    if (ups) this.upAdjacentNodes.delete(nodeIndex);
    let edgeIndex = this.nodeToEdgeIndex[nodeIndex];
    if (ups) {
      for (const up of ups) {
        this.fixUnderdoneEdge(up, nodeIndex, nodeIndex);
        this.longEdges[edgeIndex++] = up;
      }
    }
    if (!this.simpleNodes[nodeIndex]) {
      const p = this.parents[nodeIndex];
      for (let i = 0; i < p.length; i++) {
        this.addUnderdoneEdge(nodeIndex, p[i]);
        this.longEdges[edgeIndex++] = -1;
      }
    }
    this.nodeToEdgeIndex[nodeIndex + 1] = edgeIndex;
  }

  private fixUnderdoneEdgeForNotLoadCommit(upNodeIndex: number, notLoadId: number) {
    for (let e = this.nodeToEdgeIndex[upNodeIndex]; e < this.nodeToEdgeIndex[upNodeIndex + 1]; e++) {
      if (this.longEdges[e] === -1) {
        this.longEdges[e] = notLoadId;
        return;
      }
    }
    throw new Error(`Not found underdone edge to not load commit for node: ${upNodeIndex}`);
  }

  /** @param notLoadedCommitToId ids must be less than -1 */
  build(notLoadedCommitToId: (commitId: number) => number = () => -0x80000000): PermanentLinearGraphImpl {
    for (let i = 0; i < this.simpleNodes.length; i++) this.doStep(i);
    const minUp = (ups: number[]) => ups.reduce((a, b) => Math.min(a, b));
    const notLoaded = [...this.upAdjacentNodes.entries()].sort((a, b) => minUp(a[1]) - minUp(b[1]));
    for (const [commitId, ups] of notLoaded) {
      const id = notLoadedCommitToId(commitId);
      for (const up of ups) this.fixUnderdoneEdgeForNotLoadCommit(up, id);
    }
    return new PermanentLinearGraphImpl(this.simpleNodes, this.nodeToEdgeIndex, this.longEdges);
  }
}

export class PermanentLinearGraphImpl implements FastLinearGraph {
  constructor(
    private readonly simpleNodes: Uint8Array,
    private readonly nodeToEdgeIndex: Int32Array,
    private readonly longEdges: Int32Array,
  ) {}

  nodesCount(): number {
    return this.simpleNodes.length;
  }

  getAdjacentEdges(nodeIndex: number, filter: EdgeFilter): GraphEdge[] {
    const result: GraphEdge[] = [];
    if (nodeIndex !== 0 && this.simpleNodes[nodeIndex - 1] && filter.upNormal)
      result.push(new GraphEdge(nodeIndex - 1, nodeIndex, null, EdgeType.USUAL));
    for (let i = this.nodeToEdgeIndex[nodeIndex]; i < this.nodeToEdgeIndex[nodeIndex + 1]; i++) {
      const adj = this.longEdges[i];
      if (adj < 0) {
        if (filter.special) result.push(GraphEdge.withTargetId(nodeIndex, adj, EdgeType.NOT_LOAD_COMMIT));
        continue;
      }
      if (nodeIndex > adj && filter.upNormal) result.push(new GraphEdge(adj, nodeIndex, null, EdgeType.USUAL));
      if (nodeIndex < adj && filter.downNormal) result.push(new GraphEdge(nodeIndex, adj, null, EdgeType.USUAL));
    }
    if (this.simpleNodes[nodeIndex] && filter.downNormal) result.push(new GraphEdge(nodeIndex, nodeIndex + 1, null, EdgeType.USUAL));
    return result;
  }

  forEachDownNode(nodeIndex: number, handler: (node: number) => void): void {
    for (let i = this.nodeToEdgeIndex[nodeIndex]; i < this.nodeToEdgeIndex[nodeIndex + 1]; i++) {
      const adj = this.longEdges[i];
      if (adj >= 0 && nodeIndex < adj) handler(adj);
    }
    if (this.simpleNodes[nodeIndex]) handler(nodeIndex + 1);
  }

  forEachUpNode(nodeIndex: number, handler: (node: number) => void): void {
    if (nodeIndex !== 0 && this.simpleNodes[nodeIndex - 1]) handler(nodeIndex - 1);
    for (let i = this.nodeToEdgeIndex[nodeIndex]; i < this.nodeToEdgeIndex[nodeIndex + 1]; i++) {
      const adj = this.longEdges[i];
      if (adj >= 0 && nodeIndex > adj) handler(adj);
    }
  }

  /** Parents including not loaded ones (negative ids). */
  forEachParentNode(nodeIndex: number, handler: (node: number) => void): void {
    for (let i = this.nodeToEdgeIndex[nodeIndex]; i < this.nodeToEdgeIndex[nodeIndex + 1]; i++) {
      const adj = this.longEdges[i];
      if (adj < 0 || nodeIndex < adj) handler(adj);
    }
    if (this.simpleNodes[nodeIndex]) handler(nodeIndex + 1);
  }

  getGraphNode(nodeIndex: number): GraphNode {
    return new GraphNode(nodeIndex);
  }

  getNodeId(nodeIndex: number): number {
    return nodeIndex;
  }

  getNodeIndex(nodeId: number): number | null {
    return nodeId >= 0 && nodeId < this.nodesCount() ? nodeId : null;
  }
}
