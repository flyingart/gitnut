// Ported from IntelliJ IDEA Community Edition: platform/vcs-log/impl/src/com/intellij/vcs/log/paint/
// {SimpleGraphCellPainter.kt,HeadNodePainter.kt,PaintParameters.java}, platform/util/ui/src/com/intellij/ui/paint/PaintUtil.java
// (alignToInt), Apache-2.0.

import type { EdgeElement, NodeElement, PrintElement } from "./types";

/** The subset of CanvasRenderingContext2D the painter uses. */
export interface GraphCanvas {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
  setLineDash(segments: number[]): void;
  save(): void;
  restore(): void;
  lineDashOffset: number;
  strokeStyle: unknown;
  fillStyle: unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
}

export interface GraphPaintParams {
  /** Row height in CSS pixels (IntelliJ ROW_HEIGHT 22 is the reference for all scaled values). */
  rowHeight: number;
  /** CSS colour of a colour id, e.g. `(id) => graphColor(id, dark)`. */
  colors: (colorId: number) => string;
  /** Element (lane) width; default PaintParameters.getElementWidth: 16 * rowHeight / 22. */
  laneWidth?: number;
  /** Default 1.5 * rowHeight / 22. */
  lineThickness?: number;
  /** Line thickness of the hovered element; default 2.5 * rowHeight / 22. */
  selectedLineThickness?: number;
  /** Default PaintParameters.CIRCLE_RADIUS: 4 * rowHeight / 22. */
  nodeRadius?: number;
  /** Device pixel ratio (ScaleContext). Default 1. */
  dpr?: number;
  /** The element under the mouse in this row (from elementAt), painted "selected" like IntelliJ. Pass it for its row only. */
  hoveredElement?: PrintElement | null;
  /** Row background (commitStyle.background), used for the ring of the HEAD node. */
  background?: string;
  /** MARK_COLOR (JBColor.BLACK) behind selected elements. Default black; use the foreground colour in dark themes. */
  markColor?: string;
  /** NEUTRAL_COLOR (JBColor.GRAY) for outline nodes. */
  neutralColor?: string;
}

const WIDTH_NODE = 16;
const CIRCLE_RADIUS = 4;
const THICK_LINE = 1.5;
const SELECT_THICK_LINE = 2.5;
const ROW_HEIGHT = 22;
const RADIUS_DELTA = 2;
const ARROW_ANGLE_COS2 = 0.7;
const ARROW_LENGTH = 0.3;

const scaleWithRowHeight = (value: number, rowHeight: number) => (value * rowHeight) / ROW_HEIGHT;

type Rounding = "floor" | "ceil" | "round";
const round = (v: number, rm: Rounding) => (rm === "floor" ? Math.floor(v) : rm === "ceil" ? Math.ceil(v) : Math.floor(v + 0.5));

/** PaintUtil.alignToInt: align a user-space value to an integer device value, optionally odd/even. */
export function alignToInt(usrValue: number, scale: number, rm: Rounding = "round", pm: "odd" | "even" | null = null): number {
  if (scale === 0) return 0;
  let dev = round(usrValue * scale, pm != null && rm === "round" ? "floor" : rm);
  if (pm != null && (dev % 2 === 0 ? "even" : "odd") !== pm) dev += rm === "floor" ? -1 : 1;
  return dev / scale;
}

export interface GraphPaintMetrics {
  pixel: number;
  rowHeight: number;
  rowCenter: number;
  elementWidth: number;
  elementCenter: number;
  lineThickness: number;
  selectedLineThickness: number;
  circleDiameter: number;
  selectedCircleDiameter: number;
  circleRadius: number;
  selectedCircleRadius: number;
  outerCircleDiameter: number;
  outerCircleRadius: number;
  selectedOuterCircleDiameter: number;
  selectedOuterCircleRadius: number;
  headDelta: number;
}

/** SimpleGraphCellPainter.MyPainter + HeadNodePainter sizes. Graph column width = (lanes) * elementWidth. */
export function graphPaintMetrics(p: GraphPaintParams): GraphPaintMetrics {
  const s = p.dpr ?? 1;
  const rh = p.rowHeight;
  const width = p.laneWidth ?? scaleWithRowHeight(WIDTH_NODE, rh);
  const radius = p.nodeRadius ?? scaleWithRowHeight(CIRCLE_RADIUS, rh);
  const pixel = 1 / s;
  const lineThickness = Math.max(alignToInt(p.lineThickness ?? scaleWithRowHeight(THICK_LINE, rh), s, "floor", "odd"), pixel);
  const selectedLineThickness = Math.max(
    alignToInt(p.selectedLineThickness ?? scaleWithRowHeight(SELECT_THICK_LINE, rh), s, "floor", "odd"),
    lineThickness + 2 * pixel,
  );
  const circleDiameter = alignToInt(2 * radius, s, "floor", "odd");
  const selectedCircleDiameter = circleDiameter + selectedLineThickness - lineThickness;
  const outerCircleDiameter = alignToInt(2 * (radius + scaleWithRowHeight(RADIUS_DELTA, rh)), s, "floor", "odd");
  const selectedOuterCircleDiameter = outerCircleDiameter + selectedLineThickness - lineThickness;
  return {
    pixel,
    rowHeight: rh,
    rowCenter: alignToInt(rh / 2, s, "floor", "odd"),
    elementWidth: alignToInt(width, s, "floor", "odd"),
    elementCenter: alignToInt(width / 2, s, "floor"),
    lineThickness,
    selectedLineThickness,
    circleDiameter,
    selectedCircleDiameter,
    circleRadius: alignToInt(circleDiameter / 2, s, "floor"),
    selectedCircleRadius: alignToInt(selectedCircleDiameter / 2, s, "floor"),
    outerCircleDiameter,
    outerCircleRadius: alignToInt(outerCircleDiameter / 2, s, "floor"),
    selectedOuterCircleDiameter,
    selectedOuterCircleRadius: alignToInt(selectedOuterCircleDiameter / 2, s, "floor"),
    headDelta: alignToInt(scaleWithRowHeight(RADIUS_DELTA, rh), s, "floor"),
  };
}

/** IntelliJ print element equality (EdgePrintElementImpl/SimplePrintElementImpl.equals) within one row. */
export function sameElement(a: PrintElement | null | undefined, b: PrintElement | null | undefined): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.position !== b.position) return false;
  if (a.type === "node") return true;
  const e = b as EdgeElement;
  return a.otherPosition === e.otherPosition && a.direction === e.direction && a.arrow === e.arrow;
}

function rotate(x: number, y: number, centerX: number, centerY: number, cos: number, sin: number, arrowLength: number): [number, number] {
  const tx = x - centerX;
  const ty = y - centerY;
  const d = Math.hypot(tx, ty);
  const sx = (arrowLength * tx) / d;
  const sy = (arrowLength * ty) / d;
  return [sx * cos - sy * sin + centerX, sx * sin + sy * cos + centerY];
}

function getDashLength(edgeLength: number, rowHeight: number): [number, number] {
  // A vertical edge is rowHeight long: exactly one dash and one space fit. Other edges keep the space and stretch the dash
  // so that a whole number of dashes fits.
  const dashCount = Math.max(1, Math.floor(edgeLength / rowHeight));
  const spaceLength = rowHeight / 2 - 2;
  return [edgeLength / dashCount - spaceLength, spaceLength];
}

/** Paints one row of the graph at (0, 0)..(width, rowHeight), like SimpleGraphCellPainter.paint. */
export function paintGraphRow(ctx: GraphCanvas, elements: readonly PrintElement[], params: GraphPaintParams): void {
  const m = graphPaintMetrics(params);
  const rowHeight = params.rowHeight;
  const markColor = params.markColor ?? "#000000";
  const neutralColor = params.neutralColor ?? "#808080";

  const paintLine = (
    x1: number, y1: number, x2: number, y2: number, startArrowX: number, startArrowY: number,
    hasArrow: boolean, isUsual: boolean, isSelected: boolean,
  ) => {
    ctx.lineWidth = isSelected ? m.selectedLineThickness : m.lineThickness;
    if (isUsual || hasArrow) ctx.setLineDash([]);
    else {
      const edgeLength = x1 === x2 ? rowHeight : Math.hypot(x1 - x2, y1 - y2);
      const dash = getDashLength(edgeLength, rowHeight);
      ctx.setLineDash(dash);
      ctx.lineDashOffset = dash[0] / 2;
    }
    // Java2D normalizes strokes to pixel centres (fills are not), IntelliJ puts line centres on whole device pixels
    const o = m.pixel / 2;
    ctx.beginPath();
    ctx.moveTo(x1 + o, y1 + o);
    ctx.lineTo(x2 + o, y2 + o);
    if (hasArrow) {
      const cos = Math.sqrt(ARROW_ANGLE_COS2);
      const sin = Math.sqrt(1 - ARROW_ANGLE_COS2);
      const [ax1, ay1] = rotate(x1, y1, startArrowX, startArrowY, cos, sin, ARROW_LENGTH * rowHeight);
      const [ax2, ay2] = rotate(x1, y1, startArrowX, startArrowY, cos, -sin, ARROW_LENGTH * rowHeight);
      ctx.moveTo(startArrowX + o, startArrowY + o);
      ctx.lineTo(ax1 + o, ay1 + o);
      ctx.moveTo(startArrowX + o, startArrowY + o);
      ctx.lineTo(ax2 + o, ay2 + o);
    }
    ctx.stroke();
  };

  const paintEdge = (edge: EdgeElement, isSelected: boolean) => {
    const isDown = edge.direction === "down";
    const isUsual = edge.style === "solid";
    const x1 = m.elementWidth * edge.position + m.elementCenter;
    const y1 = m.rowCenter;
    if (edge.position === edge.otherPosition) {
      const arrowGap = edge.terminal ? m.circleRadius / 2 + 1 : 0;
      const y2 = isDown ? rowHeight - arrowGap : arrowGap;
      paintLine(x1, y1, x1, y2, x1, y2, edge.arrow, isUsual, isSelected);
    } else {
      // paint non-vertical lines twice the size to make them dock with each other well
      const x2 = m.elementWidth * edge.otherPosition + m.elementCenter;
      const y2 = isDown ? rowHeight + m.rowCenter : m.rowCenter - rowHeight;
      paintLine(x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2, edge.arrow, isUsual, isSelected);
    }
  };

  const fillCircle = (x: number, y: number, diameter: number) => {
    ctx.beginPath();
    ctx.arc(x + diameter / 2, y + diameter / 2, diameter / 2, 0, 2 * Math.PI);
    ctx.fill();
  };

  const paintHeadNode = (x0: number, y0: number, isSelected: boolean, color: string) => {
    if (isSelected) {
      fillCircle(x0 - m.selectedOuterCircleRadius, y0 - m.selectedOuterCircleRadius, m.selectedOuterCircleDiameter);
      return;
    }
    let x = x0 - m.outerCircleRadius;
    let y = y0 - m.outerCircleRadius;
    let d = m.outerCircleDiameter;
    fillCircle(x, y, d); // outer circle
    x += m.headDelta;
    y += m.headDelta;
    d -= 2 * m.headDelta;
    ctx.fillStyle = params.background ?? "#ffffff";
    fillCircle(x, y, d); // middle circle
    x += m.headDelta;
    y += m.headDelta;
    d -= 2 * m.headDelta;
    ctx.fillStyle = color;
    fillCircle(x, y, d); // inner circle
  };

  const paintCircle = (node: NodeElement, isSelected: boolean, color: string) => {
    const x0 = m.elementWidth * node.position + m.elementCenter;
    const y0 = m.rowCenter;
    const r = isSelected ? m.selectedCircleRadius : m.circleRadius;
    const d = isSelected ? m.selectedCircleDiameter : m.circleDiameter;
    switch (node.nodeType ?? "fill") {
      case "fill":
        fillCircle(x0 - r, y0 - r, d);
        break;
      case "outlineAndFill":
        paintHeadNode(x0, y0, isSelected, color);
        break;
      case "outline":
        ctx.strokeStyle = neutralColor;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x0 - r + d / 2, y0 - r + d / 2, d / 2, 0, 2 * Math.PI);
        ctx.stroke();
    }
  };

  const paintElement = (el: PrintElement, color: string, isSelected: boolean) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (el.type === "edge") paintEdge(el, isSelected);
    else paintCircle(el, isSelected, color);
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const selected: PrintElement[] = [];
  for (const el of elements) {
    if (sameElement(el, params.hoveredElement)) selected.push(el); // to draw later
    else paintElement(el, params.colors(el.colorId), false);
  }
  for (const el of selected) paintElement(el, markColor, true);
  for (const el of selected) paintElement(el, params.colors(el.colorId), false);
  ctx.restore();
}

/** SimpleGraphCellPainter.getElementUnderCursor: x, y relative to the row cell. Nodes win over edges. */
export function elementAt(elements: readonly PrintElement[], x: number, y: number, params: GraphPaintParams): PrintElement | null {
  const m = graphPaintMetrics(params);
  for (const el of elements) {
    if (el.type !== "node") continue;
    const x0 = m.elementWidth * el.position + m.elementCenter;
    if (Math.hypot(x0 - x, m.rowCenter - y) <= m.circleRadius) return el;
  }
  for (const el of elements) {
    if (el.type !== "edge") continue;
    const x1 = m.elementWidth * el.position + m.elementCenter;
    const y1 = m.rowCenter;
    const x2 = m.elementWidth * el.otherPosition + m.elementCenter;
    const y2 = el.direction === "down" ? params.rowHeight + m.rowCenter : m.rowCenter - params.rowHeight;
    if (Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x, y2 - y) < Math.hypot(x1 - x2, y1 - y2) + m.lineThickness) return el;
  }
  return null;
}
