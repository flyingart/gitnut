// Two independent read-only editors like IntelliJ's two-side diff: no alignment spacers, changed ranges joined by
// curved connector bands in the gap (DiffDividerDrawUtil), scrolling kept in sync through the chunk mapping
// (SyncScrollSupport.TwosidesSyncScrollSupport).
import { Compartment, EditorState, RangeSetBuilder, Text, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { Chunk, type DiffConfig } from "@codemirror/merge";

export type ChunkKind = "inserted" | "deleted" | "modified";

export interface SideBySideOptions {
  a: string;
  b: string;
  extensions: Extension[];
  diffConfig: DiffConfig;
  highlightWords: boolean;
  collapseUnchanged: boolean;
  /** Called with the index of the current chunk after navigation. */
  onCurrent?: (index: number) => void;
}

const MARGIN = 3;
const MIN_COLLAPSE = 4;
const GAP = 36;
const SVG = "http://www.w3.org/2000/svg";

export const chunkKind = (c: Chunk): ChunkKind => (c.fromA === c.toA ? "inserted" : c.fromB === c.toB ? "deleted" : "modified");

/** Line range [from, to) (1-based) of a chunk side; empty sides give from === to (the line below the gap). */
function lineRange(doc: Text, from: number, to: number): [number, number] {
  if (from === to) return from > doc.length ? [doc.lines + 1, doc.lines + 1] : [doc.lineAt(from).number, doc.lineAt(from).number];
  return [doc.lineAt(from).number, doc.lineAt(Math.min(doc.length, to - 1)).number + 1];
}

class FoldWidget extends WidgetType {
  constructor(
    readonly lines: number,
    readonly onExpand: () => void,
  ) {
    super();
  }
  eq(o: FoldWidget) {
    return o.lines === this.lines;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "gitnut-diff-fold";
    el.textContent = `${this.lines} unchanged lines`;
    el.title = "Show unchanged lines";
    el.onmousedown = (e) => {
      e.preventDefault();
      this.onExpand();
    };
    return el;
  }
  ignoreEvent() {
    return false;
  }
  get estimatedHeight() {
    return 22;
  }
}

export class SideBySideDiff {
  readonly dom: HTMLDivElement;
  readonly a: EditorView;
  readonly b: EditorView;
  readonly chunks: readonly Chunk[];
  private svg: SVGSVGElement;
  private deco = new Compartment();
  private expanded = new Set<number>();
  private expected = new Map<EditorView, number>();
  private raf = 0;
  private ro: ResizeObserver;
  /** Pairs of line numbers that align (chunk borders), for scroll mapping. */
  private anchors: [number, number][] = [];
  current = -1;

  constructor(
    parent: HTMLElement,
    private opts: SideBySideOptions,
  ) {
    const docA = Text.of(opts.a.split("\n"));
    const docB = Text.of(opts.b.split("\n"));
    this.chunks = Chunk.build(docA, docB, opts.diffConfig);
    this.anchors = [[1, 1]];
    for (const c of this.chunks) {
      const [a1, a2] = lineRange(docA, c.fromA, c.toA);
      const [b1, b2] = lineRange(docB, c.fromB, c.toB);
      this.anchors.push([a1, b1], [a2, b2]);
    }
    this.anchors.push([docA.lines + 1, docB.lines + 1]);

    this.dom = document.createElement("div");
    this.dom.className = "gitnut-sbs";
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    paneA.className = paneB.className = "gitnut-sbs-pane";
    this.svg = document.createElementNS(SVG, "svg");
    this.svg.classList.add("gitnut-sbs-connectors");
    this.svg.setAttribute("aria-hidden", "true");
    this.dom.append(paneA, this.svg, paneB);
    parent.appendChild(this.dom);

    const listener = EditorView.updateListener.of((u) => {
      if (u.geometryChanged || u.heightChanged || u.viewportChanged) this.schedule();
    });
    const make = (doc: Text, side: "a" | "b", pane: HTMLElement) =>
      new EditorView({
        parent: pane,
        state: EditorState.create({ doc, extensions: [opts.extensions, this.deco.of(EditorView.decorations.of(this.decorations(doc, side))), listener] }),
      });
    this.a = make(docA, "a", paneA);
    this.b = make(docB, "b", paneB);
    for (const [from, to] of [
      [this.a, this.b],
      [this.b, this.a],
    ] as const) {
      from.scrollDOM.addEventListener("scroll", () => this.onScroll(from, to), { passive: true });
    }
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(this.dom);
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.a.destroy();
    this.b.destroy();
    this.dom.remove();
  }

  /** Unchanged line regions [fromA, toA, fromB] (1-based, end exclusive) that are long enough to fold. */
  private foldRegions(): { a1: number; a2: number; b1: number }[] {
    const out: { a1: number; a2: number; b1: number }[] = [];
    for (let i = 0; i + 1 < this.anchors.length; i += 2) {
      const [a1, b1] = this.anchors[i];
      const [a2] = this.anchors[i + 1];
      const first = i === 0;
      const last = i + 2 >= this.anchors.length;
      const s = a1 + (first ? 0 : MARGIN);
      const e = a2 - (last ? 0 : MARGIN);
      if (e - s >= MIN_COLLAPSE) out.push({ a1: s, a2: e, b1: b1 + (s - a1) });
    }
    return out;
  }

  private decorations(doc: Text, side: "a" | "b"): DecorationSet {
    const isA = side === "a";
    const marks: { from: number; to: number; deco: Decoration }[] = [];
    for (const c of this.chunks) {
      const kind = chunkKind(c);
      const from = isA ? c.fromA : c.fromB;
      const to = isA ? c.toA : c.toB;
      if (from === to) {
        // the other side has lines here: IntelliJ draws a thin line at the gap
        const pos = Math.min(from, doc.length);
        const cls = from > doc.length ? "gitnut-diff-gap-after" : "gitnut-diff-gap-before";
        marks.push({ from: doc.lineAt(pos).from, to: doc.lineAt(pos).from, deco: Decoration.line({ class: `${cls} gitnut-diff-${kind}` }) });
        continue;
      }
      const [l1, l2] = lineRange(doc, from, to);
      for (let l = l1; l < l2; l++) {
        const line = doc.line(l);
        marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `gitnut-diff-line gitnut-diff-${kind}` }) });
      }
      if (this.opts.highlightWords && kind === "modified") {
        for (const ch of c.changes) {
          const s = from + (isA ? ch.fromA : ch.fromB);
          const e = from + (isA ? ch.toA : ch.toB);
          if (e > s) marks.push({ from: s, to: Math.min(e, doc.length), deco: Decoration.mark({ class: `gitnut-diff-word gitnut-diff-word-${isA ? "deleted" : "inserted"}` }) });
        }
      }
    }
    if (this.opts.collapseUnchanged && this.chunks.length) {
      this.foldRegions().forEach((r, i) => {
        if (this.expanded.has(i)) return;
        const l1 = isA ? r.a1 : r.b1;
        const l2 = l1 + (r.a2 - r.a1);
        const from = doc.line(l1).from;
        const to = doc.line(Math.min(doc.lines, l2 - 1)).to;
        marks.push({ from, to, deco: Decoration.replace({ block: true, widget: new FoldWidget(r.a2 - r.a1, () => this.expand(i)) }) });
      });
    }
    // RangeSetBuilder needs sorted input: by from, line decorations first, then by start side
    marks.sort((x, y) => x.from - y.from || side_(x.deco) - side_(y.deco) || x.to - y.to);
    const b = new RangeSetBuilder<Decoration>();
    for (const m of marks) b.add(m.from, m.to, m.deco);
    return b.finish();
  }

  private expand(i: number) {
    this.expanded.add(i);
    this.a.dispatch({ effects: this.deco.reconfigure(EditorView.decorations.of(this.decorations(this.a.state.doc, "a"))) });
    this.b.dispatch({ effects: this.deco.reconfigure(EditorView.decorations.of(this.decorations(this.b.state.doc, "b"))) });
  }

  private docTop(v: EditorView) {
    return v.documentTop - v.scrollDOM.getBoundingClientRect().top + v.scrollDOM.scrollTop;
  }

  /** y (document coordinates) of the top of a 1-based line; past the end = bottom of the doc. */
  private lineY(v: EditorView, line: number): number {
    const doc = v.state.doc;
    if (line > doc.lines) return v.lineBlockAt(doc.length).bottom;
    return v.lineBlockAt(doc.line(Math.max(1, line)).from).top;
  }

  /** Map a fractional line of one side to the other through the anchors (piecewise linear). */
  private mapLine(line: number, fromA: boolean): number {
    const k = fromA ? 0 : 1;
    const anchors = this.anchors;
    let i = 0;
    while (i + 1 < anchors.length && anchors[i + 1][k] <= line) i++;
    const [p, q] = [anchors[i], anchors[Math.min(i + 1, anchors.length - 1)]];
    const span = q[k] - p[k];
    const t = span > 0 ? (line - p[k]) / span : 0;
    return p[1 - k] + t * (q[1 - k] - p[1 - k]);
  }

  private onScroll(from: EditorView, to: EditorView) {
    const exp = this.expected.get(from);
    if (exp !== undefined && Math.abs(exp - from.scrollDOM.scrollTop) < 1) {
      this.expected.delete(from);
      this.schedule();
      return;
    }
    this.syncFrom(from, to);
    this.schedule();
  }

  private syncFrom(from: EditorView, to: EditorView) {
    const h = from.scrollDOM.clientHeight;
    const center = from.scrollDOM.scrollTop + h / 2 - this.docTop(from);
    const block = from.lineBlockAtHeight(Math.max(0, center));
    const lineNo = from.state.doc.lineAt(block.from).number;
    const frac = block.height > 0 ? Math.min(1, Math.max(0, (center - block.top) / block.height)) : 0;
    const target = this.mapLine(lineNo + frac, from === this.a);
    const tl = Math.floor(target);
    const y0 = this.lineY(to, tl);
    const y1 = this.lineY(to, tl + 1);
    const y = y0 + (target - tl) * (y1 - y0) + this.docTop(to);
    const max = to.scrollDOM.scrollHeight - to.scrollDOM.clientHeight;
    const top = Math.max(0, Math.min(max, Math.round(y - to.scrollDOM.clientHeight / 2)));
    if (Math.abs(top - to.scrollDOM.scrollTop) >= 1) {
      this.expected.set(to, top);
      to.scrollDOM.scrollTop = top;
    }
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => ((this.raf = 0), this.drawConnectors()));
  }

  private drawConnectors() {
    const h = this.dom.clientHeight;
    const offA = this.docTop(this.a) - this.a.scrollDOM.scrollTop;
    const offB = this.docTop(this.b) - this.b.scrollDOM.scrollTop;
    const docA = this.a.state.doc;
    const docB = this.b.state.doc;
    const parts: string[] = [];
    this.chunks.forEach((c, i) => {
      const [a1, a2] = lineRange(docA, c.fromA, c.toA);
      const [b1, b2] = lineRange(docB, c.fromB, c.toB);
      const ya1 = this.lineY(this.a, a1) + offA;
      const ya2 = (a1 === a2 ? ya1 : this.lineY(this.a, a2)) + (a1 === a2 ? 0 : offA);
      const yb1 = this.lineY(this.b, b1) + offB;
      const yb2 = (b1 === b2 ? yb1 : this.lineY(this.b, b2)) + (b1 === b2 ? 0 : offB);
      if (Math.max(ya2, yb2) < 0 || Math.min(ya1, yb1) > h) return;
      const m = GAP / 2;
      const d = `M0 ${ya1} C${m} ${ya1} ${m} ${yb1} ${GAP} ${yb1} L${GAP} ${yb2} C${m} ${yb2} ${m} ${ya2} 0 ${ya2} Z`;
      parts.push(`<path class="gitnut-connector gitnut-connector-${chunkKind(c)}${i === this.current ? " gitnut-current" : ""}" d="${d}"/>`);
    });
    this.svg.innerHTML = parts.join("");
  }

  /** Scroll to a chunk (centred in the left editor, right side follows). */
  goTo(index: number) {
    if (index < 0 || index >= this.chunks.length) return;
    this.current = index;
    const c = this.chunks[index];
    const [l1] = lineRange(this.a.state.doc, c.fromA, c.toA);
    // unfold a collapsed region that hides the chunk start: chunks are never folded, only their surroundings
    const y = this.lineY(this.a, l1) + this.docTop(this.a);
    const top = Math.max(0, y - this.a.scrollDOM.clientHeight / 3);
    this.a.scrollDOM.scrollTop = top;
    this.syncFrom(this.a, this.b);
    this.expected.set(this.a, this.a.scrollDOM.scrollTop);
    this.schedule();
    this.opts.onCurrent?.(index);
  }

  /** Next chunk; false when already at the last one. */
  next(): boolean {
    if (this.current + 1 >= this.chunks.length) return false;
    this.goTo(this.current + 1);
    return true;
  }

  prev(): boolean {
    if (this.current <= 0) return false;
    this.goTo(this.current - 1);
    return true;
  }
}

const side_ = (d: Decoration) => ((d as any).startSide as number) ?? 0;
