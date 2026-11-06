import { graphColor, paintGraphRow, type GraphPaintParams, type LaidOutGraph, type PrintElement } from "@gitnut/commons";
import type { GitnutTheme } from "../theme";

/** Lane colours of a theme: the palette override or IntelliJ's colours by head. */
export function laneColors(theme: GitnutTheme): (colorId: number) => string {
  const p = theme.graphPalette;
  if (p?.length) return (id) => p[((id % p.length) + p.length) % p.length];
  const dark = theme.scheme === "dark";
  return (id) => graphColor(id, dark);
}

/** Resolve a CSS colour (also `var()` / `color-mix()` with alpha) composited over `under` to a solid rgb(). */
export function solidColor(el: Element, css: string, under: string): string {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;background:${css}`;
  el.appendChild(probe);
  const top = getComputedStyle(probe).backgroundColor;
  probe.style.background = under;
  const bottom = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!c) return bottom;
  c.fillStyle = bottom;
  c.fillRect(0, 0, 1, 1);
  c.fillStyle = top;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return `rgb(${r} ${g} ${b})`;
}

export interface PaintRowsArgs {
  canvas: HTMLCanvasElement;
  graph: LaidOutGraph;
  first: number;
  last: number;
  /** Scroll offset of the table. */
  scrollTop: number;
  width: number;
  height: number;
  params: Omit<GraphPaintParams, "hoveredElement" | "background" | "dpr">;
  background: (row: number) => string;
  hovered: { row: number; element: PrintElement } | null;
}

/** Paint the visible graph rows onto one canvas covering the viewport (IntelliJ cell painter per row). */
export function paintRows(a: PaintRowsArgs) {
  const dpr = window.devicePixelRatio || 1;
  const { canvas } = a;
  const w = Math.ceil(a.width * dpr);
  const h = Math.ceil(a.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${a.width}px`;
    canvas.style.height = `${a.height}px`;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const rh = a.params.rowHeight;
  for (let row = a.first; row < a.last; row++) {
    const y = row * rh - a.scrollTop;
    if (y + rh < 0 || y > a.height) continue;
    ctx.setTransform(dpr, 0, 0, dpr, 0, Math.round(y * dpr));
    // IntelliJ paints every row in its own cell: diagonal half-edges are drawn twice as long and clipped
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, a.width, rh);
    ctx.clip();
    paintGraphRow(ctx, a.graph.printElements(row), {
      ...a.params,
      dpr,
      background: a.background(row),
      hoveredElement: a.hovered?.row === row ? a.hovered.element : null,
    });
    ctx.restore();
  }
}
