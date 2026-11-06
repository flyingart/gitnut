import type { MouseEvent } from "react";
import { GitBranch, Tag, Cloud, Crosshair } from "lucide-react";
import type { RefInfo } from "@gitnut/commons";

export interface RefLabel {
  key: string;
  text: string;
  kind: RefInfo["kind"];
  /** Checked out in a worktree. */
  current: boolean;
  refs: RefInfo[];
}

/**
 * Labels of one commit like IntelliJ's: a local branch and its same-named remote branch merge into
 * "origin & main"; HEAD is shown only when it is detached.
 */
export function refLabels(refs: RefInfo[]): RefLabel[] {
  const locals = refs.filter((r) => r.kind === "local");
  const remotes = refs.filter((r) => r.kind === "remote");
  const used = new Set<RefInfo>();
  const out: RefLabel[] = [];
  const head = refs.find((r) => r.kind === "head");
  for (const l of locals) {
    const twins = remotes.filter((r) => r.name.slice(r.name.indexOf("/") + 1) === l.name);
    twins.forEach((t) => used.add(t));
    const prefix = twins.map((t) => t.name.slice(0, t.name.indexOf("/"))).join(" & ");
    out.push({ key: l.full, text: prefix ? `${prefix} & ${l.name}` : l.name, kind: "local", current: l.worktrees.length > 0, refs: [l, ...twins] });
  }
  for (const r of remotes) if (!used.has(r)) out.push({ key: r.full, text: r.name, kind: "remote", current: false, refs: [r] });
  if (head && !locals.some((l) => head.worktrees.some((w) => l.worktrees.includes(w)))) {
    out.unshift({ key: "HEAD", text: "HEAD", kind: "head", current: true, refs: [head] });
  }
  for (const t of refs) if (t.kind === "tag") out.push({ key: t.full, text: t.name, kind: "tag", current: false, refs: [t] });
  // current branch first, then local, remote, tags
  const rank = (l: RefLabel) => (l.current ? 0 : l.kind === "head" ? 0 : l.kind === "local" ? 1 : l.kind === "remote" ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

export function RefIcon({ kind, size = 11 }: { kind: RefInfo["kind"]; size?: number }) {
  if (kind === "tag") return <Tag size={size} />;
  if (kind === "remote") return <Cloud size={size} />;
  if (kind === "head") return <Crosshair size={size} />;
  return <GitBranch size={size} />;
}

/** Ref pills of a commit row; at most `max` are shown, the rest as "+N". */
export function RefPills({ refs, max = 3, onContextMenu }: { refs: RefInfo[]; max?: number; onContextMenu?: (e: MouseEvent, label: RefLabel) => void }) {
  const labels = refLabels(refs);
  if (!labels.length) return null;
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  return (
    <span className="gitnut-refs" title={labels.map((l) => l.text).join("\n")}>
      {shown.map((l) => (
        <span key={l.key} className={`gitnut-ref gitnut-ref-${l.kind}${l.current ? " gitnut-ref-current" : ""}`} data-ref={l.text} onContextMenu={onContextMenu && ((e) => onContextMenu(e, l))}>
          <RefIcon kind={l.kind} />
          <span className="gitnut-ref-text">{l.text}</span>
        </span>
      ))}
      {rest > 0 && <span className="gitnut-ref gitnut-ref-more">+{rest}</span>}
    </span>
  );
}
