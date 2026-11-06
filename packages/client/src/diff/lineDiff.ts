// Two-level diff like IntelliJ's ComparisonManager: match whole lines first, then diff
// characters only inside each changed block. CodeMirror's default char-level diff over the
// whole document goes crude above ~8000 chars and glues distant edits into one block.
import { Change, presentableDiff } from "@codemirror/merge";

/** Above this many line edits the middle part becomes one block (keeps memory O(D²) bounded). */
const MAX_EDITS = 4000;
/** Blocks larger than this (chars, both sides) get no word-level diff. */
const MAX_WORD_BLOCK = 20_000;

const stripWs = (s: string) => s.replace(/\s+/g, "");

export function lineFirstDiff(a: string, b: string, ignoreWhitespace = false): Change[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const ids = new Map<string, number>();
  const id = (l: string) => {
    const k = ignoreWhitespace ? stripWs(l) : l;
    let v = ids.get(k);
    if (v === undefined) ids.set(k, (v = ids.size));
    return v;
  };
  const startsA = lineStarts(la);
  const startsB = lineStarts(lb);
  const out: Change[] = [];
  for (const [a1, a2, b1, b2] of lineBlocks(la.map(id), lb.map(id))) {
    let fA = startsA[a1], fB = startsB[b1];
    const tA = Math.min(startsA[a2], a.length), tB = Math.min(startsB[b2], b.length);
    // A block after the last line of a side without a final newline starts at that newline
    // ("a\nb" -> "a\nb\nc" inserts "\nc" at 3), so no position lies past the end of the text.
    if (fA > a.length || fB > b.length) fA--, fB--;
    if (a2 === a1 || b2 === b1 || tA - fA + tB - fB > MAX_WORD_BLOCK) {
      out.push(new Change(fA, tA, fB, tB));
      continue;
    }
    const sa = a.slice(fA, tA);
    const sb = b.slice(fB, tB);
    for (const c of presentableDiff(sa, sb, { scanLimit: 5000, timeout: 200 })) {
      if (ignoreWhitespace && !stripWs(sa.slice(c.fromA, c.toA)) && !stripWs(sb.slice(c.fromB, c.toB))) continue;
      out.push(new Change(fA + c.fromA, fA + c.toA, fB + c.fromB, fB + c.toB));
    }
  }
  return out;
}

/** starts[i] = offset of line i; starts[n] = text length + 1 (end of the last line incl. its newline). */
function lineStarts(lines: string[]): number[] {
  const s = [0];
  for (const l of lines) s.push(s[s.length - 1] + l.length + 1);
  return s;
}

/** Changed line blocks [a1, a2, b1, b2) between two id sequences (Myers O(ND)). */
export function lineBlocks(x: number[], y: number[]): [number, number, number, number][] {
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let ea = x.length, eb = y.length;
  while (ea > s && eb > s && x[ea - 1] === y[eb - 1]) ea--, eb--;
  const n = ea - s, m = eb - s;
  if (!n && !m) return [];
  if (!n || !m) return [[s, ea, s, eb]];

  const at = (i: number) => x[s + i];
  const bt = (j: number) => y[s + j];
  const trace: Int32Array[] = [];
  let v = new Int32Array(3); // v[k + d] for k in [-d, d], one slot of slack
  const get = (vv: Int32Array, d: number, k: number) => vv[k + d];
  let end = -1;
  for (let d = 0; d <= n + m; d++) {
    if (d > MAX_EDITS) return [[s, ea, s, eb]];
    const next = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let px: number;
      if (d === 0) px = 0;
      else if (k === -d || (k !== d && get(v, d - 1, k - 1) < get(v, d - 1, k + 1))) px = get(v, d - 1, k + 1);
      else px = get(v, d - 1, k - 1) + 1;
      let py = px - k;
      while (px < n && py < m && at(px) === bt(py)) px++, py++;
      next[k + d] = px;
      if (px >= n && py >= m) end = d;
    }
    trace.push(next);
    v = next;
    if (end >= 0) break;
  }

  // Walk back collecting matched pairs, then turn the gaps between them into blocks.
  const matches: [number, number][] = [];
  let px = n, py = m;
  for (let d = end; d > 0; d--) {
    const prev = trace[d - 1];
    const k = px - py;
    const pk = k === -d || (k !== d && get(prev, d - 1, k - 1) < get(prev, d - 1, k + 1)) ? k + 1 : k - 1;
    const sx = get(prev, d - 1, pk);
    const sy = sx - pk;
    const midX = pk === k + 1 ? sx : sx + 1;
    while (px > midX && py > midX - k) matches.push([--px, --py]);
    px = sx;
    py = sy;
  }
  while (px > 0 && py > 0) matches.push([--px, --py]);
  matches.reverse();

  const blocks: [number, number, number, number][] = [];
  let ca = 0, cb = 0;
  for (const [i, j] of [...matches, [n, m] as [number, number]]) {
    if (i > ca || j > cb) blocks.push([s + ca, s + i, s + cb, s + j]);
    ca = i + 1;
    cb = j + 1;
  }
  return blocks;
}
