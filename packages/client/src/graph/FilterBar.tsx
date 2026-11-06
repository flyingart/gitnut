import { useEffect, useMemo, useState } from "react";
import { Calendar, ChevronDown, FolderTree, GitBranch, Search, User, X } from "lucide-react";
import type { GraphFilter, RefInfo } from "@gitnut/commons";
import { useCx } from "../root";
import { Popover } from "../ui";

/** Log filters (IntelliJ filter bar): text, branch, user, date, paths. */
export interface LogFilter {
  text?: string;
  author?: string;
  path?: string;
  /** Full ref names. */
  branches?: string[];
  /** Days back (1, 7, 30, 365) or a unix-seconds `since`. */
  days?: number;
}

export const toGraphFilter = (f: LogFilter): GraphFilter => ({
  text: f.text || undefined,
  author: f.author || undefined,
  path: f.path || undefined,
  since: f.days ? Math.floor(Date.now() / 1000 / 3600) * 3600 - f.days * 86400 : undefined,
});

const DAYS = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 365, label: "Last year" },
];

export interface FilterBarProps {
  value: LogFilter;
  onChange: (f: LogFilter) => void;
  refs: RefInfo[];
  /** Author names for suggestions. */
  authors?: string[];
  busy?: boolean;
}

export function FilterBar({ value, onChange, refs, authors = [], busy }: FilterBarProps) {
  const cx = useCx();
  const [text, setText] = useState(value.text ?? "");
  useEffect(() => setText(value.text ?? ""), [value.text]);
  useEffect(() => {
    if ((value.text ?? "") === text) return;
    const t = setTimeout(() => onChange({ ...value, text }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const set = (p: Partial<LogFilter>) => onChange({ ...value, ...p });
  const branchNames = useMemo(() => refs.filter((r) => r.kind !== "head"), [refs]);
  const branchLabel = value.branches?.length
    ? value.branches.map((b) => b.replace(/^refs\/(heads|remotes|tags)\//, "")).join(", ")
    : "Branch";

  return (
    <div className={cx("toolbar", "gitnut-toolbar", "gitnut-filterbar")} role="search">
      <label className={cx("input", "gitnut-search")}>
        <Search size={13} className="gitnut-muted" />
        <input placeholder="Text or hash" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter by text" />
        {text && (
          <button type="button" className="gitnut-search-clear" aria-label="Clear text filter" onClick={() => setText("")}>
            <X size={12} />
          </button>
        )}
      </label>
      <Popover title="Filter by branch" icon={<GitBranch size={13} />} label={<Chip text={branchLabel} />} active={!!value.branches?.length}>
        {(close) => (
          <div className="gitnut-menu gitnut-scroll" style={{ maxHeight: 320 }}>
            <button type="button" className="gitnut-menu-item" onClick={() => (set({ branches: undefined }), close())}>
              All branches
            </button>
            {branchNames.map((r) => {
              const on = value.branches?.includes(r.full) ?? false;
              return (
                <label key={r.full} className="gitnut-menu-item">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => set({ branches: on ? value.branches!.filter((b) => b !== r.full) : [...(value.branches ?? []), r.full] })}
                  />
                  <span className={`gitnut-ref-dot gitnut-ref-${r.kind}`} />
                  {r.name}
                </label>
              );
            })}
          </div>
        )}
      </Popover>
      <Popover title="Filter by user" icon={<User size={13} />} label={<Chip text={value.author || "User"} />} active={!!value.author}>
        {(close) => <TextFilter value={value.author} placeholder="Name or email" suggestions={authors} onDone={(author) => (set({ author }), close())} />}
      </Popover>
      <Popover title="Filter by date" icon={<Calendar size={13} />} label={<Chip text={DAYS.find((d) => d.days === value.days)?.label ?? "Date"} />} active={!!value.days}>
        {(close) => (
          <div className="gitnut-menu">
            <button type="button" className="gitnut-menu-item" onClick={() => (set({ days: undefined }), close())}>
              Any time
            </button>
            {DAYS.map((d) => (
              <button key={d.days} type="button" className={`gitnut-menu-item${value.days === d.days ? " gitnut-active" : ""}`} onClick={() => (set({ days: d.days }), close())}>
                {d.label}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Popover title="Filter by path" icon={<FolderTree size={13} />} label={<Chip text={value.path || "Paths"} />} active={!!value.path}>
        {(close) => <TextFilter value={value.path} placeholder="src/ or a file path" onDone={(path) => (set({ path }), close())} />}
      </Popover>
      {(value.text || value.author || value.path || value.days || value.branches?.length) && (
        <button type="button" className="gitnut-link" onClick={() => onChange({})}>
          Clear filters
        </button>
      )}
      {busy && <span className="gitnut-muted gitnut-count">Filtering…</span>}
    </div>
  );
}

const Chip = ({ text }: { text: string }) => (
  <>
    <span className="gitnut-chip-text">{text}</span>
    <ChevronDown size={12} className="gitnut-muted" />
  </>
);

function TextFilter({ value, placeholder, suggestions, onDone }: { value?: string; placeholder: string; suggestions?: string[]; onDone: (v: string | undefined) => void }) {
  const [v, setV] = useState(value ?? "");
  const listId = useMemo(() => `gitnut-dl-${Math.random().toString(36).slice(2)}`, []);
  return (
    <form
      className="gitnut-menu gitnut-menu-form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(v.trim() || undefined);
      }}
    >
      <input className="gitnut-input" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} list={suggestions ? listId : undefined} />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.slice(0, 200).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <div className="gitnut-row-actions">
        <button type="button" className="gitnut-link" onClick={() => onDone(undefined)}>
          Clear
        </button>
        <button type="submit" className="gitnut-btn gitnut-btn-primary gitnut-btn-sm">
          Apply
        </button>
      </div>
    </form>
  );
}
