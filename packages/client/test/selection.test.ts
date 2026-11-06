import { expect, test } from "bun:test";
import { clickSelection, emptySelection, moveSelection } from "../src/selection";

const rows = (s: { rows: ReadonlySet<number> }) => [...s.rows].sort((a, b) => a - b);

test("R-DIFF-1: click, Ctrl+click toggles (non-adjacent), Shift+click extends from the anchor", () => {
  let s = clickSelection(emptySelection, 2, {});
  expect(rows(s)).toEqual([2]);
  s = clickSelection(s, 7, { toggle: true });
  expect(rows(s)).toEqual([2, 7]);
  s = clickSelection(s, 2, { toggle: true });
  expect(rows(s)).toEqual([7]);
  s = clickSelection(s, 4, { extend: true });
  expect(rows(s)).toEqual([2, 3, 4]); // the Ctrl+click on 2 moved the anchor there
  s = clickSelection(clickSelection(s, 10, { toggle: true }), 12, { toggle: true, extend: true });
  expect(rows(s)).toEqual([2, 3, 4, 10, 11, 12]);
});

test("arrow keys move the lead, Shift+arrow extends, clamped to the list", () => {
  let s = moveSelection(emptySelection, 1, 5);
  expect(rows(s)).toEqual([0]);
  s = moveSelection(s, 1, 5, true);
  s = moveSelection(s, 1, 5, true);
  expect(rows(s)).toEqual([0, 1, 2]);
  s = moveSelection(s, 10, 5);
  expect(rows(s)).toEqual([4]);
  s = moveSelection(s, -10, 5);
  expect(rows(s)).toEqual([0]);
});
