/** List selection like IntelliJ tables: click, Ctrl/Cmd+click toggles, Shift+click extends from the anchor. */
export interface ListSelection {
  /** Selected rows. */
  rows: ReadonlySet<number>;
  /** Start of Shift ranges. */
  anchor: number | null;
  /** Row with the keyboard focus. */
  lead: number | null;
}

export const emptySelection: ListSelection = { rows: new Set(), anchor: null, lead: null };

const range = (a: number, b: number) => {
  const out: number[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
  return out;
};

export function clickSelection(sel: ListSelection, row: number, mods: { toggle?: boolean; extend?: boolean }): ListSelection {
  if (mods.extend && sel.anchor !== null) {
    const rows = new Set(mods.toggle ? sel.rows : []);
    for (const r of range(sel.anchor, row)) rows.add(r);
    return { rows, anchor: sel.anchor, lead: row };
  }
  if (mods.toggle) {
    const rows = new Set(sel.rows);
    if (rows.has(row)) rows.delete(row);
    else rows.add(row);
    return { rows, anchor: row, lead: row };
  }
  return { rows: new Set([row]), anchor: row, lead: row };
}

/** Arrow keys: move the lead by `delta` (clamped); Shift extends from the anchor. */
export function moveSelection(sel: ListSelection, delta: number, rowCount: number, extend = false): ListSelection {
  if (!rowCount) return sel;
  const from = sel.lead ?? (delta > 0 ? -1 : rowCount);
  const row = Math.max(0, Math.min(rowCount - 1, from + delta));
  if (extend && sel.anchor !== null) return { rows: new Set(range(sel.anchor, row)), anchor: sel.anchor, lead: row };
  return { rows: new Set([row]), anchor: row, lead: row };
}

/** Map a selection through a row → key function (for storing stable keys). */
export function selectionKeys<K>(sel: ListSelection, keyOf: (row: number) => K): K[] {
  return [...sel.rows].sort((a, b) => a - b).map(keyOf);
}
