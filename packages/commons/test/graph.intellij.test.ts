// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/graph/test/com/intellij/vcs/log/graph/{impl/permanent/
// GraphBuilderTest.kt,impl/permanent/GraphLayoutBuilderTest.java,impl/permanent/GraphLayoutBuilderHeadOrderTest.kt,
// impl/print/EdgesInRowTest.java,impl/print/PrintElementGeneratorTest.kt,linearBek/BekTest.kt,
// impl/DottedFilterEdgesGeneratorTest.kt}, Apache-2.0. Expected outputs are IntelliJ's test data.

import { describe, expect, test } from "bun:test";
import { getHeads, buildGraphLayout } from "../src/graph/graphLayout";
import { EdgeType, getNotNullNodeIndex, GraphNode, isNormalEdge, NodeType, type LinearGraph } from "../src/graph/linearGraph";
import { EdgesInRowGenerator, graphElementComparatorByLayoutIndex, PrintElementGeneratorImpl } from "../src/graph/printElements";
import { createBekMap, findReversedEdge, SortedLinearGraph } from "../src/graph/sort";
import { CollapsedGraph, generateDottedFilterEdges } from "../src/graph/filter";
import {
  asTestGraphString,
  buildFromText,
  dot,
  edgesInRowToStr,
  fixturePair,
  graph,
  linearGraphAsString,
  parseLinearGraph,
  permanentGraphLayoutModelToStr,
  printElementGeneratorAsString,
  unm,
  type NodeSpec,
} from "./graphTestUtils";

describe("R-GRAPH-2: PermanentLinearGraphBuilder (GraphBuilderTest)", () => {
  for (const name of ["simple", "manyNodes", "manyUpNodes", "manyDownNodes", "oneNode", "oneNodeNotFullGraph", "notFullGraph", "parentsOrder", "duplicateParents"]) {
    test(name, () => {
      const [input, out] = fixturePair("graphBuilder", name);
      expect(linearGraphAsString(buildFromText(input, "hash").graph)).toBe(out);
    });
  }
});

describe("R-GRAPH-2: GraphLayoutBuilder (GraphLayoutBuilderTest)", () => {
  for (const name of ["manyNodes", "notFullGraph", "oneNode", "oneNodeNotFullGraph", "headsOrder"]) {
    test(name, () => {
      const [input, out] = fixturePair("layoutBuilder", name);
      const { graph: g, ids } = buildFromText(input);
      const layout = buildGraphLayout(g, (o1, o2) => (ids[o1] < ids[o2] ? -1 : ids[o1] > ids[o2] ? 1 : 0));
      expect(permanentGraphLayoutModelToStr(layout, g.nodesCount())).toBe(out);
    });
  }
});

describe("R-GRAPH-2: GraphLayoutBuilderHeadOrderTest", () => {
  const order = (...list: number[]) => (i: number, j: number) => list.indexOf(i) - list.indexOf(j);
  const headsForCommits = (g: LinearGraph, branchHeads: number[], cmp: (a: number, b: number) => number) => {
    const layout = buildGraphLayout(g, cmp, branchHeads);
    return Array.from({ length: g.nodesCount() }, (_, i) => layout.getOneOfHeadNodeIndex(i));
  };
  test("linearGraph", () => {
    const g = graph([[0, [1]], [1, [2]], [2, [3]], [3]]);
    expect(headsForCommits(g, [0, 2], order(0, 2))).toEqual([0, 0, 0, 0]);
    expect(headsForCommits(g, [0, 2], order(2, 0))).toEqual([0, 0, 2, 2]);
  });
  test("branchingGraph", () => {
    const g = graph([[0, [2]], [1, [3]], [2, [3]], [3, [4]], [4]]);
    expect(headsForCommits(g, [0, 2], order(0, 1, 2))).toEqual([0, 1, 0, 0, 0]);
    expect(headsForCommits(g, [0, 2], order(0, 2, 1))).toEqual([0, 1, 0, 0, 0]);
    expect(headsForCommits(g, [0, 2], order(1, 0, 2))).toEqual([0, 1, 0, 1, 1]);
    expect(headsForCommits(g, [0, 2], order(1, 2, 0))).toEqual([0, 1, 2, 1, 1]);
    expect(headsForCommits(g, [0, 2], order(2, 0, 1))).toEqual([0, 1, 2, 2, 2]);
    expect(headsForCommits(g, [0, 2], order(2, 1, 0))).toEqual([0, 1, 2, 2, 2]);
  });
  test("getHeads", () => {
    expect(getHeads(graph([[0, [2]], [1, [2]], [2]]))).toEqual([0, 1]);
  });
});

describe("R-GRAPH-3: EdgesInRowGenerator (EdgesInRowTest)", () => {
  for (const name of ["simple", "manyNodes", "manyUpNodes", "manyDownNodes", "oneNode", "oneNodeNotFullGraph", "notFullGraph", "longGraph", "notLoadNode"]) {
    test(name, () => {
      const [input, out] = fixturePair("edgesInRow", name);
      const g = parseLinearGraph(input);
      expect(edgesInRowToStr(new EdgesInRowGenerator(g), g.nodesCount())).toBe(out);
    });
  }
});

describe("R-GRAPH-3: PrintElementGeneratorImpl (PrintElementGeneratorTest)", () => {
  const run = (name: string, longEdgeSize = 7, visiblePartSize = 2, edgeWithArrowSize = 10) => {
    const [input, out] = fixturePair("elementGenerator", name);
    const g = parseLinearGraph(input);
    const layout = buildGraphLayout(g, (a, b) => a - b);
    const colorId = (e: import("../src/graph/linearGraph").GraphElement) =>
      e instanceof GraphNode ? e.nodeIndex : isNormalEdge(e) ? e.up + e.down : getNotNullNodeIndex(e);
    const gen = new PrintElementGeneratorImpl(
      g,
      { getColorId: colorId },
      graphElementComparatorByLayoutIndex((i) => layout.getLayoutIndex(i)),
      longEdgeSize,
      visiblePartSize,
      edgeWithArrowSize,
    );
    expect(printElementGeneratorAsString(gen, g.nodesCount())).toBe(out);
  };
  for (const name of ["oneNode", "manyNodes", "longEdges", "specialElements"]) test(name, () => run(name));
  test("oneUpOneDown1", () => run("oneUpOneDown1", 7, 1, 10));
  test("oneUpOneDown2", () => run("oneUpOneDown2", 10, 1, 10));
});

describe("R-GRAPH-2: BekSorter (BekTest)", () => {
  const runBek = (spec: NodeSpec[]) => {
    const before = graph(spec);
    const layout = buildGraphLayout(before, (a, b) => a - b);
    const after = new SortedLinearGraph(createBekMap(before, layout, () => 0), before);
    expect(findReversedEdge(after)).toBeNull();
    return after;
  };
  const check = (before: NodeSpec[], after: NodeSpec[]) => expect(asTestGraphString(runBek(before))).toBe(asTestGraphString(graph(after)));

  test("ea68497", () => {
    const g: NodeSpec[] = [[0, [1, 3]], [1, [4, 2]], [2, [4, 3]], [3], [4]];
    check(g, g);
  });
  test("simpleMerge", () =>
    check([[0, [1, 2]], [1, [3]], [2, [4]], [3, [5]], [4, [5]], [5]], [[0, [1, 2]], [2, [4]], [4, [5]], [1, [3]], [3, [5]], [5]]));
  test("twoHeads", () => check([[0, [2]], [1, [2]], [2]], [[1, [2]], [0, [2]], [2]]));
  test("simpleMergeWithTwoHeads", () =>
    check(
      [[0, [2, 3]], [1, [4]], [2, [4]], [3, [5]], [4, [6]], [5, [6]], [6]],
      [[1, [4]], [0, [2, 3]], [3, [5]], [5, [6]], [2, [4]], [4, [6]], [6]],
    ));
});

describe("R-GRAPH-5: DottedFilterEdgesGenerator (DottedFilterEdgesGeneratorTest)", () => {
  const check = (spec: NodeSpec[], result: NodeSpec[]) => {
    const g = graph(spec);
    let maxId = 0;
    for (let i = 0; i < g.nodesCount(); i++) maxId = Math.max(maxId, g.getNodeId(i));
    const visibility = new Uint8Array(maxId + 1);
    for (let i = 0; i < g.nodesCount(); i++) visibility[g.getNodeId(i)] = g.getGraphNode(i).type === NodeType.USUAL ? 1 : 0;
    const collapsed = new CollapsedGraph(g, visibility);
    generateDottedFilterEdges(collapsed, 0, g.nodesCount() - 1);
    expect(asTestGraphString(collapsed.compiledGraph, true)).toBe(asTestGraphString(graph(result), true));
  };
  test("simple", () => check([[1, [2]], [unm(2), [3]], [3]], [[1, [dot(3)]], [3]]));
  test("simple2Up", () => check([[1, [3]], [2, [3]], [unm(3), [4]], [4]], [[1, [dot(4)]], [2, [dot(4)]], [4]]));
  test("simple2Down", () => check([[1, [2]], [unm(2), [3, 4]], [3], [4]], [[1, [dot(3), dot(4)]], [3], [4]]));
  test("downTree", () =>
    check([[0, [1, 2]], [unm(1), [3, 4]], [unm(2), [4, 5]], [3], [4], [5]], [[0, [dot(3), dot(4), dot(5)]], [3], [4], [5]]));
  test("upTree", () =>
    check([[0, [3]], [1, [3, 4]], [2, [4]], [unm(3), [5]], [unm(4), [5]], [5]], [[0, [dot(5)]], [1, [dot(5)]], [2, [dot(5)]], [5]]));
  test("simpleMerge", () =>
    check([[1, [2, 3]], [2, [4]], [3, [5]], [unm(4), [6]], [unm(5), [6]], [6]], [[1, [2, 3]], [2, [dot(6)]], [3, [dot(6)]], [6]]));
  test("simpleMerge2", () =>
    check([[1, [2, 3]], [unm(2), [4]], [unm(3), [5]], [4, [6]], [5, [6]], [6]], [[1, [dot(4), dot(5)]], [4, [6]], [5, [6]], [6]]));
  test("fork", () =>
    check([[0, [2]], [1, [3]], [2, [3]], [unm(3), [4]], [unm(4), [5]], [5]], [[0, [2]], [1, [dot(5)]], [2, [dot(5)]], [5]]));
  // anotherRoot is @Disabled in IntelliJ ("there has to be a 0-6 dotted edge, but there isn't")
});

test("R-GRAPH-2: edge type ordinals match GraphEdgeType", () => {
  expect([EdgeType.USUAL, EdgeType.DOTTED, EdgeType.NOT_LOAD_COMMIT, EdgeType.DOTTED_ARROW_UP, EdgeType.DOTTED_ARROW_DOWN]).toEqual([0, 1, 2, 3, 4]);
});
