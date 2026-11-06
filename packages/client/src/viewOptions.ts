import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SortType } from "@gitnut/commons";

export type CommitColumn = "author" | "date" | "hash";

/** Matters of taste, remembered in localStorage (R-LIST-2). */
export interface ViewOptions {
  /** Changes tree nested by folder, or a flat list. */
  changesMode: "tree" | "flat";
  /** Projects list grouped by server, or flat (T3 style). */
  projectsGrouping: "server" | "flat";
  /** Projects order: by name, or repos with changes first. */
  projectsSort: "name" | "dirty";
  /** Graph sort (IntelliJ "IntelliSort" / topological / date). */
  graphSort: SortType;
  showLongEdges: boolean;
  /** Visible commit table columns (the subject is always shown). */
  columns: CommitColumn[];
  diffMode: "side-by-side" | "unified";
  ignoreWhitespace: boolean;
  /** Collapse unchanged regions in diffs. */
  collapseUnchanged: boolean;
  /** Word-level highlights inside changed lines. */
  highlightWords: boolean;
  /** Log tab: diff preview pane below the log, or off (Enter / Ctrl+D still open the large diff). */
  diffPreview: "bottom" | "off";
  /** Log tab: branches panel visible. */
  showRefs: boolean;
  /** Splitter sizes by id (px or fraction). */
  panelSizes: Record<string, number>;
  /** Worktree keys hidden from the combined local changes view. */
  combinedExclude: string[];
  /** Colour scheme of the full app (GitnutApp without a `theme` prop). */
  scheme: "dark" | "light";
  /** Accent preset name (see ACCENTS) or a CSS colour. */
  accent: string;
  /** Full app: keep several views open as tabs. Off = the projects sidebar switches one view. */
  showTabs: boolean;
}

const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  changesMode: "tree",
  projectsGrouping: "server",
  projectsSort: "name",
  graphSort: "intellij",
  showLongEdges: false,
  columns: ["author", "date", "hash"],
  diffMode: "side-by-side",
  ignoreWhitespace: false,
  collapseUnchanged: true,
  highlightWords: true,
  diffPreview: "bottom",
  showRefs: true,
  panelSizes: {},
  combinedExclude: [],
  scheme: "dark",
  accent: "coconut",
  showTabs: false,
};

let storageKey = "gitnut.viewOptions";
let current: ViewOptions = load();
const listeners = new Set<() => void>();

function load(): ViewOptions {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
    return { ...DEFAULT_VIEW_OPTIONS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_VIEW_OPTIONS };
  }
}

/** Change the localStorage key (call before rendering). Reloads the options. */
export function setViewOptionsStorageKey(key: string) {
  storageKey = key;
  current = load();
  emit();
}

function emit() {
  for (const fn of [...listeners]) fn();
}

export function getViewOptions(): ViewOptions {
  return current;
}

/** Update and persist options. */
export function setViewOptions(patch: Partial<ViewOptions>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(storageKey, JSON.stringify(current));
  } catch {}
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === storageKey) {
      current = load();
      emit();
    }
  });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/**
 * Shared, persisted view options. Values given in `fixed` (usually component props) win and are
 * reported as locked so the component hides their toggle (R-SDK-4).
 */
export function useViewOptions(fixed: Partial<ViewOptions> = {}) {
  const stored = useSyncExternalStore(subscribe, getViewOptions, getViewOptions);
  const fixedKey = JSON.stringify(fixed);
  const options = useMemo(() => {
    const out = { ...stored };
    for (const [k, v] of Object.entries(fixed)) if (v !== undefined) (out as any)[k] = v;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, fixedKey]);
  const locked = useCallback((k: keyof ViewOptions) => (fixed as any)[k] !== undefined, [fixedKey]); // eslint-disable-line
  const set = useCallback(<K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => setViewOptions({ [k]: v } as Partial<ViewOptions>), []);
  return { options, set, locked };
}
