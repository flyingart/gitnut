import { useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { ArrowDown, ArrowUp, Columns2, FileDiff, FoldVertical, Pilcrow, Rows3, WholeWord } from "lucide-react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getChunks, unifiedMergeView } from "@codemirror/merge";
import type { ChangeStatus, FileChange, FileContent, FileSide } from "@gitnut/commons";
import { useFileDiff } from "./hooks";
import type { ServerProp } from "./provider";
import { GitnutRoot, useCx, type StyleProps } from "./root";
import { baseExtensions, languageFor } from "./diff/cm";
import { lineFirstDiff } from "./diff/lineDiff";
import { SideBySideDiff } from "./diff/sideBySide";
import { Empty, formatSize, IconButton, Segmented, Spinner } from "./ui";
import { useViewOptions } from "./viewOptions";
import { ImageDiff } from "./ImageDiff";

/** Imperative navigation (ChangesBrowser forwards F7 from the tree). */
export interface DiffController {
  /** Next change; false when there is none after the current one. */
  next(): boolean;
  prev(): boolean;
  count(): number;
}

/** Props of {@link DiffViewer}. Give either `change` (+ `repoId`, loaded from the daemon) or `before` / `after` texts. */
export interface DiffViewerProps extends StyleProps {
  server?: ServerProp;
  repoId?: string;
  /** Needed for local changes (INDEX / WORKTREE sides). */
  worktreeId?: string;
  change?: FileChange | null;
  /** Direct content (no daemon): left text, null = file did not exist. */
  before?: string | null;
  after?: string | null;
  /** File path for the header and syntax highlighting (default: the change's path). */
  path?: string;
  /** Fix the mode (hides the toggle). Default: remembered, side-by-side. */
  mode?: "side-by-side" | "unified";
  ignoreWhitespace?: boolean;
  collapseUnchanged?: boolean;
  highlightWords?: boolean;
  /** Header with path, status and refs. Default true. */
  showHeader?: boolean;
  /** Toolbar with navigation and toggles. Default true. */
  showToolbar?: boolean;
  /** F7 after the last change (pressed twice, like IntelliJ). Return false when there is no next file. */
  onNextFile?: () => boolean | void;
  onPrevFile?: () => boolean | void;
  /** Change to show first: "first" (default) or "last" (when arriving with Shift+F7). */
  startAt?: "first" | "last";
  controllerRef?: Ref<DiffController>;
}

const STATUS_LABEL: Record<ChangeStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  typechange: "Type changed",
  conflicted: "Conflict",
  untracked: "Unversioned",
};

export const sideLabel = (s: FileSide | null | undefined) =>
  !s ? "" : s.ref === "WORKTREE" ? "Working tree" : s.ref === "INDEX" ? "Index" : s.ref.slice(0, 8);

/** IntelliJ-style diff: side-by-side with connector bands (default) or unified, syntax and word highlights. */
export function DiffViewer(props: DiffViewerProps) {
  const cx = useCx();
  const { change, repoId } = props;
  const direct = props.before !== undefined || props.after !== undefined;
  const req = useMemo(
    () => (!direct && change && repoId ? { server: props.server, repoId, worktreeId: props.worktreeId, before: change.before, after: change.after } : null),
    [direct, change, repoId, props.server, props.worktreeId],
  );
  const loaded = useFileDiff(req);
  const { options, set, locked } = useViewOptions({
    diffMode: props.mode,
    ignoreWhitespace: props.ignoreWhitespace,
    collapseUnchanged: props.collapseUnchanged,
    highlightWords: props.highlightWords,
  });
  const path = props.path ?? change?.path ?? "";
  const status = change?.status ?? (props.before == null ? "added" : props.after == null ? "deleted" : "modified");

  const left: FileContent | null = direct ? (props.before == null ? null : { binary: false, size: props.before.length, text: props.before }) : loaded.before;
  const right: FileContent | null = direct ? (props.after == null ? null : { binary: false, size: props.after.length, text: props.after }) : loaded.after;
  const ready = direct || loaded.ready;
  const isImage = !!(left?.image || right?.image);
  const placeholder = isImage
    ? null
    : left?.binary || right?.binary
      ? `Binary file (${formatSize(Math.max(left?.size ?? 0, right?.size ?? 0))})`
      : left?.tooLarge || right?.tooLarge
        ? `File is too large to compare (${formatSize(Math.max(left?.size ?? 0, right?.size ?? 0))})`
        : null;

  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<{ next(): boolean; prev(): boolean; count(): number; destroy(): void } | null>(null);
  const [current, setCurrent] = useState({ index: -1, count: 0 });
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const a = left?.text ?? "";
  const b = right?.text ?? "";
  const showText = ready && !placeholder && !isImage && !(req && loaded.error);

  useEffect(() => {
    if (!showText || !host.current) return;
    const lang = new Compartment();
    const ext: Extension[] = [baseExtensions(), lang.of([])];
    const ignoreWs = options.ignoreWhitespace;
    const diffConfig = { override: (x: string, y: string) => lineFirstDiff(x, y, ignoreWs) };
    let views: EditorView[];
    let cleanup: () => void;
    if (options.diffMode === "side-by-side") {
      const sbs = new SideBySideDiff(host.current, {
        a,
        b,
        extensions: ext,
        diffConfig,
        highlightWords: options.highlightWords,
        collapseUnchanged: options.collapseUnchanged,
        onCurrent: (index) => setCurrent({ index, count: sbs.chunks.length }),
      });
      views = [sbs.a, sbs.b];
      engine.current = { next: () => sbs.next(), prev: () => sbs.prev(), count: () => sbs.chunks.length, destroy: () => sbs.destroy() };
      setCurrent({ index: -1, count: sbs.chunks.length });
      requestAnimationFrame(() => (props.startAt === "last" ? sbs.goTo(sbs.chunks.length - 1) : sbs.goTo(0)));
      cleanup = () => sbs.destroy();
    } else {
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: b,
          extensions: [
            ext,
            unifiedMergeView({
              original: a,
              mergeControls: false,
              highlightChanges: options.highlightWords,
              gutter: true,
              diffConfig,
              ...(options.collapseUnchanged && { collapseUnchanged: { margin: 3, minSize: 4 } }),
            }),
          ],
        }),
      });
      view.dom.classList.add("gitnut-unified");
      views = [view];
      let idx = -1;
      const chunks = () => getChunks(view.state)?.chunks ?? [];
      const goTo = (i: number) => {
        const list = chunks();
        if (i < 0 || i >= list.length) return false;
        idx = i;
        view.dispatch({ effects: EditorView.scrollIntoView(list[i].fromB, { y: "start", yMargin: 60 }) });
        setCurrent({ index: i, count: list.length });
        return true;
      };
      engine.current = { next: () => goTo(idx + 1), prev: () => goTo(idx - 1), count: () => chunks().length, destroy: () => view.destroy() };
      requestAnimationFrame(() => {
        setCurrent({ index: -1, count: chunks().length });
        goTo(props.startAt === "last" ? chunks().length - 1 : 0);
      });
      cleanup = () => view.destroy();
    }
    let alive = true;
    void languageFor(path).then((support) => {
      if (alive && support) for (const v of views) v.dispatch({ effects: lang.reconfigure(support) });
    });
    return () => {
      alive = false;
      engine.current = null;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showText, a, b, path, options.diffMode, options.ignoreWhitespace, options.highlightWords, options.collapseUnchanged]);

  const flash = (msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2500);
  };
  const step = (dir: 1 | -1): boolean => {
    const e = engine.current;
    if (e && (dir > 0 ? e.next() : e.prev())) {
      setHint(null);
      return true;
    }
    const go = dir > 0 ? props.onNextFile : props.onPrevFile;
    if (!go) return false;
    const msg = dir > 0 ? "Press F7 again to go to the next file" : "Press Shift+F7 again to go to the previous file";
    if (hint === msg) {
      setHint(null);
      go();
    } else flash(msg);
    return true;
  };
  useImperativeHandle(props.controllerRef, () => ({ next: () => step(1), prev: () => step(-1), count: () => engine.current?.count() ?? 0 }));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "F7") return;
    e.preventDefault();
    e.stopPropagation();
    step(e.shiftKey ? -1 : 1);
  };

  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
  const name = path.slice(dir.length);
  const beforeRef = change?.before ?? null;
  const afterRef = change?.after ?? null;

  return (
    <GitnutRoot component="diff" theme={props.theme} className={cx("diff", props.className)} classNames={props.classNames} style={props.style} onKeyDown={onKeyDown} tabIndex={-1}>
      {props.showHeader !== false && (
        <div className={cx("header", "gitnut-diff-header")}>
          <span className={`gitnut-status-badge`} style={{ color: `var(--gitnut-status-${status})` }} data-status={status}>
            {STATUS_LABEL[status]}
          </span>
          <span className="gitnut-diff-path" title={path}>
            <span className="gitnut-muted">{dir}</span>
            <span>{name}</span>
          </span>
          {change?.oldPath && change.oldPath !== change.path && <span className="gitnut-muted gitnut-diff-oldpath">from {change.oldPath}</span>}
          <span className="gitnut-toolbar-spacer" />
          {(beforeRef || afterRef) && (
            <span className="gitnut-diff-refs gitnut-mono">
              {beforeRef ? sideLabel(beforeRef) : "none"} → {afterRef ? sideLabel(afterRef) : "deleted"}
            </span>
          )}
        </div>
      )}
      {props.showToolbar !== false && (
        <div className={cx("toolbar", "gitnut-toolbar", "gitnut-diff-toolbar")}>
          <IconButton title="Previous change (Shift+F7)" icon={<ArrowUp size={14} />} onClick={() => step(-1)} disabled={!showText} />
          <IconButton title="Next change (F7)" icon={<ArrowDown size={14} />} onClick={() => step(1)} disabled={!showText} />
          <span className="gitnut-muted gitnut-count" data-testid="diff-count">
            {showText ? (current.count ? `${current.index >= 0 ? current.index + 1 : "–"} / ${current.count} ${current.count === 1 ? "change" : "changes"}` : "No differences") : ""}
          </span>
          <span className="gitnut-toolbar-spacer" />
          {!isImage && !locked("diffMode") && (
            <Segmented
              label="Diff mode"
              value={options.diffMode}
              onChange={(m) => set("diffMode", m)}
              options={[
                { value: "side-by-side", icon: <Columns2 size={14} />, title: "Side-by-side viewer" },
                { value: "unified", icon: <Rows3 size={14} />, title: "Unified viewer" },
              ]}
            />
          )}
          {!isImage && !locked("ignoreWhitespace") && (
            <IconButton title="Ignore whitespace" icon={<Pilcrow size={14} />} active={options.ignoreWhitespace} onClick={() => set("ignoreWhitespace", !options.ignoreWhitespace)} />
          )}
          {!isImage && !locked("highlightWords") && (
            <IconButton title="Highlight words" icon={<WholeWord size={14} />} active={options.highlightWords} onClick={() => set("highlightWords", !options.highlightWords)} />
          )}
          {!isImage && !locked("collapseUnchanged") && (
            <IconButton title="Collapse unchanged fragments" icon={<FoldVertical size={14} />} active={options.collapseUnchanged} onClick={() => set("collapseUnchanged", !options.collapseUnchanged)} />
          )}
        </div>
      )}
      <div className="gitnut-diff-body" data-mode={options.diffMode}>
        {!direct && !change ? (
          <Empty icon={<FileDiff size={22} />} title="Select a file to compare" />
        ) : req && loaded.error ? (
          <Empty title="Couldn't load this file">{loaded.error.message}</Empty>
        ) : !ready ? (
          <div className="gitnut-center">
            <Spinner size={18} />
          </div>
        ) : isImage ? (
          <ImageDiff before={left} after={right} />
        ) : placeholder ? (
          <Empty icon={<FileDiff size={22} />} title={placeholder}>
            The contents can't be shown as text.
          </Empty>
        ) : (
          <div ref={host} className="gitnut-diff-host" />
        )}
        {hint && <div className="gitnut-diff-hint gitnut-glass">{hint}</div>}
      </div>
    </GitnutRoot>
  );
}
