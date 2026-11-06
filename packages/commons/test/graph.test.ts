import { describe, expect, test } from "bun:test";
import {
  buildGraph,
  elementAt,
  graphColor,
  graphColorRgb,
  graphPaintMetrics,
  GRAPH_COLORS_CLASSIC,
  javaStringHashCode,
  naturalCompare,
  paintGraphRow,
  sortHeadsForLayout,
  type EdgeElement,
  type GraphCanvas,
  type PrintElement,
  type RefInfo,
} from "../src";

const ref = (name: string, kind: RefInfo["kind"], commit: number): RefInfo => ({ name, full: name, kind, commit, worktrees: [] });
const edges = (els: PrintElement[]) => els.filter((e): e is EdgeElement => e.type === "edge");
const node = (els: PrintElement[]) => els.find((e) => e.type === "node")!;

/** A first-parent line of `length` commits plus `extra` commits; times descend with the index. */
function line(length: number) {
  const parents: number[][] = Array.from({ length }, (_, i) => (i < length - 1 ? [i + 1] : []));
  return { parents, times: parents.map((_, i) => 1_000_000 - i * 60) };
}

describe("R-GRAPH-2: head order (GitBranchLayoutComparator)", () => {
  test("R-GRAPH-2: origin/main, remotes, main, locals, tags, HEAD; names in natural order", () => {
    const refs = [
      ref("HEAD", "head", 0),
      ref("v1.0", "tag", 1),
      ref("feature-10", "local", 2),
      ref("feature-9", "local", 3),
      ref("main", "local", 4),
      ref("origin/topic", "remote", 5),
      ref("origin/main", "remote", 6),
    ];
    expect(sortHeadsForLayout(refs)).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });
  test("R-GRAPH-2: the best ref of a commit decides its priority", () => {
    expect(sortHeadsForLayout([ref("HEAD", "head", 0), ref("main", "local", 0), ref("dev", "local", 1)])).toEqual([0, 1]);
  });
  test("R-GRAPH-2: NaturalComparator", () => {
    expect(naturalCompare("v1.9", "v1.10")).toBeLessThan(0);
    expect(naturalCompare("Abc", "abd")).toBeLessThan(0);
    expect(naturalCompare("a", "A")).toBeGreaterThan(0); // equal ignoring case, then case-sensitive
    expect(naturalCompare("x01", "x1")).toBeGreaterThan(0);
  });
});

describe("R-GRAPH-2: colours", () => {
  test("R-GRAPH-2: java String.hashCode", () => {
    expect(javaStringHashCode("hello")).toBe(99162322);
    expect(javaStringHashCode("main")).toBe(3343801);
    expect(javaStringHashCode("")).toBe(0);
  });
  test("R-GRAPH-2: DefaultColorGenerator values (HSB with saturation/brightness of the theme)", () => {
    // colorId 1: rangeFix(230)=100, rangeFix(180)=150, rangeFix(190)=160 -> hue of (100,150,160), S=0.4, B=0.65
    expect(graphColorRgb(1, GRAPH_COLORS_CLASSIC)).toBe(0x639ba6);
    expect(graphColor(1, true)).toMatch(/^#[0-9a-f]{6}$/);
    expect(graphColor(0, true)).toBe("#dfe1e5");
    expect(graphColor(-123456789, false)).toMatch(/^#[0-9a-f]{6}$/);
  });
  test("R-GRAPH-2: head fragments are coloured by their ref name, other fragments by layout index", () => {
    // 0 -> 1 -> 2 (main), 3 -> 1 (side branch "dev" forks from 1)
    const g = buildGraph(
      { parents: [[1], [2], [], [1]], times: [4, 3, 1, 2], refs: [ref("main", "local", 0), ref("dev", "local", 3)] },
      { sort: "date" },
    );
    expect(node(g.printElements(g.rowOf(0))).colorId).toBe(javaStringHashCode("main"));
    expect(node(g.printElements(g.rowOf(2))).colorId).toBe(javaStringHashCode("main"));
    expect(node(g.printElements(g.rowOf(3))).colorId).toBe(javaStringHashCode("dev"));
  });
});

describe("R-GRAPH-1/2: layout", () => {
  test("R-GRAPH-1: merge and fork points are drawn with edges between lanes", () => {
    // 0 merge(1, 2); 1 -> 3; 2 -> 3
    const g = buildGraph({ parents: [[1, 2], [3], [3], []], times: [4, 3, 2, 1], heads: [0] }, { sort: "date" });
    expect(g.rowCount).toBe(4);
    const row0 = g.printElements(0);
    expect(edges(row0).map((e) => [e.direction, e.otherPosition])).toEqual([
      ["down", 0],
      ["down", 1],
    ]);
    expect(g.maxPosition(0)).toBe(1);
    expect(g.adjacentRows(0, true)).toEqual([1, 2]);
    expect(g.adjacentRows(3, false)).toEqual([2, 1]); // PermanentLinearGraphImpl order: simple edge first
  });
  test("R-GRAPH-2: IntelliSort puts the merged branch right below its merge commit", () => {
    // date order: 0 merge(1, 2), 1 main, 2 side, 3 main, 4 side, 5 base
    const input = { parents: [[1, 2], [3], [4], [5], [5], []], times: [6, 5, 4, 3, 2, 1], heads: [0] };
    const order = (sort: "intellij" | "date" | "topological") => {
      const g = buildGraph(input, { sort });
      return Array.from({ length: g.rowCount }, (_, r) => g.commitAt(r));
    };
    expect(order("date")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(order("intellij")).toEqual([0, 2, 4, 1, 3, 5]);
    expect(order("topological")).toEqual([0, 2, 4, 1, 3, 5]);
  });
  test("R-GRAPH-1: HEAD commit gets the outline-and-fill node", () => {
    const g = buildGraph({ ...line(3), refs: [ref("HEAD", "head", 0), ref("main", "local", 0)] });
    expect(node(g.printElements(0)).nodeType).toBe("outlineAndFill");
    expect(node(g.printElements(1)).nodeType).toBeUndefined();
  });
  test("R-GRAPH-1: parents missing from the snapshot end in arrows", () => {
    const g = buildGraph({ parents: [[1, 99], [2], []], times: [3, 2, 1], heads: [0] });
    expect(g.rowCount).toBe(3);
    expect(edges(g.printElements(1)).filter((e) => e.terminal)).toEqual([
      { type: "edge", position: 1, otherPosition: 1, direction: "down", style: "solid", colorId: 1, arrow: true, terminal: true },
    ]);
  });
});

describe("R-GRAPH-3: long edges", () => {
  // 0 -> 40 directly, 1..40 a line; the 0->40 edge is 40 rows long
  const parents: number[][] = [[1, 40], ...Array.from({ length: 40 }, (_, i) => (i + 2 <= 40 ? [i + 2] : []))];
  const input = { parents, times: parents.map((_, i) => 1000 - i), heads: [0] };
  test("R-GRAPH-3: long edges become arrows", () => {
    const g = buildGraph(input, { sort: "date" });
    const arrows = (row: number) => edges(g.printElements(row)).filter((e) => e.arrow);
    expect(arrows(1)).toEqual([
      { type: "edge", position: 0, otherPosition: 0, direction: "down", style: "solid", colorId: 1, arrow: true, terminal: true, jumpTo: 40 },
    ]);
    expect(g.maxPosition(20)).toBe(0); // hidden in the middle
    expect(arrows(39).map((e) => [e.direction, e.jumpTo])).toEqual([["up", 0]]);
  });
  test("R-GRAPH-3: show long edges draws them (1000 / 250)", () => {
    const g = buildGraph(input, { sort: "date", showLongEdges: true });
    expect(g.maxPosition(20)).toBe(1);
    expect(edges(g.printElements(1)).some((e) => e.arrow)).toBe(true); // edgeWithArrowSize 30: arrow next to both ends
  });
});

describe("R-GRAPH-5: filtered graph", () => {
  test("R-GRAPH-5: hidden commits are skipped, visible ones stay connected with dashed edges", () => {
    const g = buildGraph({ ...line(5), heads: [0], visible: new Set([0, 2, 4]) });
    expect(g.rowCount).toBe(3);
    expect([g.commitAt(0), g.commitAt(1), g.commitAt(2)]).toEqual([0, 2, 4]);
    expect(g.rowOf(1)).toBe(-1);
    const down = edges(g.printElements(0)).find((e) => e.direction === "down")!;
    expect(down.style).toBe("dashed");
  });
  test("R-GRAPH-5: direct parent-child edges between visible commits stay solid", () => {
    const g = buildGraph({ ...line(4), heads: [0], visible: new Set([0, 1, 3]) });
    expect(edges(g.printElements(0)).find((e) => e.direction === "down")!.style).toBe("solid");
    expect(edges(g.printElements(1)).find((e) => e.direction === "down")!.style).toBe("dashed");
  });
  test("R-GRAPH-5: branch filter shows the commits reachable from the given heads", () => {
    // 0 -> 2, 1 -> 2 -> 3
    const g = buildGraph({ parents: [[2], [2], [3], []], times: [4, 3, 2, 1], heads: [0, 1], visibleHeads: [1] }, { sort: "date" });
    expect(Array.from({ length: g.rowCount }, (_, r) => g.commitAt(r))).toEqual([1, 2, 3]);
  });
});

describe("R-GRAPH-3: painter (SimpleGraphCellPainter)", () => {
  function recorder() {
    const calls: string[] = [];
    const ctx: GraphCanvas = {
      beginPath: () => calls.push("begin"),
      moveTo: (x, y) => calls.push(`M${x},${y}`),
      lineTo: (x, y) => calls.push(`L${x},${y}`),
      arc: (x, y, r) => calls.push(`A${x},${y},${r}`),
      stroke: () => calls.push("stroke"),
      fill: () => calls.push("fill"),
      setLineDash: (d) => calls.push(`dash[${d.join(",")}]`),
      save: () => {},
      restore: () => {},
      lineDashOffset: 0,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
    };
    return { ctx, calls };
  }
  const params = { rowHeight: 22, colors: () => "#fff" };

  test("R-GRAPH-3: a CanvasRenderingContext2D is a GraphCanvas", () => {
    const accepts = (ctx: GraphCanvas) => ctx;
    expect(typeof accepts).toBe("function");
    if (false as boolean) accepts(null as unknown as CanvasRenderingContext2D); // compile-time check
  });

  test("R-GRAPH-3: IntelliJ geometry at row height 22", () => {
    const m = graphPaintMetrics(params);
    expect([m.elementWidth, m.elementCenter, m.rowCenter, m.lineThickness, m.selectedLineThickness, m.circleDiameter, m.circleRadius]).toEqual([
      15, 8, 11, 1, 3, 7, 3,
    ]);
    expect(graphPaintMetrics({ ...params, dpr: 2 }).lineThickness).toBe(1.5);
  });
  test("R-GRAPH-3: half edges go to the row border, diagonal ones to the neighbour row centre", () => {
    const { ctx, calls } = recorder();
    paintGraphRow(
      ctx,
      [
        { type: "edge", position: 0, otherPosition: 0, direction: "down", style: "solid", colorId: 1, arrow: false },
        { type: "edge", position: 0, otherPosition: 1, direction: "up", style: "dashed", colorId: 1, arrow: false },
        { type: "node", position: 0, colorId: 1 },
      ],
      params,
    );
    expect(calls).toEqual([
      "dash[]", "begin", "M8.5,11.5", "L8.5,22.5", "stroke",
      `dash[${Math.hypot(15, 22) - 9},9]`, "begin", "M8.5,11.5", "L23.5,-10.5", "stroke",
      "begin", "A8.5,11.5,3.5", "fill",
    ]);
  });
  test("R-GRAPH-3: hovered element is painted twice, thicker in the mark colour first", () => {
    const { ctx, calls } = recorder();
    const n: PrintElement = { type: "node", position: 0, colorId: 1 };
    paintGraphRow(ctx, [n], { ...params, hoveredElement: { ...n } });
    expect(calls.filter((c) => c.startsWith("A"))).toEqual(["A8.5,11.5,4.5", "A8.5,11.5,3.5"]);
  });
  test("R-GRAPH-3: elementAt finds nodes first, then edges", () => {
    const els: PrintElement[] = [
      { type: "edge", position: 0, otherPosition: 1, direction: "down", style: "solid", colorId: 1, arrow: false },
      { type: "node", position: 0, colorId: 1 },
    ];
    expect(elementAt(els, 8, 11, params)?.type).toBe("node");
    expect(elementAt(els, 15, 22, params)?.type).toBe("edge");
    expect(elementAt(els, 40, 2, params)).toBeNull();
  });
});
